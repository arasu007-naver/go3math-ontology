import { createClaudeBatchAdapter, type ClaudeBatchClient } from "@/lib/e2c/adapters/batch/claude";
import { createGeminiBatchAdapter } from "@/lib/e2c/adapters/batch/gemini";
import { createGrokBatchAdapter } from "@/lib/e2c/adapters/batch/grok";
import { createClaudeAdapter } from "@/lib/e2c/adapters/claude";
import { createGeminiAdapter } from "@/lib/e2c/adapters/gemini";
import { createGrokAdapter } from "@/lib/e2c/adapters/grok";
import { createJevAdapter } from "@/lib/e2c/adapters/jev";
import { conceptOptionText, unitOptionText } from "@/lib/e2c/candidates";
import { DEFAULT_CONFIG, mergeConfig, type E2cConfig } from "@/lib/e2c/config";
import { cachedEmbed, type EmbedStore } from "@/lib/e2c/embedCache";
import { pilotSample, processingOrder } from "@/lib/e2c/pilot";
import type { PrecedenceGraph } from "@/lib/e2c/precedence";
import { trailingNumber } from "@/lib/e2c/precedence";
import { KG } from "@/lib/e2c/schema-names";
import { LOCKED_STATUSES, type ConceptOption, type ModelName, type UnitOption } from "@/lib/e2c/types";
import Anthropic from "@anthropic-ai/sdk";
import { embedTexts, EMBED_MODEL } from "./embedding";
import { countProblems, getProblems, listProblemIds } from "./e2cLegacyDb";
import { controlJob, launch, runners, startJob, toVM, type JobDeps, type JobKind, type JobRow, type JobScope, type JobStore, type StartInput } from "./e2cJobs";
import type { KgSource, NewCall, PipelineDeps, PipelineStore, ResultRow, StoredCall } from "./e2cPipeline";
import type { OverrideStore } from "./e2cOverride";
import { pool } from "./l2oPool";
import { listUnits } from "./l2oUnits";
import { stripHtml } from "./legacyDb";

// e2c 서비스: Postgres 저장소·KG·모델 어댑터를 파이프라인/러너 인터페이스에 연결한다. (테스트는 대체물을 주입하므로 이 파일을 쓰지 않는다)

const SUBJECT_ORDER = ["L3-HIGH-CM1", "L3-HIGH-CM2", "L3-HIGH-ALG", "L3-HIGH-CAL1", "L3-HIGH-PS", "L3-HIGH-CAL2", "L3-HIGH-GEO"];

// ---------- KG ----------
type KgCache = { units: UnitOption[]; graph: PrecedenceGraph };
let kgCache: Promise<KgCache> | null = null;

async function loadKg(): Promise<KgCache> {
  const base = (await listUnits()).filter((u) => u.unitId.startsWith(KG.unitLevelPrefix));
  const meta = await pool.query(
    `SELECT n.id, COALESCE((n.props->>'order')::int, 0) AS ord, n.props->>'description' AS description, p.id AS subject_id, p.props->>'name' AS subject_name,
            COALESCE((p.props->>'order')::int, 0) AS subject_ord
       FROM kg.nodes n JOIN kg.edges e ON e.dst = n.id AND e.type = 'HAS_CHILD' JOIN kg.nodes p ON p.id = e.src
      WHERE n.type = 'level' AND n.id LIKE $1`,
    [`${KG.unitLevelPrefix}%`]
  );
  const byId = new Map(meta.rows.map((r) => [String(r.id), r]));
  const subjectOrder: Record<string, number> = {};
  const unitSubject: Record<string, string> = {};
  const unitOrder: Record<string, number> = {};
  const units: UnitOption[] = base.flatMap((u) => {
    const m = byId.get(u.unitId);
    if (!m) return [];
    const parts = u.path.split(" > ");
    const name = parts[parts.length - 1];
    const subjectName = String(m.subject_name ?? parts[1] ?? "");
    const idx = SUBJECT_ORDER.indexOf(String(m.subject_id));
    subjectOrder[m.subject_id] = Number(m.subject_ord) || (idx >= 0 ? idx + 1 : 100);
    unitSubject[u.unitId] = String(m.subject_id);
    const order = Number(m.ord) || trailingNumber(u.unitId);
    unitOrder[u.unitId] = order;
    return [{ unitId: u.unitId, subjectId: String(m.subject_id), subjectName, name, order, text: unitOptionText(subjectName, name, m.description ?? undefined) }];
  });
  const edges = await pool.query(`SELECT src, dst, type FROM kg.edges WHERE type IN ($1, $2)`, [KG.unitPrecedes, KG.subjectPrecedes]);
  const unitPrereq: [string, string][] = [];
  const subjectPrereq: [string, string][] = [];
  for (const e of edges.rows) {
    if (e.type === KG.unitPrecedes && unitSubject[e.src] && unitSubject[e.dst]) unitPrereq.push([e.src, e.dst]);
    else if (e.type === KG.subjectPrecedes && e.src in subjectOrder && e.dst in subjectOrder) subjectPrereq.push([e.src, e.dst]);
  }
  return { units, graph: { unitPrereq, subjectPrereq, unitSubject, subjectOrder, unitOrder } };
}
const kgData = () => (kgCache ??= loadKg().catch((e) => ((kgCache = null), Promise.reject(e))));

export const pgKg: KgSource = {
  async units() {
    return (await kgData()).units;
  },
  async graph() {
    return (await kgData()).graph;
  },
  async conceptsOfUnit(unitId: string): Promise<ConceptOption[]> {
    const r = await pool.query(
      `SELECT DISTINCT c.id, c.title, c.statement, t.text AS manual_text
         FROM ${KG.conceptUnitEdges} e JOIN ${KG.concepts} c ON c.id = e.concept_id
         LEFT JOIN e2c.concept_option_text t ON t.concept_id = c.id::text
        WHERE e.unit_id = $1 AND e.is_active ORDER BY c.id`,
      [unitId]
    );
    const fresh: { id: string; text: string }[] = [];
    const out = r.rows.map((x) => {
      const id = String(x.id);
      if (x.manual_text) return { conceptId: id, unitId, text: String(x.manual_text) };
      const text = conceptOptionText(stripHtml(x.title), stripHtml(x.statement));
      fresh.push({ id, text });
      return { conceptId: id, unitId, text };
    });
    if (fresh.length) {
      await pool.query(
        `INSERT INTO e2c.concept_option_text (concept_id, text, source) SELECT * FROM unnest($1::text[], $2::text[], $3::text[]) ON CONFLICT DO NOTHING`,
        [fresh.map((f) => f.id), fresh.map((f) => f.text), fresh.map(() => "auto")]
      );
    }
    return out;
  },
};

// ---------- 설정·어댑터·임베딩 ----------
export async function loadConfig(): Promise<E2cConfig> {
  const r = await pool.query(`SELECT key, value FROM e2c.config`);
  return mergeConfig(Object.fromEntries(r.rows.map((x) => [x.key, x.value])));
}

const pgEmbedStore: EmbedStore = {
  async getMany(hashes) {
    if (!hashes.length) return new Map();
    const r = await pool.query(`SELECT text_hash, vector FROM e2c.embedding_cache WHERE text_hash = ANY($1::text[])`, [hashes]);
    return new Map(r.rows.map((x) => [String(x.text_hash), x.vector as number[]]));
  },
  async putMany(entries) {
    if (!entries.length) return;
    await pool.query(
      `INSERT INTO e2c.embedding_cache (text_hash, model, vector) SELECT h, $2, v::jsonb FROM unnest($1::text[], $3::text[]) AS t(h, v) ON CONFLICT DO NOTHING`,
      [entries.map((e) => e.hash), EMBED_MODEL, entries.map((e) => JSON.stringify(e.vector))]
    );
  },
};

const conc = (name: string) => Number(process.env[`E2C_CONCURRENCY_${name}`]) || 4;

export const pgStore: PipelineStore = {
  async findCall(hash): Promise<StoredCall | null> {
    const r = await pool.query(`SELECT answer, model FROM e2c.model_call WHERE input_hash = $1 AND ok ORDER BY id DESC LIMIT 1`, [hash]);
    return r.rows[0] ? { ok: true, error: null, answer: r.rows[0].answer, modelVersion: r.rows[0].model } : null;
  },
  async insertCall(c: NewCall) {
    await pool.query(
      `INSERT INTO e2c.model_call (job_run_id, problem_id, stage, role, adapter, model, prompt_version, input_hash, ok, error, answer, raw_response,
         input_tokens, output_tokens, cached_input_tokens, cache_write_tokens, cost_usd, latency_ms, batch_id, batch_discount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [c.jobRunId, c.problemId, c.stage, c.role, c.adapter, c.model, c.promptVersion, c.inputHash, c.ok, c.error, JSON.stringify(c.answer), JSON.stringify(c.raw ?? null),
        c.usage.inputTokens, c.usage.outputTokens, c.usage.cachedInputTokens, c.usage.cacheWriteTokens, c.costUsd, c.latencyMs, c.batchId, c.batchDiscount]
    );
  },
  async getResult(id) {
    const r = await pool.query(`SELECT * FROM e2c.problem_result WHERE problem_id = $1`, [id]);
    return r.rows[0] ? rowToResult(r.rows[0]) : null;
  },
  async saveResult(row) {
    const r = await upsertResult(row, false);
    return r ? "saved" : "locked";
  },
};

export const rowToResult = (x: Record<string, unknown>): ResultRow => ({
  problemId: Number(x.problem_id), inputHash: String(x.input_hash ?? ""), status: x.status as ResultRow["status"], finalUnitId: (x.final_unit_id as string) ?? null,
  unitSource: (x.unit_decision_source as ResultRow["unitSource"]) ?? null, unitRule: (x.unit_rule as string) ?? null, primaryConceptId: (x.primary_concept_id as string) ?? null,
  secondaryConceptIds: (x.secondary_concept_ids as string[]) ?? [], conceptSource: (x.concept_decision_source as ResultRow["conceptSource"]) ?? null,
  reasons: (x.reasons as ResultRow["reasons"]) ?? [], truncated: !!x.truncated, candidateFallback: !!x.candidate_fallback, unitDetail: x.unit_detail ?? null,
  conceptDetail: x.concept_detail ?? null, error: (x.error as string) ?? null, rerunConcept: !!x.rerun_concept, jobRunId: (x.last_job_run_id as string) ?? null,
});

async function upsertResult(r: ResultRow, force: boolean, q: { query: typeof pool.query } = pool): Promise<boolean> {
  const res = await q.query(
    `INSERT INTO e2c.problem_result (problem_id, input_hash, status, final_unit_id, unit_decision_source, unit_rule, primary_concept_id, secondary_concept_ids,
       concept_decision_source, reasons, truncated, candidate_fallback, unit_detail, concept_detail, error, rerun_concept, last_job_run_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())
     ON CONFLICT (problem_id) DO UPDATE SET input_hash = EXCLUDED.input_hash, status = EXCLUDED.status, final_unit_id = EXCLUDED.final_unit_id,
       unit_decision_source = EXCLUDED.unit_decision_source, unit_rule = EXCLUDED.unit_rule, primary_concept_id = EXCLUDED.primary_concept_id,
       secondary_concept_ids = EXCLUDED.secondary_concept_ids, concept_decision_source = EXCLUDED.concept_decision_source, reasons = EXCLUDED.reasons,
       truncated = EXCLUDED.truncated, candidate_fallback = EXCLUDED.candidate_fallback, unit_detail = EXCLUDED.unit_detail, concept_detail = EXCLUDED.concept_detail,
       error = EXCLUDED.error, rerun_concept = EXCLUDED.rerun_concept, last_job_run_id = EXCLUDED.last_job_run_id, updated_at = now()
     ${force ? "" : `WHERE e2c.problem_result.status NOT IN ('overridden', 'confirmed', 'applied')`}`,
    [r.problemId, r.inputHash, r.status, r.finalUnitId, r.unitSource, r.unitRule, r.primaryConceptId, JSON.stringify(r.secondaryConceptIds), r.conceptSource,
      JSON.stringify(r.reasons), r.truncated, r.candidateFallback, JSON.stringify(r.unitDetail), JSON.stringify(r.conceptDetail), r.error, r.rerunConcept, r.jobRunId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function pipelineDeps(): Promise<PipelineDeps> {
  const config = await loadConfig();
  const jevOpts = { unitMinProb: config.jev_unit_min_prob, secondaryMinProb: config.jev_secondary_min_prob };
  return {
    store: pgStore,
    kg: pgKg,
    config,
    embed: cachedEmbed(pgEmbedStore, embedTexts, EMBED_MODEL),
    adapters: { jev: createJevAdapter(jevOpts), claude: createClaudeAdapter(), gemini: createGeminiAdapter(), grok: createGrokAdapter() },
    concurrency: { jev: conc("JEV"), claude: conc("CLAUDE"), gemini: conc("GEMINI"), grok: conc("GROK") },
  };
}

// ---------- job 저장소 ----------
const toJob = (x: Record<string, unknown>): JobRow => ({
  id: String(x.id), kind: x.kind as JobKind, mode: x.mode as JobRow["mode"], dryRun: !!x.dry_run, shadowGrok: !!x.shadow_grok, status: x.status as JobRow["status"],
  ids: (x.ids as number[]) ?? [], total: Number(x.total), processed: Number(x.processed), needsReview: Number(x.needs_review), failed: Number(x.failed),
  grokUnitCalls: Number(x.grok_unit_calls), grokConceptCalls: Number(x.grok_concept_calls), costUsd: Number(x.cost_usd), estimatedCostUsd: Number(x.estimated_cost_usd),
  cacheReusedCalls: Number(x.cache_reused_calls), reusedByModel: (x.reused_by_model as Record<string, number>) ?? {}, cachedInputTokens: Number(x.cached_input_tokens),
  inputTokens: Number(x.input_tokens), cursorProblemId: x.cursor_problem_id == null ? null : Number(x.cursor_problem_id), batchIds: (x.batch_ids as Record<string, string>) ?? {},
  xaiBatchIds: (x.xai_batch_ids as string[]) ?? [], wave: (x.wave as string) ?? null, error: (x.error as string) ?? null,
});

const COLS: Record<string, string> = {
  status: "status", processed: "processed", needsReview: "needs_review", failed: "failed", grokUnitCalls: "grok_unit_calls", grokConceptCalls: "grok_concept_calls", costUsd: "cost_usd",
  cacheReusedCalls: "cache_reused_calls", reusedByModel: "reused_by_model", cachedInputTokens: "cached_input_tokens", inputTokens: "input_tokens", cursorProblemId: "cursor_problem_id",
  batchIds: "batch_ids", xaiBatchIds: "xai_batch_ids", wave: "wave", error: "error",
};
const JSON_COLS = new Set(["reusedByModel", "batchIds", "xaiBatchIds"]);

export const pgJobs: JobStore = {
  async get(id) {
    const r = await pool.query(`SELECT * FROM e2c.job_run WHERE id = $1`, [id]);
    return r.rows[0] ? toJob(r.rows[0]) : null;
  },
  async patch(id, patch) {
    const sets: string[] = [];
    const args: unknown[] = [id];
    for (const [k, v] of Object.entries(patch)) {
      if (!COLS[k]) continue;
      args.push(JSON_COLS.has(k) ? JSON.stringify(v) : v);
      sets.push(`${COLS[k]} = $${args.length}`);
    }
    if (patch.status === "done" || patch.status === "cancelled" || patch.status === "failed") sets.push("finished_at = now()");
    // 사용자가 일시정지·취소한 작업을 러너의 진행 저장이 되살리지 않게, status 를 안 바꾸는 패치는 현재 상태를 건드리지 않는다
    if (sets.length) await pool.query(`UPDATE e2c.job_run SET ${sets.join(", ")} WHERE id = $1`, args);
  },
  async create(row, scope, actor) {
    const r = await pool.query(
      `INSERT INTO e2c.job_run (kind, mode, dry_run, shadow_grok, scope, ids, status, total, estimated_cost_usd, created_by, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,'running',$7,$8,$9, now()) RETURNING *`,
      [row.kind, row.mode, row.dryRun, row.shadowGrok, JSON.stringify(scope), JSON.stringify(row.ids), row.total, row.estimatedCostUsd, actor]
    );
    return toJob(r.rows[0]);
  },
  async findBusy() {
    await reapOrphans();
    const r = await pool.query(`SELECT * FROM e2c.job_run WHERE status = 'running' ORDER BY created_at DESC LIMIT 1`);
    return r.rows[0] ? toJob(r.rows[0]) : null;
  },
  async resolveScope(kind: JobKind, scope: JobScope) {
    const all = await listProblemIds();
    if ("pilot" in scope) return processingOrder(all.filter((x) => new Set(pilotSample(all)).has(x.id)));
    if ("ids" in scope) {
      const want = new Set(scope.ids);
      return processingOrder(all.filter((x) => want.has(x.id)));
    }
    if (kind === "rerun_review") {
      const r = await pool.query(`SELECT problem_id FROM e2c.problem_result WHERE status IN ('needs_review', 'error')`);
      const want = new Set(r.rows.map((x) => Number(x.problem_id)));
      return processingOrder(all.filter((x) => want.has(x.id)));
    }
    return processingOrder(all);
  },
  async estimateInputs(ids) {
    const c = await pool.query(`SELECT count(*)::int AS n FROM e2c.model_call WHERE ok AND problem_id = ANY($1::bigint[])`, [ids]);
    let avgChars = 1500;
    try {
      const sample = await getProblems(ids.slice(0, 50));
      if (sample.length) avgChars = Math.round(sample.reduce((n, p) => n + stripHtml(p.statement).length + stripHtml(p.note).length, 0) / sample.length);
    } catch {
      /* 원본을 못 읽으면 기본값 */
    }
    return { cachedCalls: c.rows[0].n, avgChars };
  },
};

// 서버 재시작 등으로 러너 없이 running 으로 남은 작업은 paused 로 돌린다(재개 가능)
async function reapOrphans() {
  const r = await pool.query(`SELECT id FROM e2c.job_run WHERE status = 'running'`);
  const orphans = r.rows.map((x) => String(x.id)).filter((id) => !runners.has(id));
  if (orphans.length) await pool.query(`UPDATE e2c.job_run SET status = 'paused' WHERE id = ANY($1::uuid[])`, [orphans]);
}

function batchAdapters(): JobDeps["batchAdapters"] {
  const out: JobDeps["batchAdapters"] = { grok: createGrokBatchAdapter() };
  if (process.env.GEMINI_API_KEY) out.gemini = createGeminiBatchAdapter();
  if (process.env.ANTHROPIC_API_KEY) out.claude = createClaudeBatchAdapter(new Anthropic({ maxRetries: 3 }) as unknown as ClaudeBatchClient);
  return out;
}

export async function jobDeps(): Promise<JobDeps> {
  return {
    pipeline: await pipelineDeps(),
    jobs: pgJobs,
    loadProblems: (ids) => getProblems(ids),
    budgetUsd: Number(process.env.E2C_BUDGET_USD) || 0,
    batchAdapters: batchAdapters(),
  };
}

export const jobVM = async (id: string) => {
  await reapOrphans();
  const j = await pgJobs.get(id);
  return j ? toVM(j, Number(process.env.E2C_BUDGET_USD) || 0) : null;
};
export async function activeJobVM() {
  await reapOrphans();
  const r = await pool.query(`SELECT id FROM e2c.job_run WHERE status IN ('running', 'paused') ORDER BY created_at DESC LIMIT 1`);
  return r.rows[0] ? jobVM(String(r.rows[0].id)) : null;
}

export async function startE2cJob(input: StartInput, actor: string) {
  const deps = await jobDeps();
  const r = await startJob(deps, input, actor);
  if ("job" in r) {
    void launch(deps, r.job.id);
    return { job: toVM(r.job, deps.budgetUsd) };
  }
  return r;
}
export async function controlE2cJob(id: string, action: "pause" | "resume" | "cancel") {
  const deps = await jobDeps();
  return toVM(await controlJob(deps, id, action), deps.budgetUsd);
}

// ---------- 수동 수정 저장소 ----------
export const pgOverrideStore: OverrideStore = {
  getResult: (id) => pgStore.getResult(id),
  async conceptIdsOfUnit(unitId) {
    const units = await pgKg.units();
    if (!units.some((u) => u.unitId === unitId)) return null;
    return (await pgKg.conceptsOfUnit(unitId)).map((c) => c.conceptId);
  },
  async saveOverride({ before, after, reason, actor }) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`INSERT INTO e2c.manual_override (problem_id, before, after, reason, actor) VALUES ($1,$2,$3,$4,$5)`, [after.problemId, JSON.stringify(before), JSON.stringify(after), reason, actor]);
      await upsertResult(after, true, c);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  },
  async saveConfirmed(row) {
    await upsertResult(row, true);
  },
  async savePilotLabel(l, actor) {
    await pool.query(
      `INSERT INTO e2c.pilot_label (problem_id, unit_id, primary_concept_id, secondary_concept_ids, labeler) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (problem_id) DO UPDATE SET unit_id = EXCLUDED.unit_id, primary_concept_id = EXCLUDED.primary_concept_id, secondary_concept_ids = EXCLUDED.secondary_concept_ids, labeler = EXCLUDED.labeler, updated_at = now()`,
      [l.problemId, l.unitId, l.primaryConceptId, JSON.stringify(l.secondaryConceptIds), actor]
    );
  },
};

export { LOCKED_STATUSES, DEFAULT_CONFIG, countProblems };
export type { ModelName };
