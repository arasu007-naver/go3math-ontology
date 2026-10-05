-- TOC 중심 knowledge graph (go3math-ontology-26-10-05 스펙). 앱이 처음 접속할 때도 같은 DDL을 실행한다(여러 번 실행해도 안전).
CREATE SCHEMA IF NOT EXISTS kg;

CREATE TABLE IF NOT EXISTS kg.nodes (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  book       TEXT NOT NULL,  -- 교재 노드는 book:<stem>, 교육과정 노드는 'curriculum'
  props      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nodes_book_type ON kg.nodes (book, type);

CREATE TABLE IF NOT EXISTS kg.edges (
  src  TEXT NOT NULL REFERENCES kg.nodes (id) ON DELETE CASCADE,
  dst  TEXT NOT NULL REFERENCES kg.nodes (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  PRIMARY KEY (src, dst, type)
);
CREATE INDEX IF NOT EXISTS edges_dst ON kg.edges (dst, type);

-- 노드 종류 / 관계 종류 (스펙 갱신 시 여기만 바꾼다)
ALTER TABLE kg.nodes DROP CONSTRAINT IF EXISTS nodes_type_check;
ALTER TABLE kg.nodes ADD CONSTRAINT nodes_type_check
  CHECK (type IN ('category', 'curriculum', 'book', 'toc', 'page', 'paragraph'));
ALTER TABLE kg.edges DROP CONSTRAINT IF EXISTS edges_type_check;
ALTER TABLE kg.edges ADD CONSTRAINT edges_type_check
  CHECK (type IN (
    'CATEGORY_HAS',   -- 최상위 카테고리 → 교육과정·과목 노드
    'PREREQ_OF',      -- 과목 A → 과목 B (A 가 B 의 선수)
    'MAPS_TO',        -- 교육과정·과목 노드 → 교재 TOC 항목
    'HAS_TOC',        -- 도서 → TOC 항목
    'HAS_CHILD',      -- TOC 항목 → 하위 TOC 항목
    'POINTS_TO',      -- TOC 항목 → 페이지
    'HAS_PARAGRAPH',  -- 페이지 → 문단
    'ANSWERS'         -- 해답 문단 → 문제 문단
  ));
