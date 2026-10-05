import type { Catalog } from "./agentTemplates";

// 모델에게 주는 것은 스키마와 이름 목록(카테고리·과목·도서)뿐이다. 문단 본문과 쿼리 결과는 모델에 넣지 않는다.
export const SCHEMA_DOC = `
Postgres, search_path = kg. 테이블 2개뿐이다.

kg.nodes(id text PK, type text, book text, props jsonb, updated_at timestamptz)
kg.edges(src text → nodes.id, dst text → nodes.id, type text)

노드 type 과 props:
- category   : id 'cat:<이름>'  props {name, order}  — 최상위 7개 카테고리
- curriculum : id 'cur:<이름>'  props {name, level('메타'|'중등'|'대입'), order}  — 교육과정·과목 노드
- book       : id 'book:<stem>' props {title, stem, documentId, sourceOrder, pageOffset}
- toc        : id 'toc:<stem>:<key>' props {key, level('chapter'|'section'|'item'), label, page(인쇄 페이지), order}
- page       : id 'page:<stem>:<main|commentary>:<n>' props {kind, page(PDF 페이지), jsonKey, imageUrl}
- paragraph  : id 'para:<stem>:<kind>:<n>:<idx>' props {idx, kind('정의'|'공식'|'성질'|'문제'|'해답'), category, content}
  (content 는 AsciiMath 를 백틱으로 감싼 텍스트. 검색은 props->>'content' ILIKE 로 한다)
book 컬럼: 교재 노드는 소속 도서 id('book:<stem>'), category/curriculum 노드는 'curriculum'.

간선 type (src → dst):
- CATEGORY_HAS  : category → curriculum
- PREREQ_OF     : curriculum A → curriculum B (A 가 B 의 선수과목)
- MAPS_TO       : curriculum → toc
- HAS_TOC       : book → toc(장)
- HAS_CHILD     : toc → 하위 toc
- POINTS_TO     : toc → page
- HAS_PARAGRAPH : page → paragraph
- ANSWERS       : paragraph(해답) → paragraph(문제)
`;

export const RULES = `
너는 Go3 Math 교재 knowledge graph 의 질의 생성기다. 사용자의 질문을 위 스키마에 대한 SELECT 문 하나로 바꾼다.
- 그래프에 있는 내용만 대상이다. 그래프로 찾을 수 없는 질문(일반 지식, 풀이 작성, 교재 밖 해설, 학습 계획 등)이면 answerable=false 로 하고 sql 은 빈 문자열로 둔다.
- 결과에는 근거가 되는 노드 id 컬럼을 넣는다. 문단·페이지를 찾는 질문이면 book_id, toc_id(있으면), page_id, 필요하면 paragraph_id 를, 과목·카테고리 질문이면 해당 cat/cur id 를 넣는다. 사람이 읽을 이름 컬럼(도서명, TOC label, 페이지 번호, 과목명)도 함께 넣는다.
- 컬럼 이름은 영어 snake_case 로 짓는다. 행은 의미 있는 순서로 정렬한다. LIMIT 은 100 이하.
- 이름 비교는 정확한 이름 목록이 아래에 있으면 그 값을 쓰고, 아니면 ILIKE '%...%' 로 찾는다.
- SELECT 또는 WITH 로 시작하는 문장 하나만. kg 스키마 밖은 쓰지 않는다.
- summary 에는 이 쿼리가 무엇을 찾는지 한국어 한 문장으로 쓴다(결과를 지어내지 않는다).
`;

export function catalogText(c: Catalog) {
  return [
    `카테고리: ${c.categories.join(", ") || "(없음)"}`,
    `교육과정·과목: ${c.curriculum.map((x) => `${x.name}(${x.level})`).join(", ") || "(없음)"}`,
    `도서: ${c.books.map((b) => `${b.title} [id=${b.id}]`).join(", ") || "(없음)"}`,
  ].join("\n");
}
