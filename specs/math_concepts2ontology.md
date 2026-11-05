# math_concepts2ontology — Next.js `legacy2ontology` 페이지 구현 스펙 (v1.0)

> 대상: Claude(코딩 에이전트). 이 문서만으로 구현 가능하도록 작성. 비밀값은 코드/문서에 넣지 않고 환경변수 이름만 사용.

## 0. 요약
- 위치: `go3math-ontology` 프로젝트 (Next.js App Router), 경로 `/legacy2ontology`.
- 소스: MariaDB `mathdb.math_concepts` (**읽기 전용**, SELECT만).
- 대상: 기존 PostgreSQL 지식 그래프(KG) DB의 2022 개정 교육과정 단원.
- 흐름: ① 같은 개념 묶기(중복제거) → ② 대표 개념마다 단원 선택 3중 투표(JEV / Claude Sonnet / Gemini) → ③ **3표 모두 일치 시에만** 자동 이전, 아니면 검토 필요(사람이 UI에서 결정) → ④ 사용자가 묶음·단원 수정 가능(이력 보존).
- legacy 기존 단원(`chapter_id`, `math_chapters`, `math_concept_chapters`)은 **사용하지 않는다**(표시·후보 축소·프롬프트 모두).

## 1. 목표 / 비목표
**목표**
1. `is_on=1` 개념의 중복 묶음 생성·편집(병합/분리/대표 변경).
2. 대표 개념별 3개 선택기 결과를 각각 전부 기록.
3. 3표 만장일치(3/3)로만 단원 자동 확정, 그 외(2/3·불일치·오류)는 `needs_review`.
4. 수동 단원 지정(override) + 이력.
5. KG 반영 시 기존 단원 연결은 삭제하지 않고 비활성화 후 새 연결 생성.
6. 좌(legacy)·우(이전 결과) 1:1 행 정렬 UI.

**비목표**
- MariaDB 쓰기, 스키마 변경, 데이터 삭제.
- 개념 본문 편집/재작성, 2022 단원 체계 자체 편집.
- 인증 체계 신규 구축(기존 프로젝트 방식 사용), 다크 모드.
- `is_on=0` 개념 처리(개수만 보고).

## 2. 환경변수
| 이름 | 용도 |
|---|---|
| `LEGACY_MARIADB_URL` | 읽기 전용 계정 접속 문자열 |
| `KG_DATABASE_URL` | PostgreSQL KG |
| `JEV_API_URL`, `JEV_API_KEY` | JEV (typesafe.ai) |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | 기본값은 Open Question 참조 |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | `GEMINI_MODEL` 기본값 `gemini-4-argon` |
| `SELECTOR_CONCURRENCY` | 선택기별 동시 호출 수 (기본 4) |
| `DEDUPE_SIM_THRESHOLD` | 임베딩 유사 후보 임계값 (기본 0.92, 확인 필요) |

MariaDB 계정은 SELECT 권한만 있는 계정을 사용. 코드에서도 쿼리 빌더 래퍼(`legacyDb.select`)만 노출하고 INSERT/UPDATE/DELETE 경로를 만들지 않는다.

## 3. 소스 데이터 (MariaDB, 읽기 전용)
`mathdb.math_concepts` 주요 컬럼(`chapter_id`는 사용하지 않음): `id, math_field, concept_type, curriculum_type, curriculum_year, school_type, raw_title, html_title, raw_statement, html_statement, img_path, is_on`.
- 목록 정렬: `ORDER BY id ASC` (안정 정렬, 좌우 정렬의 기준).
- `is_on=0`은 목록에 회색 "제외" 배지로 표시만 하고 모든 파이프라인에서 제외. 상단에 `제외 N건` 카운트.
- 수식: statement 안의 backtick AsciiMath(`` `x^2` ``)는 프로젝트의 기존 MathJax 렌더 컴포넌트를 재사용. LLM 프롬프트에는 raw 텍스트 그대로 전달.

## 4. 데이터 모델 (PostgreSQL, 스키마 `l2o`)
```sql
create schema if not exists l2o;

-- 4.1 중복 묶음
create table l2o.dedupe_group (
  id bigserial primary key,
  representative_legacy_id bigint not null,
  method text not null check (method in ('exact','embedding','jev','manual')),
  status text not null default 'auto' check (status in ('auto','confirmed','needs_review')),
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table l2o.dedupe_member (
  legacy_concept_id bigint primary key,          -- 개념은 정확히 1개 그룹에 소속(단독도 1인 그룹)
  group_id bigint not null references l2o.dedupe_group(id),
  similarity real,                                 -- 대표와의 유사도
  added_by text not null default 'system'
);
create table l2o.dedupe_history (
  id bigserial primary key, group_id bigint, action text not null, -- merge|split|set_rep|create
  before jsonb, after jsonb, actor text, created_at timestamptz default now()
);

-- 4.2 작업 실행
create table l2o.job_run (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dedupe','test','migrate_all','migrate_one')),
  dry_run boolean not null default false,
  scope jsonb not null,                 -- {page, pageSize} | {ids:[...]} | {all:true}
  status text not null default 'queued' check (status in ('queued','running','paused','done','failed','cancelled')),
  total int default 0, processed int default 0, succeeded int default 0, failed int default 0, needs_review int default 0,
  cursor_legacy_id bigint,              -- 재개 지점
  error text, created_by text, started_at timestamptz, finished_at timestamptz,
  created_at timestamptz default now()
);

-- 4.3 선택기 투표 (모든 호출 기록, 덮어쓰지 않음)
create table l2o.selector_vote (
  id bigserial primary key,
  job_run_id uuid references l2o.job_run(id),
  group_id bigint not null references l2o.dedupe_group(id),
  selector text not null check (selector in ('jev','claude','gemini')),
  model text, model_version text, prompt_version text not null,
  candidate_unit_ids text[] not null,
  selected_unit_id text,                -- 후보 밖이면 null + error='out_of_candidates'
  confidence real,                      -- 0..1 (JEV 확률 / LLM 자기보고)
  scores jsonb,                         -- {unitId: score}
  raw_response jsonb, latency_ms int, error text,
  input_hash text not null,             -- 개념+후보+prompt_version 해시 (멱등 키)
  created_at timestamptz default now()
);
create index on l2o.selector_vote (group_id, selector, created_at desc);

-- 4.4 이전 결과 (대표 그룹당 1행, 현재 상태)
create table l2o.migration_result (
  group_id bigint primary key references l2o.dedupe_group(id),
  status text not null check (status in ('pending','auto_agreed','needs_review','overridden','migrated','error')),
  majority_unit_id text, agree_count int,
  final_unit_id text,                   -- override가 있으면 override 값
  kg_concept_id text,                   -- KG 측 개념 노드 id
  dry_run_only boolean default false,
  last_job_run_id uuid, updated_at timestamptz default now()
);

-- 4.5 수동 수정 이력
create table l2o.unit_override (
  id bigserial primary key, group_id bigint not null,
  previous_unit_id text, new_unit_id text not null, reason text,
  actor text not null, created_at timestamptz default now()
);
```
### 4.6 KG 엣지 처리
- 기존 KG 개념→단원 엣지 테이블(프로젝트 실제 이름 확인, 예: `kg_edge`)에 `is_active boolean`, `deactivated_at`, `deactivated_by_job` 컬럼이 없으면 마이그레이션으로 추가.
- 반영 트랜잭션(그룹당 1개): ① 해당 KG 개념의 활성 `belongs_to_unit` 엣지 중 `final_unit_id`와 다른 것 → `is_active=false, deactivated_at=now()` ② 같은 엣지가 이미 활성이면 아무것도 안 함(멱등) ③ 없으면 신규 활성 엣지 insert (`source='legacy2ontology'`, `legacy_ids` 메타 포함). **DELETE 금지.**
- KG 개념 노드는 대표 개념 기준 1개. 비대표 멤버 legacy id는 노드 메타(`legacy_concept_ids bigint[]`)에 기록.

## 5. 파이프라인
### 5.1 중복제거 (`중복제거` 버튼)
1. `is_on=1` 전체 로드(id, title, statement, school_type, curriculum_year, math_field).
2. 정규화: HTML 제거, 공백/전각 통일, 소문자, backtick 내부 공백 제거.
3. 1차 exact: `(normalized_title, normalized_statement)` 동일 → 같은 그룹 (`method='exact'`).
4. 2차 후보: 같은 `school_type`+`math_field` 블록 내 임베딩 코사인 ≥ `DEDUPE_SIM_THRESHOLD` 쌍. 임베딩 모델은 기존 프로젝트 것을 재사용(없으면 Open Question).
5. 3차 판정: 후보 쌍을 JEV에 `same|different` 2지선다로 질의, 확률 ≥0.8이면 병합(`method='jev'`), 0.5~0.8은 묶되 `needs_review`. 판정은 `l2o.dedupe_pair(a,b,similarity,same_prob,model)`에 저장하고 재실행 시 재사용(결과 고정, 재호출 없음). 3개 이상 묶인 그룹에서 모든 쌍이 직접 병합 판정이 아니면(A=B, B=C로만 이어진 꼬리물기) `needs_review`.
6. 대표 선택 규칙: html_statement 존재 > statement 길이 > curriculum_year 최신 > id 최소.
7. **이미 `confirmed`/manual 편집된 그룹은 재실행 시 변경하지 않음.** 재실행은 미확정 그룹만 재계산.
8. 편집 기능: 병합(행 선택 후 "같은 개념으로 묶기"), 분리(멤버 빼기→1인 그룹), 대표 변경. 모두 `dedupe_history` 기록, 해당 그룹 `migration_result`는 `pending`으로 되돌림(단원 재선택 필요 표시).

### 5.2 후보 단원 축소 (코드)
`getCandidateUnits(concept)`:
1. KG의 2022 단원 중 `school_type` 일치.
2. `math_field`로 영역 필터(매핑 테이블 `l2o.field_map` 또는 상수; 확인 필요).
3. (삭제) legacy 기존 단원은 후보 축소에 사용하지 않는다.
4. 항상 15개(학교급 단원이 그보다 적으면 전부). 영역 일치 단원을 먼저(유사도 상위 15개까지) 넣고, 모자란 자리는 같은 학교급의 나머지 단원을 유사도 순으로 채운다. 채웠으면 `candidate_fallback=true`. 레거시 `math_field` 가 틀린 경우(예: 수열 개념이 NUMBERS)에도 정답 단원이 후보에서 빠지지 않게 하기 위함. 학교급 단원이 3개 미만이면 전체 단원에서 채운다.
후보 목록은 `{unit_id, path:"중1 > 수와 연산 > 소인수분해", description}` 형태. 세 선택기 모두 **같은 후보 목록**을 받는다.

### 5.3 선택기 어댑터
```ts
export type SelectorName = 'jev'|'claude'|'gemini';
export interface SelectorInput {
  groupId: number;
  concept: { legacyId: number; title: string; statement: string; schoolType: string; mathField: string };
  candidates: { unitId: string; path: string; description?: string }[];
  promptVersion: string;  // 'unit-select-v1'
}
export interface SelectorOutput {
  selectedUnitId: string|null; confidence: number|null; scores?: Record<string,number>;
  raw: unknown; model: string; modelVersion?: string; latencyMs: number; error?: string;
}
export interface UnitSelector { name: SelectorName; select(i: SelectorInput, signal?: AbortSignal): Promise<SelectorOutput>; }
```
- 공통 검증: `selectedUnitId`가 후보에 없으면 `selectedUnitId=null, error='out_of_candidates'`. JSON 파싱 실패 1회 재요청 후 실패 시 error.
- **JEV**: `lib/selectors/jev.ts`. 후보를 choice로, 개념 텍스트를 context로 넘기고 확률 분포를 받는 형태로 가정. **TODO(확인 필요): 엔드포인트, 요청/응답 스키마, 인증 헤더, 모델 id.** 응답 → `scores`, argmax → selected, max prob → confidence. 확정 전엔 `JEV_API_URL` 미설정 시 `error='not_configured'`로 기록하고 파이프라인은 계속(3/3 불가 → 전부 `needs_review`).
- **Claude**: Anthropic Messages API, `CLAUDE_MODEL`, temperature 0, max_tokens 300.
- **Gemini**: Generative Language API, `GEMINI_MODEL`(기본 `gemini-4-argon`), temperature 0, `responseMimeType: application/json` + responseSchema.

### 5.4 프롬프트 (Claude/Gemini 공통, `unit-select-v1`)
System:
```
당신은 한국 2022 개정 수학 교육과정 분류기입니다. 주어진 수학 개념이 속하는 단원을
후보 목록에서 정확히 하나 고르세요. 후보에 없는 id를 만들지 마세요.
반드시 아래 JSON만 출력하세요(설명 문장, 코드블록 금지):
{"unit_id":"<후보 id>","confidence":<0~1>,"reason":"<40자 이내>"}
판단이 불가능하면 {"unit_id":null,"confidence":0,"reason":"..."}
```
User:
```
[개념]
학교급: {schoolType} / 영역: {mathField}
제목: {title}
내용: {statement}   (수식은 backtick AsciiMath)

[후보 단원]
- {unitId}: {path} — {description}
...
```

### 5.5 판정 (3/3 만장일치)
- 유효 표 = error 없고 selected not null.
- 3개 선택기(JEV·Claude·Gemini) 모두 유효하고 같은 unit → `auto_agreed`, `majority_unit_id`, `agree_count=3`.
- 그 외(2/3 일치, 전부 다름, 오류·미설정 포함 유효 표 2개 이하) → `needs_review`. 사람이 검토 UI에서 단원을 결정한다(override). 2표 이상 일치한 unit이 있으면 그것을, 없으면 가장 높은 confidence 표를 "제안"으로 표시만. `agree_count`는 최다 일치 수를 기록.
- override 존재 시 `final_unit_id = override`, status `overridden` (이후 재실행으로 덮지 않음).
- 실제 KG 쓰기 대상: `auto_agreed` 또는 `overridden` → 쓰기 성공 시 `migrated`. `needs_review`는 쓰지 않음.

### 5.6 동시성·재시도·한도
- 그룹 단위 처리, 그룹 내 3선택기 `Promise.allSettled` 병렬.
- 선택기별 세마포어 `SELECTOR_CONCURRENCY`(p-limit). 429/5xx/timeout(30s) → 지수 백오프 1s,2s,4s 최대 3회 + jitter, `Retry-After` 존중.
- 한 선택기 실패해도 나머지로 판정.
- 작업 루프는 서버(Route Handler에서 시작하는 백그라운드 워커 또는 프로젝트에 있는 큐). Vercel 등 서버리스면 배치(예: 20그룹)씩 처리 후 `cursor_legacy_id` 저장하고 다음 배치를 클라이언트 폴링이 트리거하는 방식 허용.

### 5.7 멱등성
- `input_hash` 동일 + 성공한 vote가 이미 있으면 재호출 생략(재사용). "강제 재선택" 옵션 시에만 신규 호출.
- KG 쓰기는 4.6 규칙으로 중복 엣지 없음. 같은 job 재개 시 `cursor_legacy_id` 이후부터.
- `migrate_all`은 동시에 1개만 실행(running job 있으면 409).

## 6. API (App Router)
| 메서드/경로 | 설명 |
|---|---|
| `GET /api/l2o/concepts?page=&pageSize=` | legacy 행 + 해당 행의 그룹/투표/결과 조인된 `RowVM[]`, `total`, `excludedCount` |
| `POST /api/l2o/dedupe` | 중복제거 job 생성 → `{jobId}` |
| `POST /api/l2o/dedupe/merge` `{legacyIds, representativeId}` | 병합 |
| `POST /api/l2o/dedupe/split` `{legacyId}` | 분리 |
| `POST /api/l2o/dedupe/representative` `{groupId, legacyId}` | 대표 변경 |
| `POST /api/l2o/test` `{page,pageSize}` 또는 `{ids}` | dry-run job (KG 미기록) |
| `POST /api/l2o/migrate-all` `{confirm:true}` | 전체 이전 job |
| `POST /api/l2o/migrate-one` `{groupId, force?}` | 단건 재선택+이전 |
| `POST /api/l2o/override` `{groupId, unitId, reason}` | 수동 단원 + 즉시 KG 반영 |
| `GET /api/l2o/jobs/:id` | 진행률 |
| `POST /api/l2o/jobs/:id/(pause|resume|cancel)` | 제어 |
| `GET /api/l2o/units/candidates?groupId=` | 편집 드롭다운용 후보(+ 전체 검색 `q=`) |
모든 입력 zod 검증. 쓰기 라우트는 기존 관리자 인증 미들웨어 적용.

```ts
type RowVM = {
  legacy: { id:number; title:string; statement:string /* HTML 제거, backtick 수식 유지 */; images:string[] /* <img hwp-img-id> → URL */; schoolType:string|null; mathField:string|null; isOn:boolean };
  group?: { id:number; isRepresentative:boolean; representativeId:number; memberCount:number; status:string };
  votes: Partial<Record<SelectorName,{unitId:string|null; unitPath?:string; confidence:number|null; error?:string; at:string}>>;
  result?: { status:string; finalUnitId?:string; finalUnitPath?:string; agreeCount?:number; dryRunOnly:boolean };
};
```

## 7. 테스트 버튼 정의
- 현재 페이지의 `is_on=1` 행(체크 선택 시 선택 행만)을 대상으로 후보 축소→3선택기→다수결까지 실행.
- `job_run.dry_run=true`. `selector_vote`는 기록(비용 재사용 목적), `migration_result`는 `dry_run_only=true`로만 갱신, **KG에는 쓰지 않음**.
- 완료 후 우측 열에 결과 표시, 행에 "테스트" 배지. 상단에 요약(일치 n / 검토 n / 오류 n, 평균 지연, 선택기별 일치율).
- 중복제거 미실행 상태면 버튼 비활성 + 툴팁 "먼저 중복제거를 실행하세요".

## 8. 모두 이전 버튼
- 확인 모달: 대상 그룹 수, 예상 호출 수(그룹×3, 캐시 제외), `needs_review`는 쓰지 않는다는 안내, 입력창에 "이전" 입력 시 활성.
- 진행 바(processed/total, 성공/검토/오류), 일시정지·재개·취소. 페이지 새로고침 후에도 running job을 찾아 진행 바 복원.
- 기존 `overridden`/`migrated` 그룹은 건너뜀(강제 옵션 없음).

## 9. UI
### 9.1 레이아웃
```
┌──────────────────────────────────────────────────────────────┐
│ 상단 버튼 그룹 영역                                          │
│ [제목·통계: 전체 N / 제외 N / 그룹 N / 이전 N / 검토 N]   [중복제거][테스트][모두 이전] │
│ (job 진행 바: 실행 중일 때만)                                │
├───────────────────────────────┬──────────────────────────────┤
│ LEFT: Legacy math_concepts    │ RIGHT: 이전 결과              │
│ [« ‹ 1 2 3 … 10 › »] 크기▼     │ (헤더 높이 맞춤: 필터 칩)     │
│ row 1                         │ row 1 대응                    │
│ row 2                         │ row 2 대응                    │
└───────────────────────────────┴──────────────────────────────┘
```
- 버튼 3개는 상단 영역 **오른쪽 정렬**(flex `justify-between`). 순서: 중복제거, 테스트, 모두 이전(primary).
- 좌 페이지네이션은 **한 줄** 버튼 그룹, 넘치면 `…`로 축약(현재±2, 처음/끝). 우측 상단에는 같은 높이의 헤더 바(상태 필터: 전체/검토 필요/오류/이전됨)를 두어 첫 행 위치를 맞춘다.
- 페이지 크기 기본 20 (확인 필요), URL 쿼리 `?page=&size=`와 동기화.

### 9.2 1:1 행 정렬
- 좌우를 **하나의 CSS grid**(`grid-template-columns: 1fr 1fr`)로 렌더하고 행마다 `<LeftCell/><RightCell/>`을 같은 grid row에 둔다 → 행 높이 자동 일치, 스크롤 1개(본문 영역 공용 스크롤). 별도 두 스크롤 동기화 방식은 쓰지 않는다.
- 각 행 `data-legacy-id`; 한쪽 hover/선택 시 양쪽 하이라이트.
- 우측 셀 상태:
  - `is_on=0`: "제외됨" 회색.
  - 그룹 없음: "중복제거 전" 빈 상태.
  - 비대표 멤버: "→ 대표 #{id}로 병합됨" 링크(클릭 시 대표 행이 있는 페이지로 이동+스크롤) + 대표의 최종 단원 읽기 전용.
  - 대표 + pending: "단원 미선택" + [이 개념만 실행].
  - 대표 + 결과: 3표 칩 `JEV · Claude · Gemini`(단원 경로 축약, confidence %, 오류 시 빨강 아이콘+툴팁), 최종 단원, 상태 배지(자동일치 3/3 / 검토 필요 / 수동 / 이전됨 / 테스트 / 오류), [단원 수정] [재선택] [이력].
- 좌측 셀: id, 학교급·영역 칩, 제목, MathJax 렌더 statement(3줄 clamp, 펼치기), img 썸네일(있으면), 그룹 배지(대표 ★ / 멤버 수), 체크박스(병합·테스트 선택용).

### 9.3 컴포넌트 트리
```
app/legacy2ontology/page.tsx (server: 초기 데이터)
└ Legacy2OntologyClient
  ├ TopBar
  │  ├ StatsSummary
  │  ├ ActionButtons (DedupeButton, TestButton, MigrateAllButton+ConfirmDialog)
  │  └ JobProgressBar (폴링 2s)
  ├ BodyGrid
  │  ├ HeaderRow (PaginationBar | ResultFilterBar)
  │  └ ConceptRow × N (LeftConceptCell | RightResultCell)
  │       RightResultCell → VoteChips, FinalUnitBadge, StatusBadge, RowActions
  ├ UnitEditDialog (후보 목록 라디오 + 전체 검색, 사유 입력)
  ├ GroupEditDialog (멤버 목록, 대표 변경, 분리)
  ├ HistoryDrawer (override / dedupe / votes 전체 이력)
  └ SelectionActionBar (선택 n개: 묶기, 테스트)
```
- 데이터 패칭: TanStack Query 또는 프로젝트 기존 방식. mutation 후 해당 페이지 쿼리 invalidate.
- 로딩: 행 skeleton(좌우 동시). 오류: 상단 inline alert + 재시도.

## 10. 수용 기준
1. MariaDB에 쓰기 쿼리가 코드상 존재하지 않는다(grep `INSERT|UPDATE|DELETE` on legacy client = 0).
2. `is_on=0`은 그룹/투표/KG에 없음, 카운트는 표시됨.
3. 중복제거 후 모든 `is_on=1` 개념이 정확히 1개 그룹에 소속.
4. 병합/분리/대표 변경이 이력에 남고 해당 그룹이 pending으로 돌아간다.
5. 대표 그룹마다 3개 선택기 결과가 각각(실패 포함) `selector_vote`에 기록된다.
6. 3표 모두 일치 → 자동 확정, 그 외(2/3 포함) → needs_review, KG 미기록(사람이 결정 후 기록).
7. override는 이력에 남고 재실행으로 덮이지 않는다.
8. 테스트는 KG를 바꾸지 않는다(전후 KG 엣지 수 동일).
9. 모두 이전을 중단 후 재개해도 중복 엣지/중복 호출이 없다; 2회 연속 실행 결과 동일.
10. 기존 단원 엣지는 삭제되지 않고 `is_active=false`로 남는다.
11. 좌우 행이 모든 뷰포트에서 같은 높이·순서로 정렬된다.
12. 상단 3버튼이 상단 영역 오른쪽에 있다.

## 11. 테스트 계획
- 단위: 정규화·exact 그룹핑, 대표 선택 규칙, 판정(3/3→자동, 2/3·1/1/1·오류 포함·유효 1표→검토), 후보 축소(0개 fallback, 15개 cap), 선택기 응답 파서(후보 밖 id, 깨진 JSON, 코드블록 감싼 JSON).
- 어댑터: msw로 Claude/Gemini/JEV 모킹, 429→재시도, timeout.
- 통합: 테스트용 Postgres(docker) + legacy 픽스처(sqlite/mysql 컨테이너 50행)로 dedupe→test→migrate-all→재개→override 시나리오, KG 엣지 비활성화 검증.
- E2E(Playwright): 버튼 위치, 페이지 이동, 행 정렬(좌우 셀 boundingBox top/height 동일), 확인 모달, 진행 바 복원.
- 실데이터 파일럿: 실제 1페이지(20개) 테스트 실행 → 선택기별 일치율 리포트 확인 후 모두 이전.

## 12. 구현 순서
1. DB 마이그레이션(l2o 스키마, KG 엣지 컬럼) 2. legacy 읽기 클라이언트 + concepts API + 좌측 목록 3. dedupe 파이프라인/편집 4. 후보 축소 + 선택기 어댑터 + 다수결 5. job 러너/진행/재개 6. 테스트·모두 이전 버튼 7. override/이력 UI 8. 테스트 작성, lint/typecheck.

## 13. Open Questions
1. **JEV API**: 엔드포인트, 요청/응답 스키마, 인증 방식, 모델 id, 요금/한도. (확정 전 어댑터 TODO)
2. Claude Sonnet **정확한 모델 버전**(`CLAUDE_MODEL` 기본값). Gemini는 `gemini-4-argon`으로 확정.
3. 중복 판정 임계값(임베딩 0.92? JEV 0.8/0.5?)과 임베딩 모델, 중복 판정에 JEV 사용 여부.
4. 페이지 크기 기본값(20?).
5. KG 측 단원/엣지 테이블 실제 이름과 `math_field`→2022 영역 매핑표.
6. 비대표 멤버 개념도 KG 노드를 별도로 만들지(현재: 대표 1노드 + legacy id 메타).
7. 검토 UI 기본 제안값(현재: 2표 일치 unit, 없으면 최고 confidence).
8. 실행 환경(상시 서버 vs 서버리스) — job 러너 방식 결정.
