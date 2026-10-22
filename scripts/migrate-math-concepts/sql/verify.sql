-- 완료 기준 검증 (스펙 8장). 모든 쿼리가 0행 / 0 이어야 한다.

-- 1. 원본 id 가 두 번 이상 나타나는가 (source_id ∪ merged_source_ids 기준 중복 노드)
SELECT sid, COUNT(*) AS n
FROM (SELECT source_id AS sid FROM kg.math_concepts
      UNION ALL SELECT unnest(merged_source_ids) FROM kg.math_concepts) t
GROUP BY sid HAVING COUNT(*) > 1;

-- 2. 활성 primary 엣지가 1개가 아닌 개념 (단원 없음 NONE 승인 건은 0개가 정상이므로 따로 확인)
SELECT c.source_id, c.title, COUNT(e.id) FILTER (WHERE e.is_primary) AS primary_edges
FROM kg.math_concepts c LEFT JOIN kg.concept_unit_edges e ON e.concept_id = c.id AND e.is_active
GROUP BY c.id HAVING COUNT(e.id) FILTER (WHERE e.is_primary) <> 1;

-- 3. 같은 개념→단원 활성 엣지 중복
SELECT concept_id, unit_id, COUNT(*) FROM kg.concept_unit_edges WHERE is_active GROUP BY 1, 2 HAVING COUNT(*) > 1;

-- 4. 비활성 엣지인데 이력(superseded_at·superseded_by)이 없는 것
SELECT id, concept_id, unit_id FROM kg.concept_unit_edges WHERE NOT is_active AND (superseded_at IS NULL OR superseded_by IS NULL);

-- 5. 단원 엣지가 가리키는 노드가 수학 대단원·소단원이 아닌 것
SELECT e.id, e.unit_id, n.props->>'category' AS category
FROM kg.concept_unit_edges e JOIN kg.nodes n ON n.id = e.unit_id
WHERE n.type <> 'level' OR n.props->>'category' NOT IN ('대단원', '소단원');

-- 6. 누락 검사: 원본 is_on=1 id 와의 비교는 05-write-kg.mjs 실행 끝의 "누락" 보고를 본다
--    (원본이 MariaDB 라 SQL 하나로 못 한다. 05 는 out/concepts_merged.jsonl 의 대표·병합 id 전체와 비교한다).
SELECT COUNT(*) AS concept_nodes, SUM(cardinality(merged_source_ids)) AS merged_ids FROM kg.math_concepts;
