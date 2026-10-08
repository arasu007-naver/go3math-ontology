# 조회 에이전트 명세: Neo4j (2026-10-08)

Go3 Math knowledge graph를 Neo4j에 두었을 때, 사용자와 대화하면서 그래프를 조회해 결과를 돌려주는 에이전트를 정의한다. Claude agent가 이 문서만 보고 구현할 수 있게 쓴다.

상위 스펙: `go3math-ontology-26-10-05.md`, `level-spec.md`

## 현재 상태 (구현 전에 확인)

- 그래프 원본은 PostgreSQL `kg` 스키마(`kg.nodes`, `kg.edges`, `kg.toc_unit_links`)다. 고정 노드 보호, level 규칙, 선수 관계 순환 검사가 트리거로 들어 있다(`web/db/schema.sql`).
- 조회 에이전트는 이미 있다(`web/src/app/api/agent/route.ts`). 흐름은 다음 세 단계다.
  1. Jev(`lib/server/jev.ts`)가 템플릿과 인자를 고른다.
  2. 아니면 로컬 LLM(`lib/server/localLlm.ts`, Qwen)이 템플릿·인자·키워드를 정하고 Jev가 다시 판정한다.
  3. 그래도 안 되면 Claude가 SQL을 쓰고, `lib/server/agentQuery.ts`가 읽기 전용으로 검사·실행한다.
- 어느 모델에도 문단 본문과 쿼리 결과를 보내지 않는다. 결과는 노드 id와 `/node?id=...` 링크로 프론트에 간다.

이 명세는 위 구조를 유지하고, 조회 대상을 Neo4j로, 쿼리 언어를 Cypher로 바꾼다.

## 결정

- **PostgreSQL이 원본, Neo4j는 조회 전용 사본이다.** 입력·수정은 지금처럼 PostgreSQL에서 하고 트리거 검증을 그대로 쓴다. Neo4j에는 쓰지 않는다(동기화 스크립트만 쓴다).
- 에이전트 응답 형식(`route`, `trace`, `answer`, `summary`, `plan`, `columns`, `rows`, `truncated`, `links`)은 바꾸지 않는다. 화면 코드는 고치지 않아도 되어야 한다. 3단계에서 SQL 대신 Cypher를 쓰므로 응답에 `cypher` 필드를 추가하고, `sql`은 빈 문자열로 둔다.
- 환경 변수 `GRAPH_BACKEND`(`postgres` | `neo4j`, 기본 `postgres`)로 조회 대상을 고른다. 두 백엔드 결과를 같은 질문으로 비교할 수 있어야 한다.

## Neo4j 데이터 모델

| PostgreSQL | Neo4j |
| --- | --- |
| `kg.nodes` 한 행 | 노드 하나. 공통 레이블 `:Node` + 종류 레이블 |
| `nodes.type` | 종류 레이블: `level`→`:Level`, `book`→`:Book`, `toc`→`:Toc`, `page`→`:Page`, `paragraph`→`:Paragraph`, `category`→`:Category`, `curriculum`→`:Curriculum` |
| `nodes.id`, `nodes.book` | 속성 `id`, `book` |
| `nodes.props` (JSONB) | 최상위 키를 속성으로 펼친다. 값이 객체면 JSON 문자열로 저장한다 |
| `kg.edges` 한 행 | 관계 하나. 관계 타입은 `edges.type` 그대로(`HAS_CHILD`, `PREREQUISITE_OF`, `BELONGS_TO_AREA`, `MAPS_TO`, `APPLIES_TO`, `DESCRIBES`, `HAS_TOC`, `POINTS_TO`, `HAS_PARAGRAPH`, `ANSWERS`, `CATEGORY_HAS`, `PREREQ_OF`) |
| `kg.toc_unit_links` 한 행 | 해당 TOC level 노드(`node_id`)에 속성으로 붙인다: `bookStem`, `bookTitle`, `documentId`, `tocKey`, `tocLevel`, `tocLabel`, `tocPage`, `pageKind`, `page`, `rootUnitId` |

- 문단 본문은 Neo4j에 넣지 않는다. 본문은 지금처럼 `/node` 화면이 PostgreSQL·S3에서 가져온다.
- 고정 노드(Level 1·2, `L3-STUDY-*`)에는 속성 `fixed: true`를 붙인다.

### 제약과 인덱스

- `:Node(id)` 고유 제약.
- 범위 인덱스: `:Level(level)`, `:Level(category)`, `:Level(kind)`, `:Node(book)`.
- 전문 검색 인덱스(full-text) `nameIndex`: `:Level(name, aliases)`, `:Toc(label)`, `:Book(title)`. 한글 분석기(`cjk`)를 쓴다.
- `aliases`(별칭 목록)는 원본에 없으면 비워 둔다. 별칭은 지어내지 않는다. 운영 중 질문 로그에서 사람이 확인해 원본에 추가한다.

## 동기화

- 스크립트 `web/scripts/neo4j-sync.mjs`, npm 스크립트 `db:sync-neo4j`.
- 전체 재구성 방식: PostgreSQL을 한 번의 읽기 트랜잭션으로 읽고, Neo4j에 `MERGE`(id 기준)로 노드·관계를 넣고 속성을 덮어쓴다. 이번 실행에 없던 노드·관계는 지운다. 1,000건 단위로 배치한다.
- 끝나면 `(:SyncInfo {syncedAt, nodeCount, edgeCount})` 하나를 갱신한다. 에이전트 응답 `trace`에 `syncedAt`을 남긴다.
- 실행 시점: `db:import-*` 스크립트 뒤, 그리고 도서 입력 화면에서 TOC 노드를 등록하거나 지운 뒤. 우선은 수동·스크립트 실행으로 충분하고, 자동 증분 동기화는 이 명세 범위 밖이다.
- 완료 검사: 노드 수, 관계 타입별 개수가 PostgreSQL과 같다. 다르면 0이 아닌 코드로 끝난다.

## 에이전트 흐름

```
질문
 → 이름 찾기 (전문 검색 인덱스, LLM 없음)
 → 1단계 Jev: 템플릿·인자 선택 (확신 높을 때만 실행)
 → 2단계 로컬 LLM: 템플릿·인자·키워드, Jev 재판정
 → 3단계 외부 LLM: Cypher 생성 (실패 시 오류를 붙여 한 번만 재시도)
 → 검사 → 읽기 전용 실행 → 결과(노드 id, 링크)
```

### 이름 찾기

- 질문에서 과목·단원·도서 이름 후보를 `db.index.fulltext.queryNodes('nameIndex', ...)`로 찾는다. 점수 상위 몇 개의 `id`, `name`, `level`을 다음 단계에 후보 목록으로 넘긴다.
- 2단계 로컬 LLM의 인자 enum과 3단계 프롬프트의 카탈로그를 이 후보로 줄여서 토큰을 아낀다. 후보가 없으면 지금처럼 전체 카탈로그를 쓴다.

### 1·2단계: 템플릿

- 현재 `lib/server/agentTemplates.ts`의 템플릿마다 같은 이름의 Cypher 템플릿을 만든다. 인자는 반드시 파라미터(`$subject` 등)로 넘기고 문자열로 이어 붙이지 않는다.
- 다음 템플릿이 없으면 추가한다.
  - 선수 경로: 노드 → `PREREQUISITE_OF*1..6` 역방향으로 선수 노드 목록과 경로
  - 다음 단계: 노드 → `PREREQUISITE_OF*1..3` 정방향
  - 하위 구조: 노드 → `HAS_CHILD*1..3`
  - 상위 경로: 노드 → `HAS_CHILD` 역방향으로 Level 1까지
  - 교재 대응: 대단원·소단원 ← `MAPS_TO` ← TOC·문단, TOC level 노드의 도서·페이지 속성
  - 전략 적용: 문제 해결 전략 쪽 노드 → `APPLIES_TO` → 수학 단원, 그리고 그 반대 방향
  - 영역 소속: 과목·대단원 → `BELONGS_TO_AREA` → Level 1
- Jev와 로컬 LLM의 판단 기준(`IN_SCOPE_MIN`, `TEMPLATE_MIN`, `ARG_MIN`, `VERIFY_MIN`)은 그대로 쓴다.

### 3단계: 외부 LLM Cypher 생성

- 기본 모델은 비용을 위해 가벼운 모델로 둔다. 환경 변수 `AGENT_CYPHER_MODEL`로 고르고, 기본값은 `claude-haiku-4-5`. 현재 코드의 `claude-opus-5` + 긴 사고 설정은 이 단계에서 쓰지 않는다. `max_tokens`는 1,000 이하로 둔다.
- Gemini 같은 다른 제공자는 같은 인터페이스(질문 → `{answerable, cypher, summary}`) 뒤에 둘 수 있게 함수 하나로 감싼다. 이번 구현에서는 Claude만 연결한다.
- 시스템 프롬프트에는 다음만 넣는다: 규칙, Neo4j 스키마 요약(레이블, 관계 타입과 방향, 주요 속성), 고정 노드 코드표, 이름 찾기 후보, 예시 질문·Cypher 10~20쌍. 예시는 실제 그래프에서 실행해 결과가 나오는 것만 쓴다.
- 대화 맥락은 지금처럼 최근 4턴의 질문과 요약만 넘긴다. 쿼리 결과와 문단 본문은 넘기지 않는다.
- 검사에서 거부되거나 실행 오류가 나면, 오류 메시지(결과 데이터 아님)를 붙여 한 번만 다시 생성한다.

## Cypher 실행 안전장치

`lib/server/agentQuery.ts`에 Neo4j용 실행기 `runCypher`를 추가한다.

- Neo4j 드라이버 읽기 모드(`executeRead`, `defaultAccessMode: READ`)로 실행하고, DB 사용자도 읽기 전용 역할(`reader`)로 만든다.
- 다음 절이 있으면 거부한다: `CREATE`, `MERGE`, `DELETE`, `DETACH`, `SET`, `REMOVE`, `DROP`, `LOAD CSV`, `FOREACH`, `CALL { ... } IN TRANSACTIONS`, 그리고 `db.index.fulltext.queryNodes`를 뺀 모든 `CALL` 프로시저.
- 문장은 하나만 허용한다. 실행 전에 `EXPLAIN`으로 문법을 검사한다.
- 가변 길이 경로는 상한을 6으로 둔다(`*..6` 초과 또는 상한 없는 `*`는 거부).
- 결과는 최대 100행(`MAX_ROWS`)으로 자르고 `truncated`를 표시한다. 트랜잭션 시간 제한은 5초.
- 결과 셀 중 노드 id(`L1-`~`L9-`, `cat:`, `cur:`, `book:`, `toc:`, `page:`, `para:` 접두사)는 `/node?id=...` 링크로 바꾼다. 노드 객체가 반환되면 `id`, `name`(또는 `label`, `title`), `level`만 꺼내 행으로 만든다.

## 설정

| 변수 | 설명 |
| --- | --- |
| `GRAPH_BACKEND` | `postgres` 또는 `neo4j` |
| `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, `NEO4J_DATABASE` | 에이전트용 읽기 전용 계정 |
| `NEO4J_SYNC_USER`, `NEO4J_SYNC_PASSWORD` | 동기화 스크립트용 쓰기 계정 |
| `AGENT_CYPHER_MODEL` | 3단계 모델. 기본 `claude-haiku-4-5` |

비밀번호와 API 키는 `.env.local`에만 두고 커밋하지 않는다.

## 기록

- 질문마다 남긴다: 시각, 사용자 아이디, 질문, 거친 단계(`route`), 템플릿 또는 Cypher, 결과 행 수, 걸린 시간, 3단계 토큰 수.
- 비밀번호, 토큰, 문단 본문은 기록하지 않는다.
- 결과 0건, 3단계까지 간 질문, 거부된 Cypher는 따로 볼 수 있게 한다. 템플릿, 예시, 별칭을 보강하는 근거로 쓴다.

## 이 문서에서 하지 않는 것

- Neo4j를 원본으로 바꾸거나 Neo4j에서 직접 입력·수정하기
- 자동 증분 동기화
- 벡터 인덱스와 임베딩 검색
- Gemini 연결
- 결과를 모델이 문장으로 다시 써 주는 기능

## 완료 기준

- `npm run db:sync-neo4j` 후 Neo4j의 노드 수와 관계 타입별 개수가 PostgreSQL과 같다
- `GRAPH_BACKEND=neo4j`에서 기존 에이전트 화면이 코드 변경 없이 동작하고, 응답 형식이 같다
- 기존 템플릿 전부와 새 템플릿 7개가 Cypher로 동작하고, 같은 질문에 PostgreSQL 백엔드와 같은 노드 집합을 돌려준다
- 쓰기 절, 허용 밖 프로시저, 상한 없는 가변 경로가 든 Cypher는 실행 전에 거부된다
- 3단계 기본 모델이 `AGENT_CYPHER_MODEL`로 바뀌고, 모델에 문단 본문과 쿼리 결과가 가지 않는다
- 결과 노드마다 `/node?id=...` 링크가 있다
