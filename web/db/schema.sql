-- TOC 중심 knowledge graph (go3math-ontology-26-10-05 스펙). 앱이 처음 접속할 때도 같은 DDL을 실행한다.
CREATE SCHEMA IF NOT EXISTS kg;

CREATE TABLE IF NOT EXISTS kg.nodes (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('book', 'toc', 'page', 'paragraph')),
  book       TEXT NOT NULL,
  props      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nodes_book_type ON kg.nodes (book, type);

CREATE TABLE IF NOT EXISTS kg.edges (
  src  TEXT NOT NULL REFERENCES kg.nodes (id) ON DELETE CASCADE,
  dst  TEXT NOT NULL REFERENCES kg.nodes (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('HAS_TOC', 'HAS_CHILD', 'POINTS_TO', 'HAS_PARAGRAPH', 'ANSWERS')),
  PRIMARY KEY (src, dst, type)
);
CREATE INDEX IF NOT EXISTS edges_dst ON kg.edges (dst, type);
