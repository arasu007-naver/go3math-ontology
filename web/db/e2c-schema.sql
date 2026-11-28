-- exam2concepts(e2c) 스키마 (docs/specs/196.md). 여러 번 실행해도 안전하다.
-- 적용: npm run db:e2c
-- 기출문제 원본(MariaDB)은 읽기 전용이라 여기에는 결과·호출 기록만 둔다. problem_id = question_units.id.

CREATE SCHEMA IF NOT EXISTS e2c;

CREATE TABLE IF NOT EXISTS e2c.config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS e2c.job_run (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               TEXT    NOT NULL CHECK (kind IN ('pilot', 'run_all', 'run_ids', 'rerun_review')),
  mode               TEXT    NOT NULL CHECK (mode IN ('realtime', 'batch')),
  dry_run            BOOLEAN NOT NULL DEFAULT true,
  shadow_grok        BOOLEAN NOT NULL DEFAULT false,
  scope              JSONB   NOT NULL,
  ids                JSONB   NOT NULL DEFAULT '[]',            -- 처리 순서 (재개 시 cursor 다음부터)
  status             TEXT    NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running', 'paused', 'done', 'failed', 'cancelled')),
  total              INT     DEFAULT 0,
  processed          INT     DEFAULT 0,
  needs_review       INT     DEFAULT 0,
  failed             INT     DEFAULT 0,
  grok_unit_calls    INT     DEFAULT 0,
  grok_concept_calls INT     DEFAULT 0,
  cost_usd           NUMERIC DEFAULT 0,
  estimated_cost_usd NUMERIC DEFAULT 0,
  cache_reused_calls INT     DEFAULT 0,
  reused_by_model    JSONB   NOT NULL DEFAULT '{}',
  cached_input_tokens BIGINT DEFAULT 0,
  input_tokens       BIGINT  DEFAULT 0,
  cursor_problem_id  BIGINT,
  wave               TEXT,
  xai_batch_ids      JSONB   NOT NULL DEFAULT '[]',
  error              TEXT,
  created_by         TEXT,
  started_at         TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE e2c.job_run ADD COLUMN IF NOT EXISTS batch_ids JSONB NOT NULL DEFAULT '{}'; -- {"W1:claude": "<batch id>"}

-- 모든 모델 호출 (추가만, 덮어쓰지 않음). 같은 input_hash 의 성공 호출은 재사용한다.
CREATE TABLE IF NOT EXISTS e2c.model_call (
  id             BIGSERIAL PRIMARY KEY,
  job_run_id     UUID REFERENCES e2c.job_run (id),
  problem_id     BIGINT NOT NULL,
  stage          TEXT   NOT NULL CHECK (stage IN ('unit', 'concept', 'grok_unit', 'grok_concept')),
  role           TEXT   NOT NULL CHECK (role IN ('proposer', 'judge', 'shadow_judge')),
  adapter        TEXT   NOT NULL,                              -- jev | claude | gemini | grok
  model          TEXT,
  prompt_version TEXT   NOT NULL,
  input_hash     TEXT   NOT NULL,
  ok             BOOLEAN NOT NULL,
  error          TEXT,
  answer         JSONB,
  raw_response   JSONB,
  input_tokens   INT DEFAULT 0,
  output_tokens  INT DEFAULT 0,
  cost_usd       NUMERIC DEFAULT 0,
  latency_ms     INT,
  created_at     TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE e2c.model_call ADD COLUMN IF NOT EXISTS cached_input_tokens INT DEFAULT 0;
ALTER TABLE e2c.model_call ADD COLUMN IF NOT EXISTS cache_write_tokens INT DEFAULT 0;
ALTER TABLE e2c.model_call ADD COLUMN IF NOT EXISTS batch_id TEXT;
ALTER TABLE e2c.model_call ADD COLUMN IF NOT EXISTS batch_discount BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS model_call_hash ON e2c.model_call (input_hash) WHERE ok;
CREATE INDEX IF NOT EXISTS model_call_problem ON e2c.model_call (problem_id, created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_job ON e2c.model_call (job_run_id);

-- 문제당 1행 (현재 결과)
CREATE TABLE IF NOT EXISTS e2c.problem_result (
  problem_id          BIGINT PRIMARY KEY,
  input_hash          TEXT,
  status              TEXT NOT NULL CHECK (status IN ('auto', 'needs_review', 'error', 'skipped_no_text', 'overridden', 'confirmed', 'applied')),
  final_unit_id       TEXT,
  unit_decision_source    TEXT CHECK (unit_decision_source IN ('majority', 'grok', 'manual')),
  unit_rule           TEXT,
  primary_concept_id  TEXT,
  secondary_concept_ids JSONB NOT NULL DEFAULT '[]',
  concept_decision_source TEXT CHECK (concept_decision_source IN ('majority', 'grok', 'manual')),
  reasons             JSONB NOT NULL DEFAULT '[]',
  truncated           BOOLEAN DEFAULT false,
  candidate_fallback  BOOLEAN DEFAULT false,
  unit_detail         JSONB,
  concept_detail      JSONB,
  error               TEXT,
  rerun_concept       BOOLEAN NOT NULL DEFAULT false,
  last_job_run_id     UUID,
  updated_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS problem_result_status ON e2c.problem_result (status);

-- 수동 수정 이력
CREATE TABLE IF NOT EXISTS e2c.manual_override (
  id         BIGSERIAL PRIMARY KEY,
  problem_id BIGINT NOT NULL,
  before     JSONB,
  after      JSONB,
  reason     TEXT NOT NULL,
  actor      TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manual_override_problem ON e2c.manual_override (problem_id, created_at DESC);

-- 파일럿 정답 라벨
CREATE TABLE IF NOT EXISTS e2c.pilot_label (
  problem_id            BIGINT PRIMARY KEY,
  unit_id               TEXT NOT NULL,
  primary_concept_id    TEXT NOT NULL,
  secondary_concept_ids JSONB NOT NULL DEFAULT '[]',
  labeler               TEXT,
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- 개념 option text 캐시 (설명 첫 문장 auto / 수동 수정 manual)
CREATE TABLE IF NOT EXISTS e2c.concept_option_text (
  concept_id TEXT PRIMARY KEY,
  text       TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 임베딩 캐시: sha256(model+text) → vector
CREATE TABLE IF NOT EXISTS e2c.embedding_cache (
  text_hash  TEXT PRIMARY KEY,
  model      TEXT NOT NULL,
  vector     JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
