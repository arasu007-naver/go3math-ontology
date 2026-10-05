# go3math-ontology web

`../go3math-ontology-26-10-05.md` 스펙의 TOC 중심 knowledge graph에 기존 도서(unlimited-ocr 페이지 JSON)를 넣는 입력 폼.

- 상단: ocr.html과 같은 BookToc(작성자별) / TOC 문서 목록 + 페이지네이션
- 왼쪽: ocr.html과 같은 미리보기(본문/해설서, 180° 회전, 페이지 이동, JSON 미추출 수) + 페이지 추출 JSON(main / batch 경로, 없으면 다른 경로 자동 조회)
- 오른쪽: 그래프 입력 폼
  1. 도서·TOC: 도서명, 시작 교재 순서(1~5), 페이지 보정값 → 도서 노드 + TOC 항목 노드(장/절/항목) 저장
  2. 페이지: 이 페이지를 가리킬 TOC 항목(페이지 범위로 자동 선택, 변경 가능)
  3. 문단: 추출 JSON 항목별 포함 여부, 종류(정의·공식·성질·문제·해답), 내용 편집, 해답 → 문제 연결

## 실행

```bash
cp .env.example .env.local   # OCR_BACKEND_URL 등
npm install
npm run dev
```

BookToc 목록은 서버 라우트 `/api/book-toc/*`가 `API_V3_URL`(apiv3.qoolla.com)을 직접 호출한다. v3는 Bearer 토큰이 필요해 `API_V3_EMAIL`/`API_V3_PASSWORD`로 서버에서 로그인하고 토큰을 캐시한다(브라우저로 나가지 않음).

unlimited-ocr API는 `/api/ocr/*` → `${OCR_BACKEND_URL}/api/*` 로 프록시한다. unlimited-ocr 로그인 쿠키(`unlimited_ocr_session`)가 필요하다. localhost에서는 포트가 달라도 쿠키가 공유되므로 unlimited-ocr에 로그인한 브라우저에서 열면 된다.

## 그래프 저장소

Postgres, 스키마 `kg` (`db/schema.sql`). 앱이 처음 DB에 접속할 때 같은 DDL(`CREATE ... IF NOT EXISTS`)을 실행한다. 접속 정보는 `DATABASE_URL`, 없으면 `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`. 테이블은 `kg.nodes(id, type, book, props jsonb, updated_at)` / `kg.edges(src, dst, type)`.

| 노드 id | 예 |
|---|---|
| `book:<stem>` | `book:이론 수학 대전` |
| `toc:<stem>:<장>/<절>/<항목순번>` | `toc:이론 수학 대전:제6장/6.2/4` |
| `page:<stem>:<main\|commentary>:<n>` | `page:이론 수학 대전:main:211` |
| `para:<stem>:<kind>:<n>:<JSON items 위치>` | `para:이론 수학 대전:main:211:3` |

간선(스펙의 5가지만): `HAS_TOC`(도서→TOC), `HAS_CHILD`(TOC→하위 TOC), `POINTS_TO`(TOC→페이지), `HAS_PARAGRAPH`(페이지→문단), `ANSWERS`(해답→문제).

문단 id는 추출 JSON 안의 위치를 쓰므로 일부 문단을 빼고 다시 저장해도 다른 페이지의 해답 연결이 엉뚱한 문단으로 옮겨가지 않는다. 문제가 아닌 종류로 바뀐 문단을 가리키던 해답 연결은 끊긴다.
