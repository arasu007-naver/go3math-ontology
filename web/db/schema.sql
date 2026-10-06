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
                  'level')); -- Level 1~5 노드 (level-spec.md)
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
    'APPLIES_TO',      -- 수학 학습 과목 아래 L4·L5 → 그 전략·방법이 쓰이는 수학 L3~L5
    'DESCRIBES'        -- 교육과정(L3-STUDY-CURR) 아래 L4·L5 → 수학 과목(L3)
  ));

-- ---------- Level 1~5 (level-spec.md) ----------
-- level 노드 id 는 L1-/L2-/L3-/L4-/L5- 접두사. 트리거가 이 접두사로 level 관련 행만 골라 검사한다.
-- 수학 학습 과목은 L3-STUDY-* 고정 id 로 L1-STUDY 바로 아래에 있고, 그 아래 L4·L5 를 "수학 학습 쪽" 노드라 부른다.

-- 고정 Level 1 일곱 + Level 2 PREREQUISITE 여섯 + 수학 학습 과목(L3) 넷. 바꾸려면 level-spec.md 를 고친 뒤 여기를 고친다.
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
    ('L2-GEO-PRE',  2, 1, 'PREREQUISITE', 'L1-GEO'),
    ('L3-STUDY-PSS',   3, 1, '문제 해결 전략', 'L1-STUDY'),
    ('L3-STUDY-CURR',  3, 2, '교육과정',       'L1-STUDY'),
    ('L3-STUDY-LEARN', 3, 3, '학습법',         'L1-STUDY'),
    ('L3-STUDY-TEACH', 3, 4, '교습법',         'L1-STUDY')
$$;

-- 노드가 수학 학습 쪽이면 그 L3-STUDY-* 과목 id, 아니면 NULL (L3 자신, L4 의 상위, L5 의 상위의 상위로 찾는다)
CREATE OR REPLACE FUNCTION kg.level_study_subject(nid text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN nid LIKE 'L3-STUDY-%' THEN nid
    WHEN nid LIKE 'L4-%' THEN (SELECT e.src FROM kg.edges e WHERE e.dst = nid AND e.type = 'HAS_CHILD' AND e.src LIKE 'L3-STUDY-%' LIMIT 1)
    WHEN nid LIKE 'L5-%' THEN (SELECT p.src FROM kg.edges e JOIN kg.edges p ON p.dst = e.src AND p.type = 'HAS_CHILD'
                               WHERE e.dst = nid AND e.type = 'HAS_CHILD' AND p.src LIKE 'L3-STUDY-%' LIMIT 1)
  END
$$;

-- 노드 필드: id 접두사 = level, name·order 필수, kind 는 L5 만, school·curriculum·educationalStep 은 L3 수학 과목만
-- (L5 kind 가 수학 쪽 값인지 수학 학습 쪽 값인지는 상위를 봐야 하므로 kg.check_level_node 가 커밋 때 검사한다)
-- educationalStep(교육과정 연도, 정수) 추가 전에 넣은 L3 는 curriculum 의 연도로 채운다
UPDATE kg.nodes SET props = props || jsonb_build_object('educationalStep', substring(props->>'curriculum' from '^\d{4}')::int)
WHERE type = 'level' AND props->>'level' = '3' AND NOT props ? 'educationalStep' AND props->>'curriculum' ~ '^\d{4}';
-- 위 UPDATE 가 쌓은 지연 트리거 검사를 지금 실행해 비운다(쌓인 채로는 아래 ALTER TABLE 이 거부된다). 시드는 다시 지연 모드로 넣는다.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
ALTER TABLE kg.nodes DROP CONSTRAINT IF EXISTS nodes_level_check;
ALTER TABLE kg.nodes ADD CONSTRAINT nodes_level_check CHECK (
  (type = 'level') = (id ~ '^L[1-5]-')
  AND (type <> 'level' OR COALESCE(
        props->>'level' IN ('1', '2', '3', '4', '5')
        AND left(id, 3) = 'L' || (props->>'level') || '-'
        AND length(btrim(props->>'name')) > 0
        AND jsonb_typeof(props->'order') = 'number'
        AND (props ? 'kind') = (props->>'level' = '5')
        AND (props->>'level' <> '5' OR props->>'kind' IN ('concept', 'theorem', 'property', 'formula', 'definition',
                                                          'strategy', 'method', 'info'))
        AND (props ? 'school') = (props->>'level' = '3' AND id NOT LIKE 'L3-STUDY-%')
        AND (props ? 'curriculum') = (props->>'level' = '3' AND id NOT LIKE 'L3-STUDY-%')
        AND (props ? 'educationalStep') = (props->>'level' = '3' AND id NOT LIKE 'L3-STUDY-%')
        AND (NOT props ? 'school' OR (props->>'school' IN ('middle', 'high') AND length(btrim(props->>'curriculum')) > 0
                                       AND jsonb_typeof(props->'educationalStep') = 'number')),
      false))
);

-- 고정 노드(Level 1·2, 수학 학습 과목)는 고정 시드 그대로만 넣을 수 있고, 고치거나 지울 수 없다
CREATE OR REPLACE FUNCTION kg.level_node_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND (OLD.id ~ '^L[12]-' OR OLD.id LIKE 'L3-STUDY-%') THEN
    RAISE EXCEPTION '고정 노드(Level 1·2, 수학 학습 과목)는 바꿀 수 없습니다: %', OLD.id;
  END IF;
  IF TG_OP <> 'DELETE' AND (NEW.id ~ '^L[12]-' OR NEW.id LIKE 'L3-STUDY-%') AND NOT EXISTS (
    SELECT 1 FROM kg.level_fixed() f
    WHERE f.id = NEW.id AND f.level::text = NEW.props->>'level' AND f.ord::text = NEW.props->>'order' AND f.name = NEW.props->>'name'
  ) THEN
    RAISE EXCEPTION '고정 노드(Level 1·2, 수학 학습 과목)는 고정 시드만 넣을 수 있습니다: %', NEW.id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- 관계 규칙. 단계·소속처럼 상위를 봐야 하는 검사는 노드와 간선을 한 트랜잭션에 넣을 수 있도록 커밋 때(kg.check_level_node) 한다.
CREATE OR REPLACE FUNCTION kg.level_edge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  st text; sl int; dt text; dl int;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.type = 'HAS_CHILD' AND EXISTS (SELECT 1 FROM kg.level_fixed() f WHERE f.id = OLD.dst AND f.parent = OLD.src) THEN
    RAISE EXCEPTION '고정 간선은 바꿀 수 없습니다: % → %', OLD.src, OLD.dst;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND (OLD.src ~ '^L[1-5]-' OR OLD.dst ~ '^L[1-5]-') THEN
    RAISE EXCEPTION 'level 간선은 고칠 수 없습니다. 지우고 다시 넣으세요: % → %', OLD.src, OLD.dst;
  END IF;
  IF NOT (NEW.src ~ '^L[1-5]-' OR NEW.dst ~ '^L[1-5]-'
          OR NEW.type IN ('BELONGS_TO_AREA', 'PREREQUISITE_OF', 'APPLIES_TO', 'DESCRIBES')) THEN
    RETURN NEW;
  END IF;

  SELECT type, (props->>'level')::int INTO st, sl FROM kg.nodes WHERE id = NEW.src;
  SELECT type, (props->>'level')::int INTO dt, dl FROM kg.nodes WHERE id = NEW.dst;
  IF st IS NULL OR dt IS NULL THEN RETURN NEW; END IF; -- 없는 노드는 외래키가 거부한다

  IF NEW.type = 'HAS_CHILD' THEN
    IF NOT (st = 'level' AND dt = 'level') THEN
      RAISE EXCEPTION 'HAS_CHILD 는 level 노드 사이만 됩니다: % → %', NEW.src, NEW.dst;
    END IF;
  ELSIF NEW.type = 'BELONGS_TO_AREA' THEN
    -- 수학 쪽은 수학 영역에만, 수학 학습 쪽은 L1-STUDY 에만 속한다 (커밋 때 검사)
    IF NOT (st = 'level' AND sl IN (3, 4) AND dt = 'level' AND dl = 1) THEN
      RAISE EXCEPTION 'BELONGS_TO_AREA 는 L3·L4 → L1 만 됩니다: % → %', NEW.src, NEW.dst;
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
  ELSIF NEW.type = 'APPLIES_TO' THEN
    -- 시작이 수학 학습 쪽, 끝이 수학 쪽인지는 커밋 때 검사
    IF NOT (st = 'level' AND sl IN (4, 5) AND dt = 'level' AND dl >= 3) THEN
      RAISE EXCEPTION 'APPLIES_TO 는 수학 학습 쪽 L4·L5 → 수학 L3~L5 만 됩니다: % → %', NEW.src, NEW.dst;
    END IF;
  ELSIF NEW.type = 'DESCRIBES' THEN
    -- 시작이 교육과정(L3-STUDY-CURR) 아래인지는 커밋 때 검사
    IF NOT (st = 'level' AND sl IN (4, 5) AND dt = 'level' AND dl = 3 AND NEW.dst NOT LIKE 'L3-STUDY-%') THEN
      RAISE EXCEPTION 'DESCRIBES 는 교육과정 아래 L4·L5 → 수학 과목(L3)만 됩니다: % → %', NEW.src, NEW.dst;
    END IF;
  ELSE
    RAISE EXCEPTION '% 관계는 level 노드에 쓸 수 없습니다: % → %', NEW.type, NEW.src, NEW.dst;
  END IF;
  RETURN NEW;
END $$;

-- 한 노드의 커밋 때 검사
--   상위(HAS_CHILD): L2 는 고정 L1 하나, 수학 학습 과목은 L1-STUDY 하나, L3 중등은 L2 아래·고등은 L1(L1-STUDY 제외) 아래(여러 개 가능),
--                    L4 는 L3 하나, L5 는 L4 하나
--   L5 kind: 수학 쪽은 concept·theorem·property·formula·definition, 수학 학습 쪽은 strategy·method·info
--   BELONGS_TO_AREA: 수학 쪽은 수학 영역에만, 수학 학습 쪽은 L1-STUDY 에만
--   APPLIES_TO: 수학 학습 쪽 → 수학 쪽 / DESCRIBES: 교육과정(L3-STUDY-CURR) 아래 → 수학 과목
-- L4 는 옮기면 아래 L5 의 쪽(수학/수학 학습)도 바뀌므로 L5 도 다시 검사한다.
CREATE OR REPLACE FUNCTION kg.check_level_node(nid text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  n kg.nodes; lv int; cnt int; bad text; subj text;
BEGIN
  SELECT * INTO n FROM kg.nodes WHERE id = nid;
  IF NOT FOUND OR n.type <> 'level' THEN RETURN; END IF;
  lv := (n.props->>'level')::int;
  IF lv = 1 THEN RETURN; END IF;

  SELECT count(*), string_agg(e.src, ', ') FILTER (WHERE NOT CASE
           WHEN lv = 2 OR nid LIKE 'L3-STUDY-%' THEN e.src = (SELECT f.parent FROM kg.level_fixed() f WHERE f.id = nid)
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
  ELSIF (lv IN (2, 4, 5) OR nid LIKE 'L3-STUDY-%') AND cnt > 1 THEN
    RAISE EXCEPTION '% 는 상위 노드를 하나만 가질 수 있습니다', nid;
  END IF;
  IF lv = 2 THEN RETURN; END IF;

  subj := kg.level_study_subject(nid);

  IF lv = 5 AND n.props->>'kind' <> ALL (CASE WHEN subj IS NULL
       THEN ARRAY['concept', 'theorem', 'property', 'formula', 'definition'] ELSE ARRAY['strategy', 'method', 'info'] END) THEN
    RAISE EXCEPTION '% 의 kind(%)는 % 쪽에 쓸 수 없습니다', nid, n.props->>'kind', CASE WHEN subj IS NULL THEN '수학' ELSE '수학 학습' END;
  END IF;

  SELECT string_agg(e.type || ' ' || e.src || ' → ' || e.dst, ', ') INTO bad
  FROM kg.edges e
  WHERE (e.src = nid AND e.type = 'BELONGS_TO_AREA' AND (subj IS NOT NULL) <> (e.dst = 'L1-STUDY'))
     OR (e.src = nid AND e.type = 'APPLIES_TO' AND (subj IS NULL OR kg.level_study_subject(e.dst) IS NOT NULL))
     OR (e.dst = nid AND e.type = 'APPLIES_TO' AND subj IS NOT NULL)
     OR (e.src = nid AND e.type = 'DESCRIBES' AND subj IS DISTINCT FROM 'L3-STUDY-CURR');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '% 의 관계가 규칙에 맞지 않습니다 (수학 / 수학 학습 쪽): %', nid, bad;
  END IF;

  IF lv = 4 THEN
    PERFORM kg.check_level_node(e.dst) FROM kg.edges e WHERE e.src = nid AND e.type = 'HAS_CHILD';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION kg.level_check_deferred() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'nodes' THEN
    PERFORM kg.check_level_node(NEW.id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM kg.check_level_node(OLD.dst);
  ELSIF NEW.type = 'HAS_CHILD' THEN
    PERFORM kg.check_level_node(NEW.dst);
  ELSE
    PERFORM kg.check_level_node(NEW.src); -- BELONGS_TO_AREA, APPLIES_TO, DESCRIBES 는 시작 노드 쪽에서 검사
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
  FOR EACH ROW WHEN (NEW.type = 'level') EXECUTE FUNCTION kg.level_check_deferred();
DROP TRIGGER IF EXISTS level_edge_parent_add ON kg.edges;
CREATE CONSTRAINT TRIGGER level_edge_parent_add AFTER INSERT ON kg.edges DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN ((NEW.type = 'HAS_CHILD' AND NEW.dst ~ '^L[1-5]-') OR NEW.type IN ('BELONGS_TO_AREA', 'APPLIES_TO', 'DESCRIBES'))
  EXECUTE FUNCTION kg.level_check_deferred();
DROP TRIGGER IF EXISTS level_edge_parent_del ON kg.edges;
CREATE CONSTRAINT TRIGGER level_edge_parent_del AFTER DELETE ON kg.edges DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD.type = 'HAS_CHILD' AND OLD.dst ~ '^L[1-5]-') EXECUTE FUNCTION kg.level_check_deferred();

-- 시드: 없으면 만들고, 있으면 그대로 둔다
INSERT INTO kg.nodes (id, type, book, props)
SELECT f.id, 'level', 'level', jsonb_build_object('level', f.level, 'order', f.ord, 'name', f.name) FROM kg.level_fixed() f
ON CONFLICT (id) DO NOTHING;
INSERT INTO kg.edges (src, dst, type)
SELECT f.parent, f.id, 'HAS_CHILD' FROM kg.level_fixed() f WHERE f.parent IS NOT NULL
ON CONFLICT DO NOTHING;
