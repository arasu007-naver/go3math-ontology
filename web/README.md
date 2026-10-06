# go3math-ontology web

`../go3math-ontology-26-10-05.md` 스펙의 TOC 중심 knowledge graph 서비스.

| 화면 | 내용 |
|---|---|
| `/login` | Office-Manager(coo.qoolla.com) 계정 로그인 |
| `/` 도서 입력 | ocr.html과 같은 BookToc·TOC 문서 목록, 미리보기, 페이지 추출 JSON + 오른쪽 그래프 입력 폼(도서·TOC / 페이지 / 교육과정·과목 대응 / 문단) |
| `/network` 과목 그물 | 최상위 7개 카테고리와 교육과정·과목 노드, 선수 관계를 네트워크 그래프로 보기·편집 |
| `/agent` 에이전트 | 자연어 → 그래프 쿼리 생성(Claude) → 실행 → 결과(노드 URL)를 표로 보여 줌 |
| `/node?id=` | 노드 하나의 내용(문단 본문, 페이지 이미지)과 연결 |

## 실행

```bash
cp .env.example .env.local   # 값 채우기
npm install
npm run db:setup             # kg 스키마 + 7개 카테고리·과목 초기값 (여러 번 실행해도 안전)
npm run db:import-middle     # 중등 과목(L3)·대단원(L4): db/level-middle.json → 해당 영역 PREREQUISITE(L2) 아래
npm run db:import-high       # 고등 과목(L3): db/level-high.json → 해당 영역 Level 1 바로 아래 (과목에 educationalStep=교육과정 연도)
npm run db:import-prereq     # 대단원(L4) 선수 관계: db/level-prereq.json → PREREQUISITE_OF (개념연결 지도 화살표)
npm run dev                  # http://localhost:3310 (3000·3001 은 다른 서비스가 사용 중)
```

## 인증

- 로그인: `POST /api/auth/login` 이 서버에서 Office-Manager NextAuth 흐름을 호출한다(`/api/auth/csrf` → `/api/auth/callback/credentials` → `/api/auth/session`). unlimited-ocr `app.py` 의 `authenticate_with_office_manager` 와 같은 흐름.
- apiv3 토큰: 로그인 때 Office-Manager 세션 응답으로 받은 `token`(모든 서비스가 공유하는 토큰). apiv3 를 호출할 때 `Authorization: Bearer <token>` 으로 붙인다. apiv3 에 따로 로그인하지 않는다. 세션에 token 이 없으면 로그인 실패.
- unlimited-ocr 도 같은 공유 토큰을 Bearer 로 받는다. unlimited-ocr `.env` 에 `SHARED_JWT_SECRET`(= office-manager `JWT_SECRET`)이 있어야 검증된다.
- 토큰은 AES-256-GCM 으로 암호화한 HttpOnly 쿠키(`g3o_session`)에만 있고, 서버 라우트(`/api/book-toc/*`, `/api/ocr/*`)가 붙여 호출한다. 비밀번호는 저장하지 않는다.
- BookToc 목록(`/api/book-toc/[page]`)의 작성자는 로그인한 사용자 아이디(Office-Manager `user.id`)로 서버가 정한다. 브라우저에서 바꿀 수 없다.
- 세션 만료 = 그 토큰의 `exp`. 만료·위조·로그아웃이면 `src/proxy.ts` 가 화면은 `/login` 으로, API 는 401 로 보낸다. apiv3 가 토큰을 거부해도 401 → 로그인 페이지.

## 그래프 저장소

Postgres 스키마 `kg` (`db/schema.sql`). `kg.nodes(id, type, book, props jsonb)` / `kg.edges(src, dst, type)`.

| 노드 id | 예 |
|---|---|
| `cat:<이름>` 최상위 카테고리 | `cat:함수` |
| `cur:<이름>` 교육과정·과목 | `cur:미적분I` |
| `book:<stem>` | `book:이론 수학 대전` |
| `toc:<stem>:<장>/<절>/<항목순번>` | `toc:이론 수학 대전:제6장/6.2/4` |
| `page:<stem>:<main\|commentary>:<n>` | `page:이론 수학 대전:main:211` |
| `para:<stem>:<kind>:<n>:<JSON items 위치>` | `para:이론 수학 대전:main:211:3` |

관계(스펙 시작 범위 8가지): `CATEGORY_HAS`(카테고리→과목), `PREREQ_OF`(선수 과목→과목, 순환 금지), `MAPS_TO`(과목→TOC 항목), `HAS_TOC`, `HAS_CHILD`, `POINTS_TO`, `HAS_PARAGRAPH`, `ANSWERS`(해답→문제).

교육과정 초기값(`db/curriculum-seed.json`)은 2022 개정 교육과정 기준의 출발점이다. `/network` 에서 고친다.

## 에이전트

질문 하나를 아래 순서로 처리한다. 어느 모델에도 문단 본문과 쿼리 결과는 보내지 않는다(질문, 템플릿 설명, 카테고리·과목·도서 이름만).

1. **Jev** (`JEV_KEY`): 한 번 호출로 `in_scope`(noul), 템플릿(choice), 과목·카테고리·도서·문단 종류(choice, 그래프에 있는 이름만)를 고른다.
   - `in_scope < 0.1` → "그래프에 없는 내용입니다."
   - 템플릿 확신 ≥ 0.6, 필요한 인자 확신 ≥ 0.5, 키워드가 필요 없는 템플릿 → 바로 실행
2. **로컬 LLM** (`GO3_LLM_BASE_URL`, `LOCAL_LLM_MODEL`=Qwen3.6-35B-A3B): Jev 가 실패했거나 확신이 낮거나 주제어 검색이 필요할 때. JSON schema(이름 인자는 enum)로 템플릿·인자·키워드를 정한다. SQL 은 쓰지 않는다.
   - 그 계획을 **Jev 가 다시 판정**(noul ≥ 0.5)해야 실행. Jev 가 안 되면 그대로 실행.
3. **Claude** (`claude-opus-5`): 위에서 못 정하면 SQL 을 직접 만든다. SELECT/WITH 한 문장, 위험 함수 차단, `EXPLAIN` 으로 `kg` 밖 테이블 차단, READ ONLY + 5초 + 100행.

템플릿(`src/lib/server/agentTemplates.ts`): 선수과목, 후속과목, 카테고리의 과목, 과목에 대응된 TOC, 과목의 문단(종류별), 도서 목차, 주제어 문단 검색, 주제어 TOC 검색, 주제어 문제+해답. 주제어 비교는 공백을 무시한다(나머지정리 = 나머지 정리).

결과의 노드 id 는 `/node?id=` URL 로 바뀌어 프론트가 연다. 결과가 없으면 "그래프에 없는 내용입니다.", 세 단계가 모두 실패하면 "지금은 답할 수 없습니다." 화면에 처리 경로(어느 단계가 답했는지)를 보여 준다.
