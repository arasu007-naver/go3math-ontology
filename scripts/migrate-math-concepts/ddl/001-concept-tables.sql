-- [초안 · 승인 전 적용 금지] 스펙 2-2절 / 4장 단계 6
-- 현행 KG(kg.nodes / kg.edges)는 노드 type 이 CHECK 로 고정되어 있고 간선에 속성(confidence·이력) 열이 없어,
-- 개념 노드와 개념→단원 엣지를 전용 테이블로 둔다. 단원은 기존 level 노드(kg.nodes.id)를 참조한다.
-- 여러 번 실행해도 안전하다.

CREATE TABLE IF NOT EXISTS kg.math_concepts (
  id                BIGSERIAL PRIMARY KEY,
  source_id         INT  NOT NULL UNIQUE,          -- 원본 math_concepts.id (병합 시 대표 id)
  merged_source_ids INT[] NOT NULL DEFAULT '{}',   -- 이 노드로 병합된 원본 id
  title             TEXT NOT NULL,                 -- raw_title
  statement         TEXT NOT NULL DEFAULT '',      -- raw_statement (원문 그대로)
  html_title        TEXT,
  html_statement    TEXT,
  concept_type      TEXT,                          -- PRINCIPLE/TARGET/SITUATION/DEFINITION/THEOREM/PROOFS/TERM/DETAIL/APPLY
  math_field        TEXT,
  curriculum_type   TEXT,
  school_type       TEXT,
  curriculum_year   TEXT,
  difficulty_level  INT,
  img_path          TEXT,
  merge_notes       JSONB NOT NULL DEFAULT '[]',   -- 병합된 개념에만 있던 본문 원문 [{source_id, raw_title, raw_statement}]
  written_by        TEXT,
  written_at        TIMESTAMP,
  source_updated_at TIMESTAMP,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT source_id = ANY (merged_source_ids))
);
CREATE INDEX IF NOT EXISTS math_concepts_merged ON kg.math_concepts USING gin (merged_source_ids);

-- 개념 → 22개정 단원 (level 노드 대단원·소단원). 기존 엣지는 지우지 않고 비활성화(이력 보존 교체).
CREATE TABLE IF NOT EXISTS kg.concept_unit_edges (
  id            BIGSERIAL PRIMARY KEY,
  concept_id    BIGINT  NOT NULL REFERENCES kg.math_concepts (id) ON DELETE CASCADE,
  unit_id       TEXT    NOT NULL REFERENCES kg.nodes (id) ON DELETE CASCADE,
  is_primary    BOOLEAN NOT NULL,
  confidence    NUMERIC(4, 3),
  judged_by     TEXT    NOT NULL,                  -- 판정 모델 (예: claude-sonnet-5-5+gemini-2.5-pro, human)
  rationale     TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  superseded_at TIMESTAMPTZ,
  superseded_by BIGINT REFERENCES kg.concept_unit_edges (id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 개념당 활성 primary 는 정확히 1개, 같은 단원으로의 활성 엣지는 1개
CREATE UNIQUE INDEX IF NOT EXISTS concept_unit_primary_active ON kg.concept_unit_edges (concept_id) WHERE is_primary AND is_active;
CREATE UNIQUE INDEX IF NOT EXISTS concept_unit_active ON kg.concept_unit_edges (concept_id, unit_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS concept_unit_by_unit ON kg.concept_unit_edges (unit_id) WHERE is_active;

-- 개념 → 성취기준 코드
CREATE TABLE IF NOT EXISTS kg.concept_achievements (
  concept_id       BIGINT NOT NULL REFERENCES kg.math_concepts (id) ON DELETE CASCADE,
  achievement_code TEXT   NOT NULL,
  judged_by        TEXT   NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (concept_id, achievement_code)
);

-- (Concept)-[:PREREQUISITE_OF]->(Concept): src 가 dst 의 선수 개념
CREATE TABLE IF NOT EXISTS kg.concept_prerequisites (
  src_concept_id BIGINT NOT NULL REFERENCES kg.math_concepts (id) ON DELETE CASCADE,
  dst_concept_id BIGINT NOT NULL REFERENCES kg.math_concepts (id) ON DELETE CASCADE,
  judged_by      TEXT   NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (src_concept_id, dst_concept_id),
  CHECK (src_concept_id <> dst_concept_id)
);
