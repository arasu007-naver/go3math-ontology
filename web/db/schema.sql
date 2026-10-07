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
    'APPLIES_TO',      -- 수학 학습 대단원 아래 L4 → 그 전략·방법이 쓰이는 수학 L3~L5
    'DESCRIBES'        -- 교육과정(L3-STUDY-CURR) 아래 L4·L5 → 수학 과목(L3)
  ));

-- ---------- Level 1~5 (level-spec.md) ----------
-- level 노드 id 는 L1-/L2-/L3-/L4-/L5- 접두사. 트리거가 이 접두사로 level 관련 행만 골라 검사한다.
-- 수학 학습 대단원은 L3-STUDY-* 고정 id 로 L1-STUDY 의 PREREQUISITE(L2-STUDY-PRE) 아래에 있고, 그 아래 L4 를 "수학 학습 쪽" 노드라 부른다.

-- 고정 Level 1 일곱 + Level 2 PREREQUISITE 일곱 + 수학 학습 대단원(L3) 넷. 바꾸려면 level-spec.md 를 고친 뒤 여기를 고친다.
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
    ('L2-STUDY-PRE', 2, 1, 'PREREQUISITE', 'L1-STUDY'),
    ('L2-NUM-PRE',  2, 1, 'PREREQUISITE', 'L1-NUM'),
    ('L2-EXPR-PRE', 2, 1, 'PREREQUISITE', 'L1-EXPR'),
    ('L2-EQ-PRE',   2, 1, 'PREREQUISITE', 'L1-EQ'),
    ('L2-FUNC-PRE', 2, 1, 'PREREQUISITE', 'L1-FUNC'),
    ('L2-PROB-PRE', 2, 1, 'PREREQUISITE', 'L1-PROB'),
    ('L2-GEO-PRE',  2, 1, 'PREREQUISITE', 'L1-GEO'),
    ('L3-STUDY-PSS',   3, 1, '문제 해결 전략', 'L2-STUDY-PRE'),
    ('L3-STUDY-CURR',  3, 2, '교육과정',       'L2-STUDY-PRE'),
    ('L3-STUDY-LEARN', 3, 3, '학습법',         'L2-STUDY-PRE'),
    ('L3-STUDY-TEACH', 3, 4, '교습법',         'L2-STUDY-PRE')
$$;

-- 노드가 수학 학습 쪽이면 그 L3-STUDY-* 대단원 id, 아니면 NULL (자신부터 HAS_CHILD 상위를 L3 까지 거슬러 찾는다)
CREATE OR REPLACE FUNCTION kg.level_study_subject(nid text) RETURNS text LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up(id, depth) AS (
    SELECT nid, 0
    UNION
    SELECT e.src, up.depth + 1 FROM kg.edges e JOIN up ON e.dst = up.id
    WHERE e.type = 'HAS_CHILD' AND e.src ~ '^L[3-9]-' AND up.depth < 9
  )
  SELECT id FROM up WHERE id LIKE 'L3-STUDY-%' LIMIT 1
$$;

-- 이전 구조 정리 (2026-10-06 명세 변경. 이미 정리된 DB 에서는 아무것도 바꾸지 않는다)
--   중학 수학 1·2·3 과목 노드(L3-MID-1~3)와 그 아래 대단원(L4)을 지운다. 중등 대단원은 PREREQUISITE 바로 아래 L3 로 다시 넣는다(db:import-middle).
--   category 가 없던 L3(고등 과목, 수학 학습 과목)는 과목, L4(고등 대단원)는 대단원으로 채운다.
--   고정 노드(수학 학습 과목)도 채워야 하므로 고정 노드 보호 트리거를 잠시 내린다(아래에서 다시 만든다).
--   노드 필드 검사(nodes_level_check)도 잠시 내린다. 아래에서 새 규칙으로 다시 만든다.
DROP TRIGGER IF EXISTS level_node_guard ON kg.nodes;
ALTER TABLE kg.nodes DROP CONSTRAINT IF EXISTS nodes_level_check;
DELETE FROM kg.nodes WHERE id IN (SELECT dst FROM kg.edges WHERE type = 'HAS_CHILD' AND src ~ '^L3-MID-[1-3]$');
DELETE FROM kg.nodes WHERE id ~ '^L3-MID-[1-3]$';
UPDATE kg.nodes SET props = props || '{"category": "과목"}' WHERE type = 'level' AND props->>'level' = '3' AND NOT props ? 'category';
UPDATE kg.nodes SET props = props || '{"category": "대단원"}' WHERE type = 'level' AND props->>'level' = '4' AND NOT props ? 'category';
-- 2026-10-07 명세 변경: L1-STUDY 아래에도 PREREQUISITE(L2-STUDY-PRE)를 두고, 수학 학습 과목 넷을 그 아래 L3 대단원으로 옮긴다
-- (L1-STUDY 가 아직 없는 새 DB 는 아래 시드가 새 구조로 넣는다)
INSERT INTO kg.nodes (id, type, book, props)
SELECT 'L2-STUDY-PRE', 'level', 'level', '{"level": 2, "order": 1, "name": "PREREQUISITE"}'
WHERE EXISTS (SELECT 1 FROM kg.nodes WHERE id = 'L1-STUDY')
ON CONFLICT (id) DO NOTHING;
INSERT INTO kg.edges (src, dst, type)
SELECT 'L1-STUDY', 'L2-STUDY-PRE', 'HAS_CHILD' WHERE EXISTS (SELECT 1 FROM kg.nodes WHERE id = 'L2-STUDY-PRE')
ON CONFLICT DO NOTHING;
DELETE FROM kg.edges WHERE type = 'HAS_CHILD' AND src = 'L1-STUDY' AND dst LIKE 'L3-STUDY-%';
INSERT INTO kg.edges (src, dst, type)
SELECT 'L2-STUDY-PRE', n.id, 'HAS_CHILD' FROM kg.nodes n
WHERE n.id LIKE 'L3-STUDY-%' AND EXISTS (SELECT 1 FROM kg.nodes WHERE id = 'L2-STUDY-PRE')
ON CONFLICT DO NOTHING;
UPDATE kg.nodes SET props = props || '{"category": "대단원"}' WHERE id LIKE 'L3-STUDY-%' AND props->>'category' = '과목';
-- 2026-10-07: 교재 TOC 등록으로 만든 노드(props.source)는 소단원이 아니라 TOC 노드다 (kind 없음)
UPDATE kg.nodes SET props = (props - 'kind') || '{"category": "TOC"}'
WHERE type = 'level' AND props ? 'source' AND props->>'category' = '소단원';

-- 노드 필드: id 접두사 = level(나무 깊이), name·order 필수
--   category: L3 과목·대단원, L4 대단원·소단원·TOC, L5 소단원·TOC, L6~L9 TOC (TOC = 교재 TOC 등록 노드) / kind 는 소단원만 / grade(1~3)는 중등 대단원(L3 대단원, 수학 학습 대단원 제외)만
--   school(high)·curriculum·educationalStep·revisedCurriculum 은 고등 과목(L3 과목)만
-- (상위와의 짝, 소단원 kind 가 수학 쪽 값인지 수학 학습 쪽 값인지는 상위를 봐야 하므로 kg.check_level_node 가 커밋 때 검사한다)
-- educationalStep(교육과정 연도, 정수) 추가 전에 넣은 L3 는 curriculum 의 연도로 채운다
UPDATE kg.nodes SET props = props || jsonb_build_object('educationalStep', substring(props->>'curriculum' from '^\d{4}')::int)
WHERE type = 'level' AND props->>'level' = '3' AND NOT props ? 'educationalStep' AND props->>'curriculum' ~ '^\d{4}';
-- revisedCurriculum(개정 교육 과정, 정수) 추가 전에 넣은 고등 과목은 2022 (2027~ 수험생 교육과정)
UPDATE kg.nodes SET props = props || '{"revisedCurriculum": 2022}'
WHERE type = 'level' AND props->>'level' = '3' AND props ? 'school' AND NOT props ? 'revisedCurriculum';
-- 위 UPDATE 가 쌓은 지연 트리거 검사를 지금 실행해 비운다(쌓인 채로는 아래 ALTER TABLE 이 거부된다). 시드는 다시 지연 모드로 넣는다.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
ALTER TABLE kg.nodes DROP CONSTRAINT IF EXISTS nodes_level_check;
ALTER TABLE kg.nodes ADD CONSTRAINT nodes_level_check CHECK (
  (type = 'level') = (id ~ '^L[1-9]-')
  AND (type <> 'level' OR COALESCE(
        props->>'level' IN ('1', '2', '3', '4', '5', '6', '7', '8', '9')
        AND left(id, 3) = 'L' || (props->>'level') || '-'
        AND length(btrim(props->>'name')) > 0
        AND jsonb_typeof(props->'order') = 'number'
        AND CASE props->>'level'
              WHEN '1' THEN NOT props ? 'category'
              WHEN '2' THEN NOT props ? 'category'
              WHEN '3' THEN props->>'category' IN ('과목', '대단원')
              WHEN '4' THEN props->>'category' IN ('대단원', '소단원', 'TOC')
              WHEN '5' THEN props->>'category' IN ('소단원', 'TOC')
              ELSE props->>'category' = 'TOC' -- L6~L9 는 교재 TOC 계층만
            END
        AND (props ? 'kind') = (COALESCE(props->>'category', '') = '소단원')
        AND (NOT props ? 'kind' OR props->>'kind' IN ('concept', 'theorem', 'property', 'formula', 'definition',
                                                      'strategy', 'method', 'info'))
        AND (props ? 'grade') = (props->>'level' = '3' AND COALESCE(props->>'category', '') = '대단원' AND id NOT LIKE 'L3-STUDY-%')
        AND (NOT props ? 'grade' OR props->>'grade' IN ('1', '2', '3'))
        AND (props ? 'school') = (props->>'level' = '3' AND COALESCE(props->>'category', '') = '과목' AND id NOT LIKE 'L3-STUDY-%')
        AND (props ? 'curriculum') = (props ? 'school')
        AND (props ? 'educationalStep') = (props ? 'school')
        AND (props ? 'revisedCurriculum') = (props ? 'school')
        AND (NOT props ? 'school' OR (props->>'school' = 'high' AND length(btrim(props->>'curriculum')) > 0
                                       AND jsonb_typeof(props->'educationalStep') = 'number'
                                       AND jsonb_typeof(props->'revisedCurriculum') = 'number')),
      false))
);

-- 고정 노드(Level 1·2, 수학 학습 대단원)는 고정 시드 그대로만 넣을 수 있고, 고치거나 지울 수 없다
CREATE OR REPLACE FUNCTION kg.level_node_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND (OLD.id ~ '^L[12]-' OR OLD.id LIKE 'L3-STUDY-%') THEN
    RAISE EXCEPTION '고정 노드(Level 1·2, 수학 학습 대단원)는 바꿀 수 없습니다: %', OLD.id;
  END IF;
  IF TG_OP <> 'DELETE' AND (NEW.id ~ '^L[12]-' OR NEW.id LIKE 'L3-STUDY-%') AND NOT EXISTS (
    SELECT 1 FROM kg.level_fixed() f
    WHERE f.id = NEW.id AND f.level::text = NEW.props->>'level' AND f.ord::text = NEW.props->>'order' AND f.name = NEW.props->>'name'
  ) THEN
    RAISE EXCEPTION '고정 노드(Level 1·2, 수학 학습 대단원)는 고정 시드만 넣을 수 있습니다: %', NEW.id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- 관계 규칙. 단계·소속처럼 상위를 봐야 하는 검사는 노드와 간선을 한 트랜잭션에 넣을 수 있도록 커밋 때(kg.check_level_node) 한다.
CREATE OR REPLACE FUNCTION kg.level_edge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  st text; sl int; sc text; dt text; dl int; dc text;
  rank CONSTANT jsonb := '{"소단원": 1, "대단원": 2, "과목": 3}'; -- 선수는 같거나 상위 category 로만
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.type = 'HAS_CHILD' AND EXISTS (SELECT 1 FROM kg.level_fixed() f WHERE f.id = OLD.dst AND f.parent = OLD.src) THEN
    RAISE EXCEPTION '고정 간선은 바꿀 수 없습니다: % → %', OLD.src, OLD.dst;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND (OLD.src ~ '^L[1-9]-' OR OLD.dst ~ '^L[1-9]-') THEN
    RAISE EXCEPTION 'level 간선은 고칠 수 없습니다. 지우고 다시 넣으세요: % → %', OLD.src, OLD.dst;
  END IF;
  IF NOT (NEW.src ~ '^L[1-9]-' OR NEW.dst ~ '^L[1-9]-'
          OR NEW.type IN ('BELONGS_TO_AREA', 'PREREQUISITE_OF', 'APPLIES_TO', 'DESCRIBES')) THEN
    RETURN NEW;
  END IF;

  SELECT type, (props->>'level')::int, props->>'category' INTO st, sl, sc FROM kg.nodes WHERE id = NEW.src;
  SELECT type, (props->>'level')::int, props->>'category' INTO dt, dl, dc FROM kg.nodes WHERE id = NEW.dst;
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
    IF NOT (st = 'level' AND dt = 'level' AND sl >= 3 AND dl >= 3 AND COALESCE((rank->>dc)::int >= (rank->>sc)::int, false)) THEN
      RAISE EXCEPTION 'PREREQUISITE_OF 는 과목·대단원·소단원 → 같은 또는 상위 category 노드만 됩니다: % → %', NEW.src, NEW.dst;
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
    IF NOT (st IN ('toc', 'paragraph') AND dt = 'level' AND dc IN ('대단원', '소단원')) THEN
      RAISE EXCEPTION 'MAPS_TO 는 교재 TOC 항목·문단 → 대단원·소단원만 됩니다: % → %', NEW.src, NEW.dst;
    END IF;
  ELSIF NEW.type = 'APPLIES_TO' THEN
    -- 시작이 수학 학습 쪽, 끝이 수학 쪽인지는 커밋 때 검사
    IF NOT (st = 'level' AND sl >= 4 AND dt = 'level' AND dl >= 3) THEN
      RAISE EXCEPTION 'APPLIES_TO 는 수학 학습 쪽 L4 이하 → 수학 L3 이하만 됩니다: % → %', NEW.src, NEW.dst;
    END IF;
  ELSIF NEW.type = 'DESCRIBES' THEN
    -- 시작이 교육과정(L3-STUDY-CURR) 아래인지는 커밋 때 검사
    IF NOT (st = 'level' AND sl >= 4 AND dt = 'level' AND dc = '과목' AND NEW.dst NOT LIKE 'L3-STUDY-%') THEN
      RAISE EXCEPTION 'DESCRIBES 는 교육과정 아래 L4 이하 → 수학 과목(L3)만 됩니다: % → %', NEW.src, NEW.dst;
    END IF;
  ELSE
    RAISE EXCEPTION '% 관계는 level 노드에 쓸 수 없습니다: % → %', NEW.type, NEW.src, NEW.dst;
  END IF;
  RETURN NEW;
END $$;

-- 한 노드의 커밋 때 검사
--   상위(HAS_CHILD): L2 는 고정 L1 하나, 수학 학습 대단원은 L2-STUDY-PRE 하나,
--                    수학 L3 는 수학 영역 PREREQUISITE(L2) 아래(중등 대단원은 하나, 고등 과목은 여러 개 가능),
--                    L4 는 L3 하나(과목 아래면 대단원, 대단원 아래면 소단원),
--                    L5 소단원은 L4 대단원 하나,
--                    TOC(교재 TOC 등록 노드, L4~L9)는 바로 위 level 의 대단원 또는 TOC 하나
--   소단원 kind: 수학 쪽은 concept·theorem·property·formula·definition, 수학 학습 쪽은 strategy·method·info
--   BELONGS_TO_AREA: 수학 쪽은 수학 영역에만, 수학 학습 쪽은 L1-STUDY 에만
--   APPLIES_TO: 수학 학습 쪽 → 수학 쪽 / DESCRIBES: 교육과정(L3-STUDY-CURR) 아래 → 수학 과목
-- L3 이하는 옮기거나 category 가 바뀌면 아래 노드의 짝·쪽도 바뀌므로 하위도 다시 검사한다.
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
           WHEN lv = 3 THEN e.src LIKE 'L2-%' AND e.src <> 'L2-STUDY-PRE'
           ELSE e.src LIKE 'L' || (lv - 1) || '-%'
                AND CASE n.props->>'category' WHEN '대단원' THEN p.props->>'category' = '과목'
                                              WHEN 'TOC' THEN p.props->>'category' IN ('대단원', 'TOC')
                                              ELSE p.props->>'category' = '대단원' END
         END)
    INTO cnt, bad
  FROM kg.edges e JOIN kg.nodes p ON p.id = e.src WHERE e.dst = nid AND e.type = 'HAS_CHILD';

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '% 의 상위 노드가 규칙에 맞지 않습니다: %', nid, bad;
  ELSIF cnt = 0 THEN
    RAISE EXCEPTION '% 에 상위 노드(HAS_CHILD)가 없습니다', nid;
  ELSIF (lv = 2 OR lv >= 4 OR nid LIKE 'L3-STUDY-%' OR n.props->>'category' = '대단원') AND cnt > 1 THEN
    RAISE EXCEPTION '% 는 상위 노드를 하나만 가질 수 있습니다', nid;
  END IF;
  IF lv = 2 THEN RETURN; END IF;

  subj := kg.level_study_subject(nid);

  IF n.props->>'category' = '소단원' AND n.props->>'kind' <> ALL (CASE WHEN subj IS NULL
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

  IF lv >= 3 THEN
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
  FOR EACH ROW WHEN ((NEW.type = 'HAS_CHILD' AND NEW.dst ~ '^L[1-9]-') OR NEW.type IN ('BELONGS_TO_AREA', 'APPLIES_TO', 'DESCRIBES'))
  EXECUTE FUNCTION kg.level_check_deferred();
DROP TRIGGER IF EXISTS level_edge_parent_del ON kg.edges;
CREATE CONSTRAINT TRIGGER level_edge_parent_del AFTER DELETE ON kg.edges DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD.type = 'HAS_CHILD' AND OLD.dst ~ '^L[1-9]-') EXECUTE FUNCTION kg.level_check_deferred();

-- 시드: 없으면 만들고, 있으면 그대로 둔다
INSERT INTO kg.nodes (id, type, book, props)
SELECT f.id, 'level', 'level',
       jsonb_build_object('level', f.level, 'order', f.ord, 'name', f.name)
         || CASE WHEN f.level = 3 THEN '{"category": "대단원"}'::jsonb ELSE '{}'::jsonb END -- 수학 학습 대단원
FROM kg.level_fixed() f
ON CONFLICT (id) DO NOTHING;
INSERT INTO kg.edges (src, dst, type)
SELECT f.parent, f.id, 'HAS_CHILD' FROM kg.level_fixed() f WHERE f.parent IS NOT NULL
ON CONFLICT DO NOTHING;

-- ---------- 교재 TOC 항목 → 대단원 아래 소단원 등록 (도서 입력 화면) ----------
-- TOC 항목(모든 계층) 하나를 과목 그물의 대단원(중등·수학 학습 L3, 고등 L4) 아래, 또는 이미 등록된 TOC 노드 아래
-- 한 단계 아래 TOC level 노드(category TOC, L4~L9)로 등록한다.
-- 이 표는 그 등록의 출처(도서 정보, TOC, 등록 때 왼쪽 미리보기 페이지)를 남긴다. 다른 프로젝트가 이 표로 단원 ↔ 도서·페이지를 찾는다.
-- TOC 노드를 지우면 이 행도 지워진다.
CREATE TABLE IF NOT EXISTS kg.toc_unit_links (
  id           BIGSERIAL PRIMARY KEY,
  unit_id      TEXT NOT NULL REFERENCES kg.nodes (id) ON DELETE CASCADE, -- 바로 위 노드 (대단원, 또는 등록된 TOC 노드)
  root_unit_id TEXT REFERENCES kg.nodes (id) ON DELETE CASCADE,          -- 맨 위 대단원 (unit_id 가 대단원이면 같다)
  node_id      TEXT UNIQUE REFERENCES kg.nodes (id) ON DELETE CASCADE,   -- 등록으로 만든 TOC 노드 (L<n>-T<id>)
  book_stem    TEXT NOT NULL,        -- 저장소 stem (origin/<stem>/, NFC)
  book_title   TEXT NOT NULL,
  document_id  BIGINT,               -- unlimited-ocr documents.id (BookToc 에서 고른 도서는 없을 수 있다)
  toc_key      TEXT NOT NULL,        -- flattenToc 키 (예: "1/1-2/0")
  toc_level    TEXT NOT NULL CHECK (toc_level IN ('chapter', 'section', 'item')),
  toc_label    TEXT NOT NULL,
  toc_page     INT,                  -- TOC 에 적힌 페이지
  page_kind    TEXT CHECK (page_kind IN ('main', 'commentary')), -- 등록 때 왼쪽 미리보기 (본문/해설서)
  page         INT,                  -- 등록 때 왼쪽 미리보기 페이지 (PDF 페이지)
  created_by   TEXT NOT NULL,        -- 로그인 사용자 아이디
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (book_stem, toc_key, unit_id)
);
-- root_unit_id 추가 전에 만든 표 (그때는 unit_id 가 늘 대단원)
ALTER TABLE kg.toc_unit_links ADD COLUMN IF NOT EXISTS root_unit_id TEXT REFERENCES kg.nodes (id) ON DELETE CASCADE;
UPDATE kg.toc_unit_links SET root_unit_id = unit_id WHERE root_unit_id IS NULL;
ALTER TABLE kg.toc_unit_links ALTER COLUMN root_unit_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS toc_unit_links_unit ON kg.toc_unit_links (unit_id);
CREATE INDEX IF NOT EXISTS toc_unit_links_root ON kg.toc_unit_links (root_unit_id);
