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
  CHECK (type IN ('category', 'curriculum', 'book', 'toc', 'page', 'paragraph',
                  'level',       -- Level 1~5 노드 (level-spec.md)
                  'study_doc')); -- L1-STUDY 아래 메타 문서 노드
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
    'ANSWERS',        -- 해답 문단 → 문제 문단
    -- level-spec.md (HAS_CHILD, MAPS_TO 는 위와 같은 이름을 level 노드에도 쓴다)
    'BELONGS_TO_AREA', -- L3·L4 → L1 영역 소속
    'PREREQUISITE_OF', -- L3~L5 A → B (A 가 B 의 선수)
    'DESCRIBES'        -- L1-STUDY 문서 노드 → 과목(L3)
  ));

-- ---------- Level 1~5 (level-spec.md) ----------
-- level 노드 id 는 L1-/L2-/L3-/L4-/L5- 접두사, 문서 노드 id 는 doc: 접두사. 트리거가 이 접두사로 level 관련 행만 골라 검사한다.

-- 고정 Level 1 일곱 + Level 2 PREREQUISITE 여섯. 바꾸려면 level-spec.md 를 고친 뒤 여기를 고친다.
CREATE OR REPLACE FUNCTION kg.level_fixed()
RETURNS TABLE (id text, level int, ord int, name text, parent text) LANGUAGE sql IMMUTABLE AS $$
  VALUES
    ('L1-STUDY', 1, 1, '수학 학습', NULL::text),
    ('L1-NUM',   1, 2, '수와 연산', NULL),
    ('L1-EXPR',  1, 3, '식과 계산', NULL),
    ('L1-EQ',    1, 4, '방정식과 부등식', NULL),
    ('L1-FUNC',  1, 5, '함수', NULL),
    ('L1-PROB',  1, 6, '경우의 수·확률·통계', NULL),
    ('L1-GEO',   1, 7, '도형', NULL),
    ('L2-NUM-PRE',  2, 1, 'PREREQUISITE', 'L1-NUM'),
    ('L2-EXPR-PRE', 2, 1, 'PREREQUISITE', 'L1-EXPR'),
    ('L2-EQ-PRE',   2, 1, 'PREREQUISITE', 'L1-EQ'),
    ('L2-FUNC-PRE', 2, 1, 'PREREQUISITE', 'L1-FUNC'),
    ('L2-PROB-PRE', 2, 1, 'PREREQUISITE', 'L1-PROB'),
    ('L2-GEO-PRE',  2, 1, 'PREREQUISITE', 'L1-GEO')
$$;

-- 노드 필드: id 접두사 = level, name·order 필수, kind 는 L5 만, school·curriculum 은 L3 만
ALTER TABLE kg.nodes DROP CONSTRAINT IF EXISTS nodes_level_check;
ALTER TABLE kg.nodes ADD CONSTRAINT nodes_level_check CHECK (
  (type = 'level') = (id ~ '^L[1-5]-')
  AND (type = 'study_doc') = (id LIKE 'doc:%')
  AND (type <> 'level' OR COALESCE(
        props->>'level' IN ('1', '2', '3', '4', '5')
        AND left(id, 3) = 'L' || (props->>'level') || '-'
        AND length(btrim(props->>'name')) > 0
        AND jsonb_typeof(props->'order') = 'number'
        AND (props ? 'kind') = (props->>'level' = '5')
        AND (props->>'level' <> '5' OR props->>'kind' IN ('concept', 'theorem', 'property', 'formula', 'definition'))
        AND (props ? 'school') = (props->>'level' = '3')
        AND (props ? 'curriculum') = (props->>'level' = '3')
        AND (props->>'level' <> '3' OR (props->>'school' IN ('middle', 'high') AND length(btrim(props->>'curriculum')) > 0)),
      false))
);

-- Level 1·2 는 고정 시드 그대로만 넣을 수 있고, 고치거나 지울 수 없다
CREATE OR REPLACE FUNCTION kg.level_node_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.id ~ '^L[12]-' THEN
    RAISE EXCEPTION 'Level 1·2 노드는 바꿀 수 없습니다: %', OLD.id;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.id ~ '^L[12]-' AND NOT EXISTS (
    SELECT 1 FROM kg.level_fixed() f
    WHERE f.id = NEW.id AND f.level::text = NEW.props->>'level' AND f.ord::text = NEW.props->>'order' AND f.name = NEW.props->>'name'
  ) THEN
    RAISE EXCEPTION 'Level 1·2 는 고정 시드만 넣을 수 있습니다: %', NEW.id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- 관계 규칙. HAS_CHILD 의 단계 검사는 노드와 간선을 한 트랜잭션에 넣을 수 있도록 커밋 때(kg.check_level_node) 한다.
CREATE OR REPLACE FUNCTION kg.level_edge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  st text; sl int; dt text; dl int;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.type = 'HAS_CHILD' AND EXISTS (SELECT 1 FROM kg.level_fixed() f WHERE f.id = OLD.dst AND f.parent = OLD.src) THEN
    RAISE EXCEPTION 'Level 1→2 간선은 바꿀 수 없습니다: % → %', OLD.src, OLD.dst;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND (OLD.src ~ '^(L[1-5]-|doc:)' OR OLD.dst ~ '^(L[1-5]-|doc:)') THEN
    RAISE EXCEPTION 'level 간선은 고칠 수 없습니다. 지우고 다시 넣으세요: % → %', OLD.src, OLD.dst;
  END IF;
  IF NOT (NEW.src ~ '^(L[1-5]-|doc:)' OR NEW.dst ~ '^(L[1-5]-|doc:)'
          OR NEW.type IN ('BELONGS_TO_AREA', 'PREREQUISITE_OF', 'DESCRIBES')) THEN
    RETURN NEW;
  END IF;

  SELECT type, (props->>'level')::int INTO st, sl FROM kg.nodes WHERE id = NEW.src;
  SELECT type, (props->>'level')::int INTO dt, dl FROM kg.nodes WHERE id = NEW.dst;
  IF st IS NULL OR dt IS NULL THEN RETURN NEW; END IF; -- 없는 노드는 외래키가 거부한다

  IF NEW.type = 'HAS_CHILD' THEN
    IF NOT (st = 'level' AND (dt = 'level' OR (dt = 'study_doc' AND NEW.src = 'L1-STUDY'))) THEN
      RAISE EXCEPTION 'HAS_CHILD 는 level 노드 사이(또는 L1-STUDY → 문서 노드)만 됩니다: % → %', NEW.src, NEW.dst;
    END IF;
  ELSIF NEW.type = 'BELONGS_TO_AREA' THEN
    IF NOT (st = 'level' AND sl IN (3, 4) AND dt = 'level' AND dl = 1 AND NEW.dst <> 'L1-STUDY') THEN
      RAISE EXCEPTION 'BELONGS_TO_AREA 는 L3·L4 → L1(L1-STUDY 제외)만 됩니다: % → %', NEW.src, NEW.dst;
    END IF;
  ELSIF NEW.type = 'PREREQUISITE_OF' THEN
    IF NOT (st = 'level' AND dt = 'level' AND sl >= 3 AND dl >= 3 AND dl <= sl) THEN
      RAISE EXCEPTION 'PREREQUISITE_OF 는 L3~L5 → 같은 또는 상위 단계 노드만 됩니다: % → %', NEW.src, NEW.dst;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('kg.PREREQUISITE_OF')); -- 동시 입력이 서로 모르고 순환을 만들지 않게
    IF EXISTS (
      WITH RECURSIVE r(id) AS (
        SELECT NEW.dst
        UNION SELECT e.dst FROM kg.edges e JOIN r ON e.src = r.id WHERE e.type = 'PREREQUISITE_OF'
      ) SELECT 1 FROM r WHERE id = NEW.src
    ) THEN
      RAISE EXCEPTION '선수 관계에 순환이 생깁니다: % → %', NEW.src, NEW.dst;
    END IF;
  ELSIF NEW.type = 'MAPS_TO' THEN
    IF NOT (st IN ('toc', 'paragraph') AND dt = 'level' AND dl IN (4, 5)) THEN
      RAISE EXCEPTION 'MAPS_TO 는 교재 TOC 항목·문단 → L4·L5 만 됩니다: % → %', NEW.src, NEW.dst;
    END IF;
  ELSIF NEW.type = 'DESCRIBES' THEN
    IF NOT (st = 'study_doc' AND dt = 'level' AND dl = 3) THEN
      RAISE EXCEPTION 'DESCRIBES 는 문서 노드 → 과목(L3)만 됩니다: % → %', NEW.src, NEW.dst;
    END IF;
  ELSE
    RAISE EXCEPTION '% 관계는 level 노드에 쓸 수 없습니다: % → %', NEW.type, NEW.src, NEW.dst;
  END IF;
  RETURN NEW;
END $$;

-- 한 노드의 상위(HAS_CHILD) 검사: L2 는 고정 L1 하나, L3 중등은 L2 아래·고등은 L1(L1-STUDY 제외) 아래(여러 개 가능),
-- L4 는 L3 하나, L5 는 L4 하나, 문서 노드는 L1-STUDY 아래
CREATE OR REPLACE FUNCTION kg.check_level_node(nid text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  n kg.nodes; lv int; cnt int; bad text;
BEGIN
  SELECT * INTO n FROM kg.nodes WHERE id = nid;
  IF NOT FOUND OR n.type NOT IN ('level', 'study_doc') THEN RETURN; END IF;
  lv := (n.props->>'level')::int;
  IF lv = 1 THEN RETURN; END IF;

  SELECT count(*), string_agg(e.src, ', ') FILTER (WHERE NOT CASE
           WHEN n.type = 'study_doc' THEN e.src = 'L1-STUDY'
           WHEN lv = 2 THEN e.src = (SELECT f.parent FROM kg.level_fixed() f WHERE f.id = nid)
           WHEN lv = 3 AND n.props->>'school' = 'middle' THEN e.src LIKE 'L2-%'
           WHEN lv = 3 THEN e.src LIKE 'L1-%' AND e.src <> 'L1-STUDY'
           ELSE e.src LIKE 'L' || (lv - 1) || '-%'
         END)
    INTO cnt, bad
  FROM kg.edges e WHERE e.dst = nid AND e.type = 'HAS_CHILD';

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '% 의 상위 노드가 규칙에 맞지 않습니다: %', nid, bad;
  ELSIF cnt = 0 THEN
    RAISE EXCEPTION '% 에 상위 노드(HAS_CHILD)가 없습니다', nid;
  ELSIF lv IN (2, 4, 5) AND cnt > 1 THEN
    RAISE EXCEPTION '% 는 상위 노드를 하나만 가질 수 있습니다', nid;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION kg.level_check_deferred() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'nodes' THEN
    PERFORM kg.check_level_node(NEW.id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM kg.check_level_node(OLD.dst);
  ELSE
    PERFORM kg.check_level_node(NEW.dst);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS level_node_guard ON kg.nodes;
CREATE TRIGGER level_node_guard BEFORE INSERT OR UPDATE OR DELETE ON kg.nodes
  FOR EACH ROW EXECUTE FUNCTION kg.level_node_guard();
DROP TRIGGER IF EXISTS level_edge_guard ON kg.edges;
CREATE TRIGGER level_edge_guard BEFORE INSERT OR UPDATE OR DELETE ON kg.edges
  FOR EACH ROW EXECUTE FUNCTION kg.level_edge_guard();
DROP TRIGGER IF EXISTS level_node_parent ON kg.nodes;
CREATE CONSTRAINT TRIGGER level_node_parent AFTER INSERT OR UPDATE ON kg.nodes DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.type IN ('level', 'study_doc')) EXECUTE FUNCTION kg.level_check_deferred();
DROP TRIGGER IF EXISTS level_edge_parent_add ON kg.edges;
CREATE CONSTRAINT TRIGGER level_edge_parent_add AFTER INSERT ON kg.edges DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.type = 'HAS_CHILD' AND NEW.dst ~ '^(L[1-5]-|doc:)') EXECUTE FUNCTION kg.level_check_deferred();
DROP TRIGGER IF EXISTS level_edge_parent_del ON kg.edges;
CREATE CONSTRAINT TRIGGER level_edge_parent_del AFTER DELETE ON kg.edges DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD.type = 'HAS_CHILD' AND OLD.dst ~ '^(L[1-5]-|doc:)') EXECUTE FUNCTION kg.level_check_deferred();

-- 시드: 없으면 만들고, 있으면 그대로 둔다
INSERT INTO kg.nodes (id, type, book, props)
SELECT f.id, 'level', 'level', jsonb_build_object('level', f.level, 'order', f.ord, 'name', f.name) FROM kg.level_fixed() f
ON CONFLICT (id) DO NOTHING;
INSERT INTO kg.edges (src, dst, type)
SELECT f.parent, f.id, 'HAS_CHILD' FROM kg.level_fixed() f WHERE f.parent IS NOT NULL
ON CONFLICT DO NOTHING;
