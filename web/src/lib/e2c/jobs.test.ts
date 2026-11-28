import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDeps, MemJobStore, rawProblem, scripted, type Script } from "./testkit.ts";
import { controlJob, runJob, startJob, type JobDeps } from "../server/e2cJobs.ts";
import { createClaudeBatchAdapter, type ClaudeBatchClient } from "./adapters/batch/claude.ts";
import type { ModelName } from "./types.ts";

const U1 = "L4-HALG-01";
const ok: Script = (req) => (req.stage === "unit" ? { unit: [U1] } : { primary: `${U1}#1` });
const adapters = () => ({ jev: scripted("jev", ok), claude: scripted("claude", ok), gemini: scripted("gemini", ok), grok: scripted("grok", ok) });
const mkJobDeps = (jobs: MemJobStore, a = adapters(), over: Partial<JobDeps> = {}): JobDeps & { loaded: number[][]; pipeline: ReturnType<typeof makeDeps> } => {
  const loaded: number[][] = [];
  const pipeline = makeDeps(a);
  return {
    pipeline, jobs, budgetUsd: 100, chunk: 2, loaded,
    loadProblems: async (ids) => { loaded.push(ids); return ids.map((i) => rawProblem(i)); },
    ...over,
  } as JobDeps & { loaded: number[][]; pipeline: ReturnType<typeof makeDeps> };
};
const ids = [11, 12, 13, 14, 15, 16];

test("일시정지 후 재개하면 cursor_problem_id 다음 문제부터 처리한다", async () => {
  const jobs = new MemJobStore(ids);
  const deps = mkJobDeps(jobs);
  const started = await startJob(deps, { kind: "run_ids", scope: { ids } }, "t");
  assert.ok("job" in started);
  const id = started.job.id;
  const orig = deps.loadProblems;
  let n = 0;
  deps.loadProblems = async (x) => {
    if (++n === 2) await jobs.patch(id, { status: "paused" }); // 두 번째 chunk 를 읽는 동안 일시정지
    return orig(x);
  };
  await runJob(deps, id);
  const paused = (await jobs.get(id))!;
  assert.equal(paused.status, "paused");
  assert.equal(paused.cursorProblemId, 14);
  assert.equal(paused.processed, 4);
  deps.loaded.length = 0;
  deps.loadProblems = orig;
  await jobs.patch(id, { status: "running" });
  await runJob(deps, id);
  assert.deepEqual(deps.loaded, [[15, 16]]);
  const done = (await jobs.get(id))!;
  assert.equal(done.status, "done");
  assert.equal(done.processed, 6);
  assert.equal(deps.pipeline.store.results.size, 6);
});

test("누적 비용이 E2C_BUDGET_USD 를 넘으면 paused", async () => {
  const jobs = new MemJobStore(ids);
  const deps = mkJobDeps(jobs, adapters(), { budgetUsd: 0.005 });
  const { job } = (await startJob({ ...deps, budgetUsd: 100 }, { kind: "run_ids", scope: { ids } }, "t")) as { job: { id: string } };
  await runJob(deps, job.id);
  const j = (await jobs.get(job.id))!;
  assert.equal(j.status, "paused");
  assert.equal(j.error, "budget_exceeded");
  assert.ok(j.costUsd >= 0.005);
  assert.ok(j.processed < 6);
});

test("예상 비용이 상한을 넘으면 force 없이는 job 을 만들지 않고 budgetWarning", async () => {
  const jobs = new MemJobStore(Array.from({ length: 7000 }, (_, i) => i + 1));
  const deps = mkJobDeps(jobs, adapters(), { budgetUsd: 1 });
  const r = await startJob(deps, { kind: "run_all", scope: { all: true } }, "t");
  assert.ok("budgetWarning" in r && r.estimatedCostUsd > 1);
  assert.equal(jobs.jobs.size, 0);
  const forced = await startJob(deps, { kind: "run_all", scope: { all: true }, force: true }, "t");
  assert.ok("job" in forced);
  assert.equal(forced.job.mode, "batch"); // run_all 기본은 batch
  await assert.rejects(() => startJob(deps, { kind: "run_ids", scope: { ids: [1] } }, "t"), (e: { status: number }) => e.status === 409);
});

test("기본값: run_ids/pilot 은 realtime, dry_run=true, 그림자는 pilot 만", async () => {
  const jobs = new MemJobStore(ids);
  const deps = mkJobDeps(jobs);
  const r = (await startJob(deps, { kind: "pilot", scope: { pilot: true } }, "t")) as { job: { mode: string; dryRun: boolean; shadowGrok: boolean; status: string } };
  assert.deepEqual([r.job.mode, r.job.dryRun, r.job.shadowGrok], ["realtime", true, true]);
  await controlJob(deps, "job1", "cancel");
  const r2 = (await startJob(deps, { kind: "run_ids", scope: { ids } }, "t")) as { job: { shadowGrok: boolean } };
  assert.equal(r2.job.shadowGrok, false);
});

test("batch 모드: W1~W4 웨이브, Claude 는 batch API, 실패 건만 realtime, 같은 문항 재실행은 호출 0회", async () => {
  const a = adapters();
  const jobs = new MemJobStore(ids);
  const submitted: string[] = [];
  const answers = new Map<string, unknown>();
  const client: ClaudeBatchClient = { beta: { messages: { batches: {
    async create(p) {
      submitted.push(...p.requests.map((r) => r.custom_id));
      for (const r of p.requests) {
        const props = ((r.params.output_config as any).format.schema.properties) as Record<string, any>;
        const first = (props.used_units?.items ?? props.primary).enum[0];
        answers.set(r.custom_id, props.used_units ? { used_units: [first], confidence: 0.8, evidence_steps: [], reason: "" } : { primary: first, secondary: [], confidence: 0.8, evidence_steps: [], reason: "" });
      }
      return { id: `b${submitted.length}` };
    },
    async retrieve() { return { processing_status: "ended" }; },
    async results() {
      const failId = [...answers.keys()][0];
      return (async function* () {
        for (const [k, v] of answers) {
          if (k === failId) yield { custom_id: k, result: { type: "errored" } };
          else yield { custom_id: k, result: { type: "succeeded", message: { content: [{ type: "text", text: JSON.stringify(v) }], usage: { input_tokens: 10, output_tokens: 5 } } } };
        }
      })();
    },
  } } } };
  const deps = mkJobDeps(jobs, a, { batchAdapters: { claude: createClaudeBatchAdapter(client, "claude-test") }, sleep: async () => {} });
  const { job } = (await startJob(deps, { kind: "run_all", scope: { ids } }, "t")) as { job: { id: string } };
  await runJob(deps, job.id);
  const j = (await jobs.get(job.id))!;
  assert.equal(j.status, "done");
  assert.equal(j.processed, 6);
  assert.ok(submitted.length >= 12); // W1(6) + W3(6)
  assert.ok(Object.keys(j.batchIds).some((k) => k.startsWith("W1:claude")));
  assert.ok(deps.pipeline.store.calls.some((c) => c.adapter === "claude" && c.batchDiscount && c.batchId));
  assert.ok(a.claude.calls.length >= 1); // 실패 건만 realtime 재시도
  assert.ok(a.claude.calls.length < 6);
  assert.equal(deps.pipeline.store.results.size, 6);
  // 같은 문항 집합을 다시: 모델 호출 0회
  const before = [a.jev, a.claude, a.gemini, a.grok].map((x) => x.calls.length);
  const submittedBefore = submitted.length;
  deps.pipeline.store.results.clear();
  const again = (await startJob(deps, { kind: "run_all", scope: { ids } }, "t")) as { job: { id: string } };
  await runJob(deps, again.job.id);
  assert.deepEqual([a.jev, a.claude, a.gemini, a.grok].map((x) => x.calls.length), before);
  assert.equal(submitted.length, submittedBefore);
  assert.equal((await jobs.get(again.job.id))!.processed, 6);
});
