import { runBatch } from "../e2c/adapters/batch/common.ts";
import { batchItemId, type BatchAdapter, type BatchItem } from "../e2c/adapters/types.ts";
import { estimateJobCost } from "../e2c/cost.ts";
import type { RawProblem } from "../e2c/preprocess.ts";
import { preprocess } from "../e2c/preprocess.ts";
import { LOCKED_STATUSES, type ModelName, type Stage } from "../e2c/types.ts";
import { conceptStage, makeCaller, makePlanCaller, processProblem, recordCall, unitStage, type CallEvent, type CallSpec, type PipelineDeps, type RunCtx } from "./e2cPipeline.ts";

// e2c 작업 러너: realtime(문제 단위, chunk 마다 cursor 저장) / batch(W1~W4 웨이브). DB·모델·원본 조회는 모두 주입한다.
export type JobKind = "pilot" | "run_all" | "run_ids" | "rerun_review";
export type JobMode = "realtime" | "batch";
export type JobStatus = "running" | "paused" | "done" | "failed" | "cancelled";
export type JobScope = { ids: number[] } | { all: true } | { pilot: true };

export type JobRow = {
  id: string;
  kind: JobKind;
  mode: JobMode;
  dryRun: boolean;
  shadowGrok: boolean;
  status: JobStatus;
  ids: number[]; // 처리 순서
  total: number;
  processed: number;
  needsReview: number;
  failed: number;
  grokUnitCalls: number;
  grokConceptCalls: number;
  costUsd: number;
  estimatedCostUsd: number;
  cacheReusedCalls: number;
  reusedByModel: Record<string, number>;
  cachedInputTokens: number;
  inputTokens: number;
  cursorProblemId: number | null;
  batchIds: Record<string, string>; // "W1:claude" → batch id
  xaiBatchIds: string[];
  wave: string | null;
  error: string | null;
};
export type JobVM = Omit<JobRow, "ids" | "batchIds"> & { budgetUsd: number };

export interface JobStore {
  get(id: string): Promise<JobRow | null>;
  patch(id: string, patch: Partial<JobRow>): Promise<void>; // 상태를 덮어쓰지 않도록 필요한 필드만
  create(row: Omit<JobRow, "id">, scope: unknown, actor: string): Promise<JobRow>;
  findBusy(): Promise<JobRow | null>; // running 인 작업
  resolveScope(kind: JobKind, scope: JobScope): Promise<number[]>; // 처리 순서대로
  estimateInputs(ids: number[]): Promise<{ cachedCalls: number; avgChars: number }>;
}
export type JobDeps = {
  pipeline: PipelineDeps;
  jobs: JobStore;
  loadProblems(ids: number[]): Promise<RawProblem[]>;
  budgetUsd: number;
  chunk?: number;
  batchAdapters?: Partial<Record<ModelName, BatchAdapter>>;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
};

export class JobError extends Error {
  status: number;
  jobId?: string;
  constructor(message: string, status = 400, jobId?: string) {
    super(message);
    this.status = status;
    this.jobId = jobId;
  }
}

export const toVM = (j: JobRow, budgetUsd: number): JobVM => {
  const { ids: _i, batchIds: _b, ...rest } = j;
  void _i; void _b;
  return { ...rest, budgetUsd };
};

const defaultMode = (kind: JobKind): JobMode => (kind === "run_all" ? "batch" : "realtime");
const defaultShadow = (kind: JobKind) => kind === "pilot" && process.env.E2C_PILOT_SHADOW_GROK !== "false";

export type StartInput = { kind: JobKind; mode?: JobMode; scope: JobScope; dryRun?: boolean; shadowGrok?: boolean; force?: boolean };

export async function startJob(deps: JobDeps, input: StartInput, actor: string): Promise<{ job: JobRow } | { budgetWarning: true; estimatedCostUsd: number }> {
  const busy = await deps.jobs.findBusy();
  if (busy) throw new JobError("이미 실행 중인 작업이 있습니다.", 409, busy.id);
  const mode = input.mode ?? defaultMode(input.kind);
  const ids = await deps.jobs.resolveScope(input.kind, input.scope);
  if (!ids.length) throw new JobError("대상 문항이 없습니다.");
  const { cachedCalls, avgChars } = await deps.jobs.estimateInputs(ids);
  const estimatedCostUsd = estimateJobCost({ problems: ids.length, cachedCalls, avgChars, mode, pricing: deps.pipeline.config.pricing });
  if (deps.budgetUsd > 0 && estimatedCostUsd > deps.budgetUsd && !input.force) return { budgetWarning: true, estimatedCostUsd };
  const job = await deps.jobs.create(
    {
      kind: input.kind, mode, dryRun: input.dryRun ?? true, shadowGrok: input.shadowGrok ?? defaultShadow(input.kind), status: "running", ids, total: ids.length, processed: 0,
      needsReview: 0, failed: 0, grokUnitCalls: 0, grokConceptCalls: 0, costUsd: 0, estimatedCostUsd, cacheReusedCalls: 0, reusedByModel: {}, cachedInputTokens: 0, inputTokens: 0,
      cursorProblemId: null, batchIds: {}, xaiBatchIds: [], wave: null, error: null,
    },
    input.scope,
    actor
  );
  return { job };
}

// ---------- 실행 ----------
type Counters = Pick<JobRow, "processed" | "needsReview" | "failed" | "grokUnitCalls" | "grokConceptCalls" | "costUsd" | "cacheReusedCalls" | "reusedByModel" | "cachedInputTokens" | "inputTokens">;
const counters = (j: JobRow): Counters => ({
  processed: j.processed, needsReview: j.needsReview, failed: j.failed, grokUnitCalls: j.grokUnitCalls, grokConceptCalls: j.grokConceptCalls, costUsd: j.costUsd,
  cacheReusedCalls: j.cacheReusedCalls, reusedByModel: { ...j.reusedByModel }, cachedInputTokens: j.cachedInputTokens, inputTokens: j.inputTokens,
});

function countEvent(c: Counters, e: CallEvent, countReuse = true) {
  if (e.reused) {
    if (countReuse) {
      c.cacheReusedCalls++;
      c.reusedByModel[e.model] = (c.reusedByModel[e.model] ?? 0) + 1;
    }
    return;
  }
  c.costUsd += e.costUsd;
  c.inputTokens += e.result.usage.inputTokens;
  c.cachedInputTokens += e.result.usage.cachedInputTokens;
  if (e.model === "grok") {
    if (e.stage === "grok_unit") c.grokUnitCalls++;
    else if (e.stage === "grok_concept") c.grokConceptCalls++;
  }
}

const flush = (deps: JobDeps, id: string, c: Counters, extra: Partial<JobRow> = {}) => deps.jobs.patch(id, { ...c, ...extra });

async function stillRunning(deps: JobDeps, id: string): Promise<boolean> {
  return (await deps.jobs.get(id))?.status === "running";
}

async function overBudget(deps: JobDeps, id: string, c: Counters): Promise<boolean> {
  if (deps.budgetUsd > 0 && c.costUsd >= deps.budgetUsd) {
    await flush(deps, id, c, { status: "paused", error: "budget_exceeded" });
    return true;
  }
  return false;
}

export async function runJob(deps: JobDeps, id: string): Promise<void> {
  const job = await deps.jobs.get(id);
  if (!job || job.status !== "running") return;
  const c = counters(job);
  try {
    if (job.mode === "batch") await runBatchWaves(deps, job, c);
    else await runRealtime(deps, job, c);
  } catch (e) {
    await flush(deps, id, c, { status: "failed", error: e instanceof Error ? e.message : String(e) });
  }
}

async function runChunk(deps: JobDeps, job: JobRow, ids: number[], c: Counters, countReuse: boolean) {
  const ctx: RunCtx = { jobRunId: job.id, shadowGrok: job.shadowGrok, onCall: (e) => countEvent(c, e, countReuse) };
  const caller = makeCaller(deps.pipeline, ctx);
  const raws = await deps.loadProblems(ids);
  const rows = await Promise.all(raws.map((r) => processProblem(preprocess(r), deps.pipeline, ctx, caller)));
  for (const r of rows) {
    c.processed++;
    if (r.status === "needs_review") c.needsReview++;
    else if (r.status === "error") c.failed++;
  }
  c.processed += ids.length - raws.length; // 원본에서 사라진 문항도 진행으로 센다
}

async function runRealtime(deps: JobDeps, job: JobRow, c: Counters) {
  const start = job.cursorProblemId == null ? 0 : job.ids.indexOf(job.cursorProblemId) + 1;
  const chunk = deps.chunk ?? 4;
  for (let i = start; i < job.ids.length; i += chunk) {
    if (!(await stillRunning(deps, job.id))) return; // paused / cancelled
    const ids = job.ids.slice(i, i + chunk);
    await runChunk(deps, job, ids, c, true);
    await flush(deps, job.id, c, { cursorProblemId: ids[ids.length - 1] });
    if (await overBudget(deps, job.id, c)) return;
  }
  if (await stillRunning(deps, job.id)) await flush(deps, job.id, c, { status: "done", wave: null });
}

const WAVES = [
  { name: "W1", stage: "unit" as Stage, label: "단원 추출" },
  { name: "W2", stage: "grok_unit" as Stage, label: "Grok 단원" },
  { name: "W3", stage: "concept" as Stage, label: "개념 연동" },
  { name: "W4", stage: "grok_concept" as Stage, label: "Grok 개념" },
];

// W1 단원 추출 → W2 다수결 없는 문제만 Grok 단원 → W3 개념 연동 → W4 다수결 없는 문제만 Grok 개념. 웨이브 결과는 model_call 에 저장되고,
// 마지막에 결과 캐시만으로 problem_result 를 조립한다. 서버가 재시작돼도 batch_ids 로 제출한 batch 를 다시 받아 온다.
async function runBatchWaves(deps: JobDeps, job: JobRow, c: Counters) {
  const ctx: RunCtx = { jobRunId: job.id, shadowGrok: job.shadowGrok, onCall: (e) => countEvent(c, e) };
  const realtime = makeCaller(deps.pipeline, ctx);
  const batchIds = { ...job.batchIds };
  const startWave = Math.max(0, WAVES.findIndex((w) => w.name === job.wave));
  for (let w = startWave; w < WAVES.length; w++) {
    const wave = WAVES[w];
    if (!(await stillRunning(deps, job.id))) return;
    await flush(deps, job.id, c, { wave: wave.name });
    const pending: CallSpec[] = [];
    const plan = makePlanCaller(deps.pipeline, pending);
    const size = 50;
    for (let i = 0; i < job.ids.length; i += size) {
      const raws = await deps.loadProblems(job.ids.slice(i, i + size));
      await Promise.all(
        raws.map(async (r) => {
          const p = preprocess(r);
          const prev = await deps.pipeline.store.getResult(p.id);
          if (p.skipped || (prev && LOCKED_STATUSES.includes(prev.status))) return;
          const u = await unitStage(p, deps.pipeline, ctx, plan, wave.stage === "unit" ? "propose" : "all");
          if ((wave.stage === "concept" || wave.stage === "grok_concept") && u.finalUnitId) await conceptStage(p, u.finalUnitId, deps.pipeline, ctx, plan, wave.stage === "concept" ? "propose" : "all");
        })
      );
    }
    const specs = pending.filter((s) => s.stage === wave.stage && (wave.stage === "unit" || wave.stage === "concept" ? s.role === "proposer" : true));
    const byModel = new Map<ModelName, CallSpec[]>();
    for (const s of specs) (byModel.get(s.adapter.name) ?? byModel.set(s.adapter.name, []).get(s.adapter.name)!).push(s);
    for (const [name, list] of byModel) {
      const adapter = deps.batchAdapters?.[name];
      let retry = list;
      if (adapter) {
        const items: BatchItem[] = list.map((s) => ({ id: batchItemId(s.problem.id, s.stage, s.adapter.model, s.req.promptVersion), req: s.req }));
        const byId = new Map(items.map((it, i) => [it.id, list[i]]));
        const key = `${wave.name}:${name}`;
        const run = await runBatch(adapter, items, {
          batchId: batchIds[key], sleep: deps.sleep, pollMs: deps.pollMs,
          onSubmitted: async (bid) => {
            batchIds[key] = bid;
            await flush(deps, job.id, c, { batchIds: { ...batchIds }, ...(name === "grok" ? { xaiBatchIds: Object.entries(batchIds).filter(([k]) => k.endsWith(":grok")).map(([, v]) => v) } : {}) });
          },
        });
        for (const [iid, result] of run.results) {
          const s = byId.get(iid)!;
          countEvent(c, { problemId: s.problem.id, stage: s.stage, role: s.role, model: name, result, reused: false, costUsd: await recordCall(deps.pipeline, { ...ctx, onCall: undefined }, s, result, { batchId: run.batchId }) });
        }
        retry = run.retry.map((it) => byId.get(it.id)!); // 실패·만료 건만 다음 웨이브 전에 realtime 으로
      }
      for (let i = 0; i < retry.length; i += deps.chunk ?? 4) await Promise.all(retry.slice(i, i + (deps.chunk ?? 4)).map((s) => realtime(s)));
    }
    await flush(deps, job.id, c);
    if (await overBudget(deps, job.id, c)) return;
  }
  // 조립: 모든 호출이 캐시에 있으므로 새 호출 없이 problem_result 만 만든다
  const start = job.cursorProblemId == null ? 0 : job.ids.indexOf(job.cursorProblemId) + 1;
  c.processed = start;
  const chunk = deps.chunk ?? 4;
  for (let i = start; i < job.ids.length; i += chunk) {
    if (!(await stillRunning(deps, job.id))) return;
    const ids = job.ids.slice(i, i + chunk);
    await runChunk(deps, job, ids, c, false);
    await flush(deps, job.id, c, { cursorProblemId: ids[ids.length - 1] });
  }
  if (await stillRunning(deps, job.id)) await flush(deps, job.id, c, { status: "done", wave: null });
}

// ---------- 제어 ----------
const g = globalThis as unknown as { __e2cRunners?: Set<string> };
export const runners = (g.__e2cRunners ??= new Set<string>());

export function launch(deps: JobDeps, id: string): Promise<void> {
  if (runners.has(id)) return Promise.resolve();
  runners.add(id);
  return runJob(deps, id).finally(() => runners.delete(id));
}

export async function controlJob(deps: JobDeps, id: string, action: "pause" | "resume" | "cancel"): Promise<JobRow> {
  const job = await deps.jobs.get(id);
  if (!job) throw new JobError("없는 작업입니다.", 404);
  if (action === "pause") {
    if (job.status !== "running") throw new JobError(`실행 중이 아닙니다 (${job.status}).`, 409);
    await deps.jobs.patch(id, { status: "paused" });
  } else if (action === "cancel") {
    if (job.status !== "running" && job.status !== "paused") throw new JobError(`이미 끝난 작업입니다 (${job.status}).`, 409);
    await deps.jobs.patch(id, { status: "cancelled" });
  } else {
    if (job.status !== "paused") throw new JobError(`일시정지 상태가 아닙니다 (${job.status}).`, 409);
    const busy = await deps.jobs.findBusy();
    if (busy && busy.id !== id) throw new JobError("다른 작업이 실행 중입니다.", 409, busy.id);
    await deps.jobs.patch(id, { status: "running", error: null });
    void launch(deps, id);
  }
  return (await deps.jobs.get(id))!;
}
