-- legacy2ontology 페이지용 스키마 (specs/math_concepts2ontology.md 4장). 여러 번 실행해도 안전하다.
-- 적용: npm run db:l2o
-- KG 개념 노드는 kg.math_concepts, 개념→단원 엣지는 kg.concept_unit_edges 를 재사용한다(scripts/migrate-math-concepts/ddl/001).

CREATE SCHEMA IF NOT EXISTS l2o;

-- 4.1 중복 묶음
CREATE TABLE IF NOT EXISTS l2o.dedupe_group (
  id                       BIGSERIAL PRIMARY KEY,
  representative_legacy_id BIGINT NOT NULL,
  method                   TEXT   NOT NULL CHECK (method IN ('exact', 'embedding', 'jev', 'manual')),
  status                   TEXT   NOT NULL DEFAULT 'auto' CHECK (status IN ('auto', 'confirmed', 'needs_review')),
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS l2o.dedupe_member (
  legacy_concept_id BIGINT PRIMARY KEY,            -- 개념은 정확히 1개 그룹에 소속(단독도 1인 그룹)
  group_id          BIGINT NOT NULL REFERENCES l2o.dedupe_group (id),
  similarity        REAL,                          -- 대표와의 유사도
  added_by          TEXT   NOT NULL DEFAULT 'system'
);
CREATE INDEX IF NOT EXISTS dedupe_member_group ON l2o.dedupe_member (group_id);

CREATE TABLE IF NOT EXISTS l2o.dedupe_history (
  id         BIGSERIAL PRIMARY KEY,
  group_id   BIGINT,
  action     TEXT NOT NULL,                        -- merge | split | set_rep | create
  before     JSONB,
  after      JSONB,
  actor      TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 중복제거 후보 쌍의 JEV 판정 (재실행 시 재사용 → 결과 고정, 재호출 없음). a < b.
CREATE TABLE IF NOT EXISTS l2o.dedupe_pair (
  a          BIGINT NOT NULL,
  b          BIGINT NOT NULL,
  similarity REAL,
  same_prob  REAL   NOT NULL,
  model      TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (a, b),
  CHECK (a < b)
);

-- 4.2 작업 실행
CREATE TABLE IF NOT EXISTS l2o.job_run (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             TEXT    NOT NULL CHECK (kind IN ('dedupe', 'test', 'migrate_all', 'migrate_one')),
  dry_run          BOOLEAN NOT NULL DEFAULT false,
  scope            JSONB   NOT NULL,               -- {page, pageSize} | {ids:[...]} | {all:true}
  status           TEXT    NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'running', 'paused', 'done', 'failed', 'cancelled')),
  total            INT DEFAULT 0,
  processed        INT DEFAULT 0,
  succeeded        INT DEFAULT 0,
  failed           INT DEFAULT 0,
  needs_review     INT DEFAULT 0,
  cursor_legacy_id BIGINT,                         -- 재개 지점
  error            TEXT,
  created_by       TEXT,
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- 4.3 선택기 투표 (모든 호출 기록, 덮어쓰지 않음)
CREATE TABLE IF NOT EXISTS l2o.selector_vote (
  id                 BIGSERIAL PRIMARY KEY,
  job_run_id         UUID REFERENCES l2o.job_run (id),
  group_id           BIGINT NOT NULL REFERENCES l2o.dedupe_group (id),
  selector           TEXT   NOT NULL CHECK (selector IN ('jev', 'claude', 'gemini')),
  model              TEXT,
  model_version      TEXT,
  prompt_version     TEXT   NOT NULL,
  candidate_unit_ids TEXT[] NOT NULL,
  selected_unit_id   TEXT,                         -- 후보 밖이면 null + error='out_of_candidates'
  confidence         REAL,                         -- 0..1 (JEV 확률 / LLM 자기보고)
  scores             JSONB,                        -- {unitId: score}
  raw_response       JSONB,
  latency_ms         INT,
  error              TEXT,
  input_hash         TEXT   NOT NULL,              -- 개념+후보+prompt_version 해시 (멱등 키)
  created_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS selector_vote_group_selector ON l2o.selector_vote (group_id, selector, created_at DESC);
ALTER TABLE l2o.selector_vote ADD COLUMN IF NOT EXISTS candidate_fallback BOOLEAN NOT NULL DEFAULT false; -- 5.2: 필터 결과 부족해 학교급 전체로 확장
CREATE INDEX IF NOT EXISTS selector_vote_hash ON l2o.selector_vote (input_hash) WHERE error IS NULL;

-- 4.4 이전 결과 (대표 그룹당 1행, 현재 상태)
CREATE TABLE IF NOT EXISTS l2o.migration_result (
  group_id         BIGINT PRIMARY KEY REFERENCES l2o.dedupe_group (id),
  status           TEXT NOT NULL
                   CHECK (status IN ('pending', 'auto_agreed', 'needs_review', 'overridden', 'migrated', 'error')),
  majority_unit_id TEXT,
  agree_count      INT,
  final_unit_id    TEXT,                           -- override 가 있으면 override 값
  kg_concept_id    BIGINT REFERENCES kg.math_concepts (id),
  dry_run_only     BOOLEAN DEFAULT false,
  last_job_run_id  UUID,
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- 4.5 수동 수정 이력
CREATE TABLE IF NOT EXISTS l2o.unit_override (
  id               BIGSERIAL PRIMARY KEY,
  group_id         BIGINT NOT NULL,
  previous_unit_id TEXT,
  new_unit_id      TEXT NOT NULL,
  reason           TEXT,
  actor            TEXT NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- 4.6 KG 엣지: is_active / superseded_at(=비활성화 시각) 은 이미 있다. 비활성화한 job 과 기록 출처만 추가.
ALTER TABLE kg.concept_unit_edges ADD COLUMN IF NOT EXISTS deactivated_by_job UUID;
ALTER TABLE kg.concept_unit_edges ADD COLUMN IF NOT EXISTS source TEXT;   -- 'legacy2ontology' 등
