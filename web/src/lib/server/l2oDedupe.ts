import type { PoolClient } from "pg";
import { components, cosine, judgePair, normalizeText, pickRepresentative } from "@/lib/l2o/dedupe";
import { embedTexts } from "./embedding";
import { jevSameConcept } from "./jev";
import { getConceptsByIds, listActiveConcepts, type LegacyConcept } from "./legacyDb";
import { pool } from "./l2oPool";

// 중복제거 (specs/math_concepts2ontology.md 5.1). confirmed / manual 그룹은 건드리지 않고 나머지만 다시 계산한다.
const SIM_THRESHOLD = Number(process.env.DEDUPE_SIM_THRESHOLD) || 0.92;
const CONCURRENCY = Number(process.env.SELECTOR_CONCURRENCY) || 4;

type Method = "exact" | "embedding" | "jev" | "manual";
type NewGroup = { members: number[]; rep: number; method: Method; status: "auto" | "needs_review"; similarity: Map<number, number> };

export type DedupeSummary = {
  jobId: string;
  active: number;
  locked: number;
  groups: number;
  multiMemberGroups: number;
  needsReview: number;
  candidatePairs: number;
  jevMerged: number;
  jevReview: number;
  jevErrors: number;
  jevReused: number;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

const repInfo = (c: LegacyConcept) => ({
  id: c.id,
  hasHtmlStatement: c.hasHtmlStatement,
  statementLength: c.statement.length,
  curriculumYear: c.curriculumYear,
});

export async function runDedupe(actor: string): Promise<DedupeSummary> {
  const job = await pool.query(
    `INSERT INTO l2o.job_run (kind, scope, status, created_by, started_at) VALUES ('dedupe', '{"all":true}', 'running', $1, now()) RETURNING id`,
    [actor]
  );
  const jobId: string = job.rows[0].id;
  try {
    const summary = await computeAndSave(jobId, actor);
    await pool.query(
      `UPDATE l2o.job_run SET status='done', total=$2, processed=$2, succeeded=$3, needs_review=$4, failed=$5, finished_at=now() WHERE id=$1`,
      [jobId, summary.active, summary.groups, summary.needsReview, summary.jevErrors]
    );
    return summary;
  } catch (e) {
    await pool.query(`UPDATE l2o.job_run SET status='failed', error=$2, finished_at=now() WHERE id=$1`, [jobId, String(e)]);
    throw e;
  }
}

async function computeAndSave(jobId: string, actor: string): Promise<DedupeSummary> {
  const active = await listActiveConcepts();
  const byId = new Map(active.map((c) => [c.id, c]));

  // 7. 잠긴(확정·수동) 그룹의 멤버는 재계산에서 뺀다
  const lockedRows = await pool.query(
    `SELECT m.legacy_concept_id FROM l2o.dedupe_member m JOIN l2o.dedupe_group g ON g.id = m.group_id
      WHERE g.status = 'confirmed' OR g.method = 'manual'`
  );
  const locked = new Set(lockedRows.rows.map((r) => Number(r.legacy_concept_id)));
  const free = active.filter((c) => !locked.has(c.id));

  // 3. exact: (정규화 제목, 정규화 본문) 동일
  const exactPairs: [number, number][] = [];
  const firstByKey = new Map<string, number>();
  for (const c of free) {
    const k = normalizeText(c.title) + "\u0000" + normalizeText(c.statement);
    const f = firstByKey.get(k);
    if (f == null) firstByKey.set(k, c.id);
    else exactPairs.push([f, c.id]);
  }
  const exactClusters = components(free.map((c) => c.id), exactPairs);
  const clusterOf = new Map<number, number>(); // concept id → exact cluster 대표(첫 id)
  for (const g of exactClusters) for (const id of g) clusterOf.set(id, g[0]);

  // 4. 임베딩 후보: exact 클러스터 대표끼리, 같은 school_type + math_field 블록 안에서 코사인 ≥ 임계값
  const heads = exactClusters.map((g) => byId.get(g[0])!);
  const vectors = await embedTexts(heads.map((c) => `${c.title}\n${c.statement}`));
  const vecOf = new Map(heads.map((c, i) => [c.id, vectors[i]]));
  const candidates: { a: LegacyConcept; b: LegacyConcept; sim: number }[] = [];
  for (let i = 0; i < heads.length; i++) {
    for (let j = i + 1; j < heads.length; j++) {
      const a = heads[i], b = heads[j];
      if (a.schoolType !== b.schoolType || a.mathField !== b.mathField) continue;
      const sim = cosine(vectors[i], vectors[j]);
      if (sim >= SIM_THRESHOLD) candidates.push({ a, b, sim });
    }
  }

  // 5. JEV same|different. 이미 판정한 쌍은 l2o.dedupe_pair 의 결과를 재사용한다(재실행 결과 고정·재호출 없음).
  const saved = await pool.query(`SELECT a, b, same_prob FROM l2o.dedupe_pair`);
  const savedProb = new Map(saved.rows.map((r) => [`${r.a}:${r.b}`, Number(r.same_prob)]));
  let jevErrors = 0;
  let jevReused = 0;
  const judged = await mapLimit(candidates, CONCURRENCY, async (p) => {
    const [a, b] = p.a.id < p.b.id ? [p.a.id, p.b.id] : [p.b.id, p.a.id];
    let prob: number | null = savedProb.get(`${a}:${b}`) ?? null;
    if (prob != null) jevReused++;
    else {
      try {
        prob = await jevSameConcept(p.a, p.b);
        await pool.query(
          `INSERT INTO l2o.dedupe_pair (a, b, similarity, same_prob, model) VALUES ($1, $2, $3, $4, 'jev-latest') ON CONFLICT (a, b) DO NOTHING`,
          [a, b, p.sim, prob]
        );
      } catch {
        jevErrors++; // 오류는 저장하지 않음 → 다음 실행에서 다시 판정
      }
    }
    return { ...p, verdict: judgePair(prob) };
  });
  const mergePairs = judged.filter((p) => p.verdict !== "separate").map((p) => [p.a.id, p.b.id] as [number, number]);
  const reviewHeads = new Set(judged.filter((p) => p.verdict === "review").flatMap((p) => [p.a.id, p.b.id]));
  const jevHeads = new Set(judged.filter((p) => p.verdict !== "separate").flatMap((p) => [p.a.id, p.b.id]));
  const directMerge = new Set(judged.filter((p) => p.verdict === "merge").map((p) => `${Math.min(p.a.id, p.b.id)}:${Math.max(p.a.id, p.b.id)}`));
  // 꼬리물기(A=B, B=C 로만 이어진 A·C) 방지: 묶인 exact 클러스터끼리 모든 쌍이 직접 merge 판정이어야 자동 확정
  const isClique = (hs: number[]) => hs.every((x, i) => hs.slice(i + 1).every((y) => directMerge.has(`${Math.min(x, y)}:${Math.max(x, y)}`)));

  // 최종 그룹 = exact 클러스터를 JEV 병합(·검토) 쌍으로 다시 묶은 것
  const groups: NewGroup[] = components(heads.map((c) => c.id), mergePairs).map((hs) => {
    const members = exactClusters.filter((g) => hs.includes(g[0])).flat().sort((x, y) => x - y);
    const rep = pickRepresentative(members.map((id) => repInfo(byId.get(id)!)));
    const repVec = vecOf.get(clusterOf.get(rep)!)!;
    const similarity = new Map(members.map((id) => [id, id === rep || clusterOf.get(id) === clusterOf.get(rep) ? 1 : cosine(repVec, vecOf.get(clusterOf.get(id)!)!)]));
    const usedJev = hs.some((h) => jevHeads.has(h));
    return {
      members,
      rep,
      method: usedJev ? "jev" : "exact",
      status: hs.some((h) => reviewHeads.has(h)) || !isClique(hs) ? "needs_review" : "auto",
      similarity,
    };
  });

  await saveGroups(groups, new Set(active.map((c) => c.id)), jobId, actor);

  return {
    jobId,
    active: active.length,
    locked: locked.size,
    groups: groups.length,
    multiMemberGroups: groups.filter((g) => g.members.length > 1).length,
    needsReview: groups.filter((g) => g.status === "needs_review").length,
    candidatePairs: candidates.length,
    jevMerged: judged.filter((p) => p.verdict === "merge").length,
    jevReview: judged.filter((p) => p.verdict === "review").length,
    jevErrors,
    jevReused,
  };
}

// 미확정 그룹을 새 계산 결과로 바꾼다. 대표가 같은 기존 그룹은 id 를 재사용(투표 이력 유지).
async function saveGroups(groups: NewGroup[], activeIds: Set<number>, jobId: string, actor: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const old = await client.query(
      `SELECT g.id, g.representative_legacy_id, COALESCE(array_agg(m.legacy_concept_id ORDER BY m.legacy_concept_id) FILTER (WHERE m.legacy_concept_id IS NOT NULL), '{}') AS members
         FROM l2o.dedupe_group g LEFT JOIN l2o.dedupe_member m ON m.group_id = g.id
        WHERE g.status <> 'confirmed' AND g.method <> 'manual'
        GROUP BY g.id`
    );
    const oldByRep = new Map(old.rows.map((r) => [Number(r.representative_legacy_id), { id: Number(r.id), members: (r.members as string[]).map(Number) }]));
    const kept = new Set<number>();

    for (const g of groups) {
      const prev = oldByRep.get(g.rep);
      let groupId: number;
      if (prev) {
        groupId = prev.id;
        kept.add(groupId);
        await client.query(`UPDATE l2o.dedupe_group SET method=$2, status=$3, updated_at=now() WHERE id=$1`, [groupId, g.method, g.status]);
        if (prev.members.join(",") !== g.members.join(",")) {
          await resetResult(client, groupId, jobId);
          await history(client, groupId, "create", { members: prev.members }, { members: g.members, job: jobId }, actor);
        }
      } else {
        const r = await client.query(
          `INSERT INTO l2o.dedupe_group (representative_legacy_id, method, status) VALUES ($1, $2, $3) RETURNING id`,
          [g.rep, g.method, g.status]
        );
        groupId = Number(r.rows[0].id);
        await history(client, groupId, "create", null, { members: g.members, rep: g.rep, method: g.method, job: jobId }, actor);
      }
      for (const id of g.members) {
        await client.query(
          `INSERT INTO l2o.dedupe_member (legacy_concept_id, group_id, similarity, added_by) VALUES ($1, $2, $3, 'system')
           ON CONFLICT (legacy_concept_id) DO UPDATE SET group_id = EXCLUDED.group_id, similarity = EXCLUDED.similarity, added_by = 'system'`,
          [id, groupId, g.similarity.get(id) ?? null]
        );
      }
    }

    // is_on=0 이 된 개념은 미확정 그룹에서 뺀다
    await client.query(
      `DELETE FROM l2o.dedupe_member m USING l2o.dedupe_group g
        WHERE g.id = m.group_id AND g.status <> 'confirmed' AND g.method <> 'manual' AND NOT (m.legacy_concept_id = ANY($1::bigint[]))`,
      [[...activeIds]]
    );
    // 멤버가 없어진 옛 그룹: 투표 기록이 없으면 지우고, 있으면(이력 보존) 남긴다
    const orphanIds = old.rows.map((r) => Number(r.id)).filter((id) => !kept.has(id));
    if (orphanIds.length) {
      await client.query(
        `DELETE FROM l2o.migration_result r WHERE r.group_id = ANY($1::bigint[])
           AND NOT EXISTS (SELECT 1 FROM l2o.dedupe_member m WHERE m.group_id = r.group_id)
           AND NOT EXISTS (SELECT 1 FROM l2o.selector_vote v WHERE v.group_id = r.group_id)`,
        [orphanIds]
      );
      await client.query(
        `DELETE FROM l2o.dedupe_group g WHERE g.id = ANY($1::bigint[])
           AND NOT EXISTS (SELECT 1 FROM l2o.dedupe_member m WHERE m.group_id = g.id)
           AND NOT EXISTS (SELECT 1 FROM l2o.selector_vote v WHERE v.group_id = g.id)
           AND NOT EXISTS (SELECT 1 FROM l2o.migration_result r WHERE r.group_id = g.id)`,
        [orphanIds]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function history(client: PoolClient, groupId: number, action: string, before: unknown, after: unknown, actor: string) {
  await client.query(`INSERT INTO l2o.dedupe_history (group_id, action, before, after, actor) VALUES ($1, $2, $3, $4, $5)`, [
    groupId,
    action,
    before == null ? null : JSON.stringify(before),
    after == null ? null : JSON.stringify(after),
    actor,
  ]);
}

// 묶음이 바뀐 그룹은 단원을 다시 골라야 한다
async function resetResult(client: PoolClient, groupId: number, jobId: string | null) {
  await client.query(
    `UPDATE l2o.migration_result SET status='pending', majority_unit_id=NULL, agree_count=NULL, final_unit_id=NULL, last_job_run_id=$2, updated_at=now()
      WHERE group_id=$1`,
    [groupId, jobId]
  );
}

// ---------- 편집 (5.1.8): 편집된 그룹은 manual·confirmed 가 되어 재실행에서 보존된다 ----------

export class EditError extends Error {}

async function groupOf(client: PoolClient, legacyId: number) {
  const r = await client.query(
    `SELECT g.id, g.representative_legacy_id, g.method, g.status FROM l2o.dedupe_member m JOIN l2o.dedupe_group g ON g.id = m.group_id
      WHERE m.legacy_concept_id = $1`,
    [legacyId]
  );
  if (!r.rows[0]) throw new EditError(`#${legacyId} 는 그룹이 없습니다. 먼저 중복제거를 실행하세요.`);
  return { id: Number(r.rows[0].id), rep: Number(r.rows[0].representative_legacy_id), method: r.rows[0].method, status: r.rows[0].status };
}

async function membersOf(client: PoolClient, groupId: number): Promise<number[]> {
  const r = await client.query(`SELECT legacy_concept_id FROM l2o.dedupe_member WHERE group_id = $1 ORDER BY legacy_concept_id`, [groupId]);
  return r.rows.map((x) => Number(x.legacy_concept_id));
}

async function markEdited(client: PoolClient, groupId: number, rep: number) {
  await client.query(
    `UPDATE l2o.dedupe_group SET representative_legacy_id=$2, method='manual', status='confirmed', updated_at=now() WHERE id=$1`,
    [groupId, rep]
  );
  await resetResult(client, groupId, null);
}

async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// 대표가 빠진 그룹은 남은 멤버로 대표를 다시 고른다
async function repickRep(client: PoolClient, groupId: number, rep: number, actor: string) {
  const members = await membersOf(client, groupId);
  if (members.length === 0 || members.includes(rep)) {
    if (members.length) await markEdited(client, groupId, rep);
    return;
  }
  const concepts = await getConceptsByIds(members);
  const next = pickRepresentative(concepts.map(repInfo));
  await markEdited(client, groupId, next);
  await history(client, groupId, "set_rep", { rep }, { rep: next, reason: "대표가 그룹에서 빠짐" }, actor);
}

// 병합: 선택한 개념들을 대표의 그룹으로 옮긴다
export async function mergeConcepts(legacyIds: number[], representativeId: number, actor: string) {
  if (!legacyIds.includes(representativeId)) throw new EditError("대표는 선택한 개념 중 하나여야 합니다.");
  return inTx(async (client) => {
    const target = await groupOf(client, representativeId);
    const before = await membersOf(client, target.id);
    const touched = new Map<number, number>(); // 옮겨지기 전 그룹 id → 그 그룹의 대표
    for (const id of legacyIds) {
      const g = await groupOf(client, id);
      if (g.id === target.id) continue;
      touched.set(g.id, g.rep);
      await client.query(`UPDATE l2o.dedupe_member SET group_id=$2, similarity=NULL, added_by=$3 WHERE legacy_concept_id=$1`, [id, target.id, actor]);
    }
    await markEdited(client, target.id, representativeId);
    await history(client, target.id, "merge", { members: before, rep: target.rep }, { members: await membersOf(client, target.id), rep: representativeId }, actor);
    for (const [gid, rep] of touched) await repickRep(client, gid, rep, actor);
    return { groupId: target.id };
  });
}

// 분리: 멤버 하나를 1인 그룹으로
export async function splitConcept(legacyId: number, actor: string) {
  return inTx(async (client) => {
    const g = await groupOf(client, legacyId);
    const before = await membersOf(client, g.id);
    if (before.length === 1) throw new EditError("이미 혼자인 그룹입니다.");
    const r = await client.query(
      `INSERT INTO l2o.dedupe_group (representative_legacy_id, method, status) VALUES ($1, 'manual', 'confirmed') RETURNING id`,
      [legacyId]
    );
    const newId = Number(r.rows[0].id);
    await client.query(`UPDATE l2o.dedupe_member SET group_id=$2, similarity=NULL, added_by=$3 WHERE legacy_concept_id=$1`, [legacyId, newId, actor]);
    await history(client, g.id, "split", { members: before }, { members: before.filter((x) => x !== legacyId), splitTo: newId }, actor);
    await history(client, newId, "create", null, { members: [legacyId], from: g.id }, actor);
    await repickRep(client, g.id, g.rep, actor);
    return { groupId: newId };
  });
}

// 대표 변경
export async function setRepresentative(groupId: number, legacyId: number, actor: string) {
  return inTx(async (client) => {
    const g = await groupOf(client, legacyId);
    if (g.id !== groupId) throw new EditError(`#${legacyId} 는 그룹 ${groupId} 의 멤버가 아닙니다.`);
    await markEdited(client, groupId, legacyId);
    await history(client, groupId, "set_rep", { rep: g.rep }, { rep: legacyId }, actor);
    return { groupId };
  });
}

// 그룹 편집 창용: 멤버(제목 포함) + 이력
export async function getGroupDetail(groupId: number) {
  const g = await pool.query(`SELECT id, representative_legacy_id, method, status FROM l2o.dedupe_group WHERE id = $1`, [groupId]);
  if (!g.rows[0]) return null;
  const m = await pool.query(`SELECT legacy_concept_id, similarity, added_by FROM l2o.dedupe_member WHERE group_id = $1 ORDER BY legacy_concept_id`, [groupId]);
  const concepts = new Map((await getConceptsByIds(m.rows.map((r) => Number(r.legacy_concept_id)))).map((c) => [c.id, c]));
  const h = await pool.query(`SELECT action, before, after, actor, created_at FROM l2o.dedupe_history WHERE group_id = $1 ORDER BY created_at DESC, id DESC`, [groupId]);
  return {
    id: Number(g.rows[0].id),
    representativeId: Number(g.rows[0].representative_legacy_id),
    method: g.rows[0].method as string,
    status: g.rows[0].status as string,
    members: m.rows.map((r) => {
      const c = concepts.get(Number(r.legacy_concept_id));
      return { id: Number(r.legacy_concept_id), title: c?.title ?? "", statement: c?.statement ?? "", similarity: r.similarity as number | null, addedBy: r.added_by as string };
    }),
    history: h.rows.map((r) => ({ action: r.action as string, before: r.before, after: r.after, actor: r.actor as string, at: new Date(r.created_at).toISOString() })),
  };
}

// 묶음 검토: 자동으로 묶은 그룹이 맞다고 사람이 확인 → confirmed (재실행에서 보존). 멤버가 그대로라 단원 결과·KG 는 건드리지 않는다.
export async function confirmGroup(groupId: number, actor: string) {
  return inTx(async (client) => {
    const g = await client.query(`SELECT status, method FROM l2o.dedupe_group WHERE id = $1 FOR UPDATE`, [groupId]);
    if (!g.rows[0]) throw new EditError(`없는 그룹입니다: ${groupId}`);
    if (g.rows[0].status !== "needs_review") throw new EditError(`묶음 검토 대상이 아닙니다 (${g.rows[0].status}).`);
    await client.query(`UPDATE l2o.dedupe_group SET status = 'confirmed', updated_at = now() WHERE id = $1`, [groupId]);
    await history(client, groupId, "confirm", { status: g.rows[0].status }, { status: "confirmed" }, actor);
    return { groupId };
  });
}
