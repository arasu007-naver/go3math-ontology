import { pool } from "./l2oPool";
import { countConcepts, getConceptsByIds, listConcepts, listExcludedConcepts, type LegacyConcept } from "./legacyDb";
import { unitPaths } from "./l2oUnits";
import type { ConceptsPage, L2oStats, ReviewView, RowVM, SelectorName } from "@/lib/l2o/types";

// legacy 한 쪽 + 각 행의 그룹 / 선택기별 최신 투표 / 이전 결과
export async function getConceptsPage(page: number, pageSize: number): Promise<ConceptsPage> {
  const [concepts, counts] = await Promise.all([listConcepts((page - 1) * pageSize, pageSize), countConcepts()]);
  const rows = await buildRows(concepts);
  return { rows, total: counts.total, excludedCount: counts.excluded, stats: await getStats(), page, pageSize };
}

// 검토 보기: 페이지와 상관없이 처리할 항목 전부
//  review: 단원이 검토 필요인 그룹의 대표 개념 (대표 id 순)
//  bundle: 묶음 검토 필요 그룹의 모든 멤버 (그룹끼리 붙여서, 그룹 안에서는 대표 먼저)
//  excluded: 제외(is_on=0) 개념 전부 (id 순)
export async function getReviewPage(view: ReviewView): Promise<ConceptsPage> {
  if (view === "excluded") {
    const [concepts, counts] = await Promise.all([listExcludedConcepts(), countConcepts()]);
    const rows = await buildRows(concepts);
    return { rows, total: counts.total, excludedCount: counts.excluded, stats: await getStats(), page: 1, pageSize: Math.max(1, rows.length), view };
  }
  const q =
    view === "review"
      ? `SELECT g.representative_legacy_id AS id FROM l2o.dedupe_group g JOIN l2o.migration_result r ON r.group_id = g.id
          WHERE r.status = 'needs_review' AND EXISTS (SELECT 1 FROM l2o.dedupe_member m WHERE m.group_id = g.id)
          ORDER BY g.representative_legacy_id`
      : `SELECT m.legacy_concept_id AS id FROM l2o.dedupe_member m JOIN l2o.dedupe_group g ON g.id = m.group_id
          WHERE g.status = 'needs_review'
          ORDER BY g.representative_legacy_id, (m.legacy_concept_id = g.representative_legacy_id) DESC, m.legacy_concept_id`;
  const order: number[] = (await pool.query(q)).rows.map((r) => Number(r.id));
  const [found, counts] = await Promise.all([getConceptsByIds(order), countConcepts()]);
  const byId = new Map(found.map((c) => [c.id, c]));
  const rows = await buildRows(order.map((id) => byId.get(id)).filter((c): c is LegacyConcept => !!c));
  return { rows, total: counts.total, excludedCount: counts.excluded, stats: await getStats(), page: 1, pageSize: Math.max(1, rows.length), view };
}

async function buildRows(concepts: LegacyConcept[]): Promise<RowVM[]> {
  const paths = await unitPaths();
  const ids = concepts.map((c) => c.id);

  const groups = await pool.query(
    `SELECT m.legacy_concept_id, g.id, g.representative_legacy_id, g.status,
            (SELECT COUNT(*) FROM l2o.dedupe_member x WHERE x.group_id = g.id)::int AS member_count,
            r.status AS r_status, r.final_unit_id, r.majority_unit_id, r.agree_count, r.dry_run_only,
            -- 최신 수동 결정이 지금 최종 단원이면 '수동' (그룹 편집으로 결과가 초기화되면 해제)
            (r.status = 'migrated' AND r.final_unit_id = (SELECT o.new_unit_id FROM l2o.unit_override o WHERE o.group_id = g.id ORDER BY o.created_at DESC LIMIT 1)) AS manual
       FROM l2o.dedupe_member m
       JOIN l2o.dedupe_group g ON g.id = m.group_id
       LEFT JOIN l2o.migration_result r ON r.group_id = g.id
      WHERE m.legacy_concept_id = ANY($1::bigint[])`,
    [ids]
  );
  const byLegacy = new Map(groups.rows.map((r) => [Number(r.legacy_concept_id), r]));
  const groupIds = [...new Set(groups.rows.map((r) => Number(r.id)))];

  const votes = await pool.query(
    `SELECT DISTINCT ON (group_id, selector) group_id, selector, selected_unit_id, confidence, error, created_at
       FROM l2o.selector_vote WHERE group_id = ANY($1::bigint[])
      ORDER BY group_id, selector, created_at DESC`,
    [groupIds]
  );
  const votesByGroup = new Map<number, RowVM["votes"]>();
  for (const v of votes.rows) {
    const g = votesByGroup.get(Number(v.group_id)) ?? {};
    g[v.selector as SelectorName] = {
      unitId: v.selected_unit_id,
      unitPath: v.selected_unit_id ? paths.get(v.selected_unit_id) : undefined,
      confidence: v.confidence,
      error: v.error ?? undefined,
      at: new Date(v.created_at).toISOString(),
    };
    votesByGroup.set(Number(v.group_id), g);
  }

  const rows: RowVM[] = concepts.map((c) => {
    const g = byLegacy.get(c.id);
    const row: RowVM = {
      legacy: {
        id: c.id,
        title: c.title,
        statement: c.statement,
        images: c.images,
        schoolType: c.schoolType,
        mathField: c.mathField,
        isOn: c.isOn,
      },
      votes: {},
    };
    if (!g) return row;
    const groupId = Number(g.id);
    const representativeId = Number(g.representative_legacy_id);
    row.group = { id: groupId, isRepresentative: representativeId === c.id, representativeId, memberCount: g.member_count, status: g.status };
    row.votes = votesByGroup.get(groupId) ?? {};
    if (g.r_status) {
      row.result = {
        status: g.r_status,
        finalUnitId: g.final_unit_id ?? undefined,
        finalUnitPath: g.final_unit_id ? paths.get(g.final_unit_id) : undefined,
        suggestedUnitId: g.majority_unit_id ?? undefined,
        suggestedUnitPath: g.majority_unit_id ? paths.get(g.majority_unit_id) : undefined,
        agreeCount: g.agree_count ?? undefined,
        dryRunOnly: !!g.dry_run_only,
        manual: !!g.manual,
      };
    }
    return row;
  });
  return rows;
}

// 병합으로 멤버가 없어진 옛 그룹의 결과(이력용으로 남김)는 세지 않는다
const LIVE = "EXISTS (SELECT 1 FROM l2o.dedupe_member m WHERE m.group_id = r.group_id)";

async function getStats(): Promise<L2oStats> {
  const r = await pool.query(
    `SELECT (SELECT COUNT(DISTINCT group_id) FROM l2o.dedupe_member)::int AS groups,
            (SELECT COUNT(*) FROM l2o.migration_result r WHERE status = 'migrated' AND ${LIVE})::int AS migrated,
            (SELECT COUNT(*) FROM l2o.migration_result r WHERE status = 'needs_review' AND ${LIVE})::int AS needs_review,
            (SELECT COUNT(*) FROM l2o.dedupe_group g WHERE g.status = 'needs_review'
                AND EXISTS (SELECT 1 FROM l2o.dedupe_member m WHERE m.group_id = g.id))::int AS bundle_review`
  );
  return { groups: r.rows[0].groups, migrated: r.rows[0].migrated, needsReview: r.rows[0].needs_review, bundleReview: r.rows[0].bundle_review };
}
