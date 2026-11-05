import type { JobVM } from "@/lib/l2o/types";
import { listConcepts } from "./legacyDb";
import { pool } from "./l2oPool";
import { selectForGroup } from "./l2oSelect";
import { PROMPT_VERSION } from "./selectors/common";

// 단원 선택 일괄 작업 (specs/math_concepts2ontology.md 5.6·5.7·8). 같은 서버 프로세스 안에서 백그라운드로 돈다.
// 그룹은 대표 legacy id 순으로 BATCH 개씩 처리하고, 배치가 끝날 때마다 cursor_legacy_id 를 저장한다(재개 지점).
// 일시정지/취소는 DB status 를 바꾸고, 러너는 다음 배치 전에 status 를 확인해 멈춘다.

export type JobKind = "test" | "migrate_all";
export type { JobVM };

const BATCH = Number(process.env.SELECTOR_CONCURRENCY) || 4;

// HMR 로 모듈이 다시 읽혀도 실행 중 러너를 잃지 않게 globalThis 에 둔다
const g = globalThis as unknown as { __l2oRunners?: Set<string> };
const runners = (g.__l2oRunners ??= new Set<string>());

export class JobError extends Error {
  constructor(message: string, readonly status = 400, readonly jobId?: string) {
    super(message);
  }
}

const toVM = (r: Record<string, unknown>): JobVM => ({
  id: String(r.id),
  kind: String(r.kind),
  dryRun: Boolean(r.dry_run),
  status: String(r.status),
  total: Number(r.total),
  processed: Number(r.processed),
  succeeded: Number(r.succeeded),
  needsReview: Number(r.needs_review),
  failed: Number(r.failed),
  error: (r.error as string | null) ?? null,
  startedAt: r.started_at ? new Date(r.started_at as string).toISOString() : null,
  finishedAt: r.finished_at ? new Date(r.finished_at as string).toISOString() : null,
});

// 서버 재시작 등으로 러너 없이 running 으로 남은 작업은 paused 로 돌린다(재개 가능)
async function reapOrphans() {
  const r = await pool.query(`SELECT id FROM l2o.job_run WHERE status = 'running' AND kind IN ('test', 'migrate_all')`);
  const orphans = r.rows.map((x) => String(x.id)).filter((id) => !runners.has(id));
  if (orphans.length) await pool.query(`UPDATE l2o.job_run SET status = 'paused' WHERE id = ANY($1::uuid[])`, [orphans]);
}

export async function getJob(id: string): Promise<JobVM | null> {
  await reapOrphans();
  const r = await pool.query(`SELECT * FROM l2o.job_run WHERE id = $1`, [id]);
  return r.rows[0] ? toVM(r.rows[0]) : null;
}

// 화면 새로고침 후 진행 바 복원용: 실행 중이거나 일시정지된 최신 작업
export async function getActiveJob(): Promise<JobVM | null> {
  await reapOrphans();
  const r = await pool.query(
    `SELECT * FROM l2o.job_run WHERE kind IN ('test', 'migrate_all') AND status IN ('running', 'paused') ORDER BY created_at DESC LIMIT 1`
  );
  return r.rows[0] ? toVM(r.rows[0]) : null;
}

// 대상: page 의 is_on 행 · 선택한 legacy id · 전체 → 해당 그룹(중복 제거). 대표 legacy id 순.
export type JobScope = { page: number; pageSize: number } | { ids: number[] } | { all: true };

async function resolveGroups(scope: JobScope): Promise<{ id: number; rep: number }[]> {
  let legacyIds: number[] | null = null;
  if ("page" in scope) legacyIds = (await listConcepts((scope.page - 1) * scope.pageSize, scope.pageSize)).filter((c) => c.isOn).map((c) => c.id);
  else if ("ids" in scope) legacyIds = scope.ids;
  const r = await pool.query(
    `SELECT DISTINCT g.id, g.representative_legacy_id AS rep
       FROM l2o.dedupe_group g JOIN l2o.dedupe_member m ON m.group_id = g.id
      WHERE ($1::bigint[] IS NULL OR m.legacy_concept_id = ANY($1::bigint[]))
      ORDER BY rep`,
    [legacyIds]
  );
  return r.rows.map((x) => ({ id: Number(x.id), rep: Number(x.rep) }));
}

export async function startJob(kind: JobKind, scope: JobScope, actor: string): Promise<JobVM> {
  await reapOrphans();
  // 선택기 호출 한도를 나눠 쓰고 진행 바도 하나이므로 단원 선택 작업은 하나씩만. 일시정지된 작업은 재개하거나 취소해야 새로 시작한다.
  const busy = await pool.query(
    `SELECT id, status FROM l2o.job_run WHERE kind IN ('test', 'migrate_all') AND status IN ('running', 'paused') ORDER BY created_at DESC LIMIT 1`
  );
  if (busy.rows[0])
    throw new JobError(
      busy.rows[0].status === "running" ? "이미 실행 중인 작업이 있습니다." : "일시정지된 작업이 있습니다. 재개하거나 취소한 뒤 시작하세요.",
      409,
      String(busy.rows[0].id)
    );
  const groups = await resolveGroups(scope);
  if (!groups.length) throw new JobError("대상 그룹이 없습니다. 먼저 중복제거를 실행하세요.");
  // 대상 그룹 목록을 scope 에 함께 저장(재개 시 같은 대상)
  const r = await pool.query(
    `INSERT INTO l2o.job_run (kind, dry_run, scope, status, total, created_by, started_at)
     VALUES ($1, $2, $3, 'running', $4, $5, now()) RETURNING *`,
    [kind, kind === "test", JSON.stringify({ ...scope, groupIds: groups.map((x) => x.id) }), groups.length, actor]
  );
  const job = toVM(r.rows[0]);
  launch(job.id);
  return job;
}

export async function controlJob(id: string, action: "pause" | "resume" | "cancel"): Promise<JobVM> {
  const job = await getJob(id);
  if (!job) throw new JobError("없는 작업입니다.", 404);
  if (action === "pause") {
    if (job.status !== "running") throw new JobError(`실행 중이 아닙니다 (${job.status}).`, 409);
    await pool.query(`UPDATE l2o.job_run SET status = 'paused' WHERE id = $1 AND status = 'running'`, [id]);
  } else if (action === "cancel") {
    if (job.status !== "running" && job.status !== "paused") throw new JobError(`이미 끝난 작업입니다 (${job.status}).`, 409);
    await pool.query(`UPDATE l2o.job_run SET status = 'cancelled', finished_at = now() WHERE id = $1`, [id]);
  } else {
    if (job.status !== "paused") throw new JobError(`일시정지 상태가 아닙니다 (${job.status}).`, 409);
    const busy = await pool.query(`SELECT id FROM l2o.job_run WHERE kind IN ('test', 'migrate_all') AND status = 'running' AND id <> $1 LIMIT 1`, [id]);
    if (busy.rows[0]) throw new JobError("다른 작업이 실행 중입니다.", 409, String(busy.rows[0].id));
    await pool.query(`UPDATE l2o.job_run SET status = 'running', error = NULL WHERE id = $1`, [id]);
    launch(id);
  }
  return (await getJob(id))!;
}

function launch(id: string) {
  if (runners.has(id)) return;
  runners.add(id);
  run(id)
    .catch(async (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      await pool.query(`UPDATE l2o.job_run SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [id, msg]).catch(() => {});
    })
    .finally(() => runners.delete(id));
}

async function run(id: string) {
  const j = await pool.query(`SELECT kind, dry_run, scope, cursor_legacy_id FROM l2o.job_run WHERE id = $1`, [id]);
  const { dry_run: dryRun, scope, cursor_legacy_id } = j.rows[0];
  const groupIds: number[] = scope.groupIds ?? [];
  const cursor = cursor_legacy_id == null ? -1 : Number(cursor_legacy_id);
  // 재개: cursor 이후 그룹만 (그룹 편집으로 대표가 바뀌었을 수 있으니 현재 대표로 다시 정렬)
  const r = await pool.query(
    `SELECT id, representative_legacy_id AS rep FROM l2o.dedupe_group WHERE id = ANY($1::bigint[]) AND representative_legacy_id > $2 ORDER BY rep`,
    [groupIds, cursor]
  );
  const todo = r.rows.map((x) => ({ id: Number(x.id), rep: Number(x.rep) }));

  for (let i = 0; i < todo.length; i += BATCH) {
    const st = await pool.query(`SELECT status FROM l2o.job_run WHERE id = $1`, [id]);
    if (st.rows[0]?.status !== "running") return; // paused / cancelled
    const batch = todo.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map((x) => selectForGroup(x.id, { jobId: id, dryRun })));
    let ok = 0, review = 0, failed = 0;
    const errors: string[] = [];
    results.forEach((res) => {
      if (res.status === "rejected") {
        failed++;
        errors.push(String(res.reason instanceof Error ? res.reason.message : res.reason).slice(0, 200));
      } else if (res.value.status === "needs_review") review++;
      else ok++; // auto_agreed · 건너뜀(overridden/migrated)
    });
    await pool.query(
      `UPDATE l2o.job_run SET processed = processed + $2, succeeded = succeeded + $3, needs_review = needs_review + $4, failed = failed + $5,
              cursor_legacy_id = $6, error = COALESCE($7, error) WHERE id = $1`,
      [id, batch.length, ok, review, failed, batch[batch.length - 1].rep, errors[0] ?? null]
    );
  }
  await pool.query(`UPDATE l2o.job_run SET status = 'done', finished_at = now() WHERE id = $1 AND status = 'running'`, [id]);
}

// 모두 이전 확인 창: 대상 그룹 수(수동·이전됨 제외), 예상 호출 수(이미 성공 표가 있는 선택기는 제외)
export async function migratePreview() {
  const r = await pool.query(
    `SELECT count(*)::int AS groups,
            count(*) FILTER (WHERE r.status IN ('overridden', 'migrated'))::int AS skipped,
            COALESCE(sum(3 - (SELECT count(DISTINCT v.selector) FROM l2o.selector_vote v
                               WHERE v.group_id = g.id AND v.error IS NULL AND v.prompt_version = $1))
                     FILTER (WHERE r.status IS NULL OR r.status NOT IN ('overridden', 'migrated')), 0)::int AS calls
       FROM l2o.dedupe_group g LEFT JOIN l2o.migration_result r ON r.group_id = g.id
      WHERE EXISTS (SELECT 1 FROM l2o.dedupe_member m WHERE m.group_id = g.id)`,
    [PROMPT_VERSION]
  );
  const x = r.rows[0];
  return { groups: x.groups, targets: x.groups - x.skipped, skipped: x.skipped, expectedCalls: x.calls };
}

// 테스트 요약: 작업 대상 그룹의 최신 표(재사용 포함)로 자동일치·검토·오류 수, 선택기별 평균 지연·다수 의견과의 일치율
export async function jobSummary(id: string) {
  const j = await pool.query(`SELECT scope FROM l2o.job_run WHERE id = $1`, [id]);
  if (!j.rows[0]) return null;
  const groupIds: number[] = j.rows[0].scope.groupIds ?? [];
  const res = await pool.query(
    `SELECT status, count(*)::int AS n FROM l2o.migration_result WHERE group_id = ANY($1::bigint[]) GROUP BY status`,
    [groupIds]
  );
  const sel = await pool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (v.group_id, v.selector) v.group_id, v.selector, v.selected_unit_id, v.error, v.latency_ms
         FROM l2o.selector_vote v WHERE v.group_id = ANY($1::bigint[]) ORDER BY v.group_id, v.selector, v.created_at DESC)
     SELECT l.selector, count(*)::int AS votes, count(*) FILTER (WHERE l.error IS NOT NULL)::int AS errors,
            round(avg(l.latency_ms))::int AS avg_ms,
            count(*) FILTER (WHERE r.majority_unit_id IS NOT NULL AND l.selected_unit_id = r.majority_unit_id)::int AS agree,
            count(*) FILTER (WHERE r.majority_unit_id IS NOT NULL)::int AS judged
       FROM latest l LEFT JOIN l2o.migration_result r ON r.group_id = l.group_id
      GROUP BY l.selector ORDER BY l.selector`,
    [groupIds]
  );
  const byStatus = Object.fromEntries(res.rows.map((x) => [x.status, x.n]));
  return {
    groups: groupIds.length,
    autoAgreed: (byStatus.auto_agreed ?? 0) + (byStatus.migrated ?? 0),
    needsReview: byStatus.needs_review ?? 0,
    selectors: sel.rows.map((x) => ({
      selector: x.selector,
      votes: x.votes,
      errors: x.errors,
      avgMs: x.avg_ms,
      agreeRate: x.judged ? Math.round((x.agree / x.judged) * 100) : null,
    })),
  };
}
