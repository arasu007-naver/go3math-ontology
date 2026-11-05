import { getConceptsByIds } from "./legacyDb";
import { writeGroupToKg } from "./l2oKg";
import { pool } from "./l2oPool";
import { reasonOf } from "@/lib/l2o/units";
import { getCandidateUnits, listUnits } from "./l2oUnits";

// 사람이 단원을 정한다 (specs/math_concepts2ontology.md 5.5): unit_override 기록 + 즉시 KG 반영(→ migrated).
// 이후 재실행·모두 이전은 이 그룹을 건너뛴다(selectForGroup 이 migrated 를 덮지 않음).

export class OverrideError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

// 결정 창 후보: 이 그룹 최근 투표의 후보 목록(없으면 새로 축소) + 전체 단원(검색용)
export async function candidatesFor(groupId: number) {
  const g = await pool.query(
    `SELECT g.representative_legacy_id AS rep, r.final_unit_id, r.majority_unit_id, r.status
       FROM l2o.dedupe_group g LEFT JOIN l2o.migration_result r ON r.group_id = g.id WHERE g.id = $1`,
    [groupId]
  );
  if (!g.rows[0]) throw new OverrideError("없는 그룹입니다.", 404);
  const units = await listUnits();
  const v = await pool.query(`SELECT candidate_unit_ids FROM l2o.selector_vote WHERE group_id = $1 ORDER BY created_at DESC LIMIT 1`, [groupId]);
  let ids: string[] = v.rows[0]?.candidate_unit_ids ?? [];
  if (!ids.length) {
    const [concept] = await getConceptsByIds([Number(g.rows[0].rep)]);
    if (concept) ids = (await getCandidateUnits(concept)).candidates.map((c) => c.unitId);
  }
  const byId = new Map(units.map((u) => [u.unitId, u]));
  return {
    groupId,
    status: g.rows[0].status ?? "pending",
    currentUnitId: g.rows[0].final_unit_id ?? null,
    suggestedUnitId: g.rows[0].majority_unit_id ?? null,
    candidates: ids.filter((id) => byId.has(id)).map((id) => ({ unitId: id, path: byId.get(id)!.path })),
    all: units.map((u) => ({ unitId: u.unitId, path: u.path })),
  };
}

export async function overrideUnit(groupId: number, unitId: string, reason: string, actor: string) {
  const units = await listUnits();
  if (!units.some((u) => u.unitId === unitId)) throw new OverrideError(`없는 단원입니다: ${unitId}`);
  const g = await pool.query(
    `SELECT r.final_unit_id, r.majority_unit_id, EXISTS (SELECT 1 FROM l2o.dedupe_member m WHERE m.group_id = $1) AS live
       FROM l2o.dedupe_group g LEFT JOIN l2o.migration_result r ON r.group_id = g.id WHERE g.id = $1`,
    [groupId]
  );
  if (!g.rows[0]) throw new OverrideError("없는 그룹입니다.", 404);
  if (!g.rows[0].live) throw new OverrideError("멤버가 없는 그룹입니다(다른 그룹에 병합됨).", 409);
  const previous: string | null = g.rows[0].final_unit_id ?? g.rows[0].majority_unit_id ?? null;
  // KG 기록이 성공한 뒤에만 결정 이력을 남긴다(실패 시 아무것도 바뀌지 않음)
  const kg = await writeGroupToKg({ groupId, unitId, judgedBy: `override:${actor}`, confidence: null, rationale: reason, jobId: null });
  await pool.query(`INSERT INTO l2o.unit_override (group_id, previous_unit_id, new_unit_id, reason, actor) VALUES ($1, $2, $3, $4, $5)`, [
    groupId,
    previous,
    unitId,
    reason,
    actor,
  ]);
  return { groupId, unitId, previousUnitId: previous, kg };
}

// 이력: 선택기 표(시간순) · 수동 결정 · KG 엣지(활성/비활성, 대체 관계)
export async function historyOf(groupId: number) {
  const paths = new Map((await listUnits()).map((u) => [u.unitId, u.path]));
  const path = (id: string | null) => (id ? (paths.get(id) ?? id) : null);
  const [votes, overrides, res] = await Promise.all([
    pool.query(
      `SELECT v.created_at, v.selector, v.model, v.selected_unit_id, v.confidence, v.error, v.latency_ms, v.raw_response, v.candidate_fallback,
              cardinality(v.candidate_unit_ids) AS candidates, j.kind AS job_kind, j.dry_run
         FROM l2o.selector_vote v LEFT JOIN l2o.job_run j ON j.id = v.job_run_id
        WHERE v.group_id = $1 ORDER BY v.created_at DESC LIMIT 60`,
      [groupId]
    ),
    pool.query(`SELECT created_at, previous_unit_id, new_unit_id, reason, actor FROM l2o.unit_override WHERE group_id = $1 ORDER BY created_at DESC`, [groupId]),
    pool.query(`SELECT kg_concept_id FROM l2o.migration_result WHERE group_id = $1`, [groupId]),
  ]);
  const conceptId = res.rows[0]?.kg_concept_id == null ? null : Number(res.rows[0].kg_concept_id);
  const edges = conceptId
    ? await pool.query(
        `SELECT id, unit_id, is_primary, is_active, confidence, judged_by, rationale, source, created_at, superseded_at, superseded_by
           FROM kg.concept_unit_edges WHERE concept_id = $1 ORDER BY id DESC`,
        [conceptId]
      )
    : { rows: [] };
  const node = conceptId
    ? (await pool.query(`SELECT id, source_id, merged_source_ids FROM kg.math_concepts WHERE id = $1`, [conceptId])).rows[0]
    : null;
  const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
  return {
    groupId,
    kgConcept: node ? { id: Number(node.id), sourceId: Number(node.source_id), mergedSourceIds: node.merged_source_ids.map(Number) } : null,
    votes: votes.rows.map((v) => ({
      at: iso(v.created_at),
      selector: v.selector,
      model: v.model,
      unitId: v.selected_unit_id,
      unitPath: path(v.selected_unit_id),
      confidence: v.confidence,
      error: v.error,
      latencyMs: v.latency_ms,
      reason: reasonOf(v.raw_response),
      candidates: v.candidates,
      candidateFallback: v.candidate_fallback,
      job: v.job_kind ? `${v.job_kind}${v.dry_run ? " (dry-run)" : ""}` : null,
    })),
    overrides: overrides.rows.map((o) => ({
      at: iso(o.created_at),
      previousUnitId: o.previous_unit_id,
      previousUnitPath: path(o.previous_unit_id),
      unitId: o.new_unit_id,
      unitPath: path(o.new_unit_id),
      reason: o.reason,
      actor: o.actor,
    })),
    edges: edges.rows.map((e) => ({
      id: Number(e.id),
      unitId: e.unit_id,
      unitPath: path(e.unit_id),
      isPrimary: e.is_primary,
      isActive: e.is_active,
      confidence: e.confidence == null ? null : Number(e.confidence),
      judgedBy: e.judged_by,
      rationale: e.rationale,
      createdAt: iso(e.created_at),
      supersededAt: iso(e.superseded_at),
      supersededBy: e.superseded_by == null ? null : Number(e.superseded_by),
    })),
  };
}
