import { test } from "node:test";
import assert from "node:assert/strict";
import { createClaudeBatchAdapter, customId, type ClaudeBatchClient } from "./claude.ts";
import { createGeminiBatchAdapter } from "./gemini.ts";
import { createGrokBatchAdapter } from "./grok.ts";
import { runBatch } from "./common.ts";
import { buildPrompt } from "../../promptBuild.ts";
import { preprocess } from "../../preprocess.ts";
import { batchItemId, type BatchItem } from "../types.ts";

const opts = [{ id: "U1", text: "하나" }, { id: "U2", text: "둘" }];
const mk = (pid: number): BatchItem => {
  const p = preprocess({ id: pid, statement: "함수 `f(x)=x^2` 의 `f(2)` 값을 구하시오.", note: "`f(2)=4` 이다. 따라서 답은 4 이다.", year: 2022, month: 6, subscriber: "평가원", subject: "COMMON", number: 1, points: 2 });
  return { id: batchItemId(pid, "unit", "m", "e2c-unit-v2"), req: { ...buildPrompt("unit", p, opts), stage: "unit", role: "proposer", promptVersion: "e2c-unit-v2", maxSecondary: 3 } };
};
const ans = (id: string) => JSON.stringify({ used_units: [id], confidence: 0.7, evidence_steps: [], reason: "" });
const noSleep = async () => {};

test("Claude Batch: id 제출, 성공은 결과로, 실패·만료는 retry 목록으로", async () => {
  const items = [mk(1), mk(2), mk(3)];
  let submitted: { custom_id: string }[] = [];
  const client: ClaudeBatchClient = { beta: { messages: { batches: {
    async create(p) { submitted = p.requests; return { id: "b1" }; },
    async retrieve() { return { processing_status: "ended" }; },
    async results() {
      return (async function* () {
        yield { custom_id: customId(items[0].id), result: { type: "succeeded", message: { content: [{ type: "text", text: ans("U1") }], usage: { input_tokens: 5, output_tokens: 2 } } } };
        yield { custom_id: customId(items[1].id), result: { type: "expired" } };
      })();
    },
  } } } };
  const run = await runBatch(createClaudeBatchAdapter(client, "m"), items, { sleep: noSleep });
  assert.deepEqual(submitted.map((s) => s.custom_id), items.map((i) => customId(i.id)));
  assert.ok(submitted[0].custom_id.startsWith("1_unit_m_e2c-unit-v2"));
  assert.equal(run.batchId, "b1");
  assert.deepEqual([...run.results.keys()], [items[0].id]);
  assert.deepEqual(run.retry.map((i) => i.id), [items[1].id, items[2].id]);
});

test("Gemini Batch: metadata.key 로 id 제출, 결과 매핑, 실패만 retry", async () => {
  const items = [mk(1), mk(2)];
  const real = globalThis.fetch;
  const bodies: any[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    if (init.method === "POST") {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ name: "batches/g1" }));
    }
    return new Response(JSON.stringify({ done: true, response: { inlinedResponses: { inlinedResponses: [
      { metadata: { key: items[0].id }, response: { candidates: [{ content: { parts: [{ text: ans("U2") }] } }] } },
      { metadata: { key: items[1].id }, error: { code: 500 } },
    ] } } }));
  }) as typeof fetch;
  try {
    const run = await runBatch(createGeminiBatchAdapter({ apiKey: "k", model: "gm" }), items, { sleep: noSleep });
    assert.deepEqual(bodies[0].batch.input_config.requests.requests.map((r: any) => r.metadata.key), items.map((i) => i.id));
    assert.deepEqual([...run.results.keys()], [items[0].id]);
    assert.deepEqual(run.retry.map((i) => i.id), [items[1].id]);
  } finally {
    globalThis.fetch = real;
  }
});

test("xAI Batch: batch_request_id 제출, 결과(cost ticks) 매핑, 실패만 retry", async () => {
  const items = [mk(1), mk(2)];
  const sent: any[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const u = String(url);
    if (init.method === "POST" && u.endsWith("/batches")) return new Response(JSON.stringify({ batch_id: "x1" }));
    if (init.method === "POST") { sent.push(JSON.parse(String(init.body))); return new Response("{}"); }
    if (u.includes("/results")) return new Response(JSON.stringify({ results: [
      { batch_request_id: items[0].id, response: { chat_get_completion: { choices: [{ message: { content: ans("U1") } }], usage: { prompt_tokens: 10, completion_tokens: 3, cost_in_usd_ticks: 5e9 } } } },
      { batch_request_id: items[1].id, error_message: "boom" },
    ], pagination_token: null }));
    return new Response(JSON.stringify({ state: { num_pending: 0 } }));
  }) as typeof fetch;
  const run = await runBatch(createGrokBatchAdapter({ apiKey: "k", model: "gk", fetchFn }), items, { sleep: noSleep });
  assert.deepEqual(sent[0].batch_requests.map((r: any) => r.batch_request_id), items.map((i) => i.id));
  assert.equal(items[0].id, "1:unit:m:e2c-unit-v2");
  assert.ok(Math.abs(run.results.get(items[0].id)!.usage.costUsd! - 0.5) < 1e-9);
  assert.deepEqual(run.retry.map((i) => i.id), [items[1].id]);
});

test("runBatch: 이미 제출된 batchId 로 재개하면 제출하지 않는다", async () => {
  let submits = 0;
  const adapter = { name: "grok" as const, model: "m", async submit() { submits++; return "z"; }, async collect() { return { done: true, outcomes: [] }; } };
  const run = await runBatch(adapter, [mk(1)], { batchId: "old", sleep: noSleep });
  assert.equal(submits, 0);
  assert.equal(run.batchId, "old");
  assert.equal(run.retry.length, 1);
});
