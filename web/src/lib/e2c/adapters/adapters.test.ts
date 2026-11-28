import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createJevAdapter } from "./jev.ts";
import { createClaudeAdapter, type ClaudeClient, type ClaudeMessage } from "./claude.ts";
import { createGeminiAdapter } from "./gemini.ts";
import { createGrokAdapter } from "./grok.ts";
import type { ModelRequest } from "./types.ts";
import { buildPrompt } from "../promptBuild.ts";
import { preprocess } from "../preprocess.ts";

const problem = (id = 1, note = "`f(2)=4` 이다. 따라서 답은 4 이다.") =>
  preprocess({ id, statement: "함수 `f(x)=x^2` 의 `f(2)` 값을 구하시오.", note, year: 2022, month: 6, subscriber: "평가원", subject: "COMMON", number: 1, points: 2 });
const opts = [{ id: "U1", text: "A > 하나" }, { id: "U2", text: "A > 둘" }, { id: "U3", text: "A > 셋" }];
const req = (stage: ModelRequest["stage"] = "unit", p = problem(), options = opts): ModelRequest => ({
  ...buildPrompt(stage, p, options), stage, role: "proposer", promptVersion: "v", maxSecondary: 3,
});
const noSleep = async () => {};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.JEV_API_KEY;
  delete process.env.JEV_KEY;
});
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
function stubFetch(responses: (() => Response)[]) {
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : null });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return r();
  }) as typeof fetch;
  return calls;
}

test("JEV: 키 미설정 → not_configured", async () => {
  const r = await createJevAdapter().call(req());
  assert.equal(r.ok, false);
  assert.equal(r.error, "not_configured");
});
test("JEV: 확률 임계값으로 관련 단원, 없으면 최고 1개 / 개념 보조는 0.15 이상 다음 순위", async () => {
  const calls = stubFetch([() => json({ answers: { q: { choice: "U1", confidence: 0.6, probabilities: { U1: 0.6, U2: 0.25, U3: 0.05 } } } })]);
  const a = createJevAdapter({ apiKey: "k", sleep: noSleep });
  const u = await a.call(req("unit"));
  assert.deepEqual(u.answer, { kind: "unit", unitIds: ["U1", "U2"], probs: { U1: 0.6, U2: 0.25, U3: 0.05 }, confidence: 0.6, evidenceSteps: [] });
  assert.equal(calls[0].body.questions.q.type, "choice");
  assert.deepEqual(Object.keys(calls[0].body.questions.q.criteria), ["U1", "U2", "U3"]);
  const c = await a.call(req("concept"));
  assert.equal(c.answer?.kind === "concept" && c.answer.primary, "U1");
  assert.deepEqual(c.answer?.kind === "concept" && c.answer.secondary, ["U2"]);
  stubFetch([() => json({ answers: { q: { choice: "U3", probabilities: { U3: 0.05, U1: 0.04 } } } })]);
  const low = await a.call(req("unit"));
  assert.deepEqual(low.answer?.kind === "unit" && low.answer.unitIds, ["U3"]);
});
test("JEV: 범위 밖 선택 → out_of_candidates, 429 후 성공(Retry-After 존중)", async () => {
  stubFetch([() => json({ answers: { q: { choice: "ZZ", probabilities: { ZZ: 1 } } } })]);
  assert.equal((await createJevAdapter({ apiKey: "k" }).call(req())).error, "out_of_candidates");
  const waits: number[] = [];
  const calls = stubFetch([
    () => new Response("slow", { status: 429, headers: { "retry-after": "7" } }),
    () => json({ answers: { q: { choice: "U2", probabilities: { U2: 0.9 } } } }),
  ]);
  const r = await createJevAdapter({ apiKey: "k", sleep: async (ms) => void waits.push(ms) }).call(req());
  assert.equal(r.ok, true);
  assert.deepEqual(waits, [7000]);
  assert.equal(calls.length, 2);
});

const gem = (text: string, usage = {}) => json({ candidates: [{ content: { parts: [{ text }] } }], modelVersion: "gv", usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, cachedContentTokenCount: 60, ...usage } });
test("Gemini: 정상 + 캐시 토큰 정규화 + 접두 순서", async () => {
  const calls = stubFetch([() => gem(JSON.stringify({ used_units: ["U2"], confidence: 0.8, evidence_steps: ["S1", "x"], reason: "r" }))]);
  const r = await createGeminiAdapter({ apiKey: "k", model: "gm", sleep: noSleep }).call(req());
  assert.equal(r.ok, true);
  assert.deepEqual(r.answer, { kind: "unit", unitIds: ["U2"], confidence: 0.8, evidenceSteps: ["S1"], reason: "r" });
  assert.equal(r.usage.cachedInputTokens, 60);
  assert.equal(r.usage.inputTokens, 100);
  const b = calls[0].body;
  assert.equal(b.generationConfig.temperature, 0);
  assert.equal(b.generationConfig.responseMimeType, "application/json");
  assert.equal(b.contents[0].parts[0].text.startsWith("[후보 단원]"), true);
  assert.ok(b.contents[0].parts[1].text.includes("[문제]"));
});
test("Gemini: 429 후 성공, 스키마 위반 시 1회만 다시 요청, 범위 밖 id", async () => {
  const waits: number[] = [];
  stubFetch([() => new Response("", { status: 429 }), () => new Response("", { status: 429, headers: { "retry-after": "3" } }), () => gem(JSON.stringify({ used_units: ["U1"], confidence: 1, evidence_steps: [], reason: "" }))]);
  const ok = await createGeminiAdapter({ apiKey: "k", sleep: async (ms) => void waits.push(ms) }).call(req());
  assert.equal(ok.ok, true);
  assert.deepEqual(waits, [1000, 3000]);
  const calls = stubFetch([() => gem("not json"), () => gem(JSON.stringify({ used_units: ["U3"], confidence: 1, evidence_steps: [], reason: "" }))]);
  const rep = await createGeminiAdapter({ apiKey: "k", sleep: noSleep }).call(req());
  assert.equal(rep.ok, true);
  assert.equal(calls.length, 2);
  const c2 = stubFetch([() => gem(JSON.stringify({ used_units: ["NOPE"], confidence: 1, evidence_steps: [], reason: "" }))]);
  const bad = await createGeminiAdapter({ apiKey: "k", sleep: noSleep }).call(req());
  assert.equal(bad.error, "out_of_candidates");
  assert.equal(c2.length, 2); // 1회 다시 요청 후 포기
  assert.equal((await createGeminiAdapter({ sleep: noSleep }).call(req())).error, process.env.GEMINI_API_KEY ? bad.error : "not_configured");
});

const grokBody = (content: unknown, usage = {}) =>
  json({ model: "grok-x", choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 200, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 128 }, cost_in_usd_ticks: 123456789, ...usage } });
test("xAI: 정상, cost_in_usd_ticks × 1e-10, 캐시 토큰, 중복 id 는 1회 다시 요청", async () => {
  const calls = stubFetch([
    () => grokBody({ primary: "U1", secondary: ["U1"], confidence: 0.5, evidence_steps: [], reason: "" }),
    () => grokBody({ primary: "U1", secondary: ["U2"], confidence: 0.7, evidence_steps: ["S2"], reason: "" }),
  ]);
  const r = await createGrokAdapter({ apiKey: "k", model: "grok-4.7", sleep: noSleep }).call(req("grok_concept"));
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
  assert.ok(Math.abs((r.usage.costUsd ?? 0) - 2 * 123456789 * 1e-10) < 1e-12); // 두 호출 합산
  assert.equal(r.usage.cachedInputTokens, 256);
  assert.equal(calls[0].body.response_format.type, "json_schema");
  assert.equal(calls[0].body.reasoning_effort, "low");
  assert.equal(calls[0].url, "https://api.x.ai/v1/chat/completions");
  assert.deepEqual(r.answer?.kind === "concept" && r.answer.secondary, ["U2"]);
});
test("xAI: 키 미설정 not_configured, 5xx 후 성공", async () => {
  delete process.env.XAI_API_KEY;
  assert.equal((await createGrokAdapter({ sleep: noSleep }).call(req("grok_unit"))).error, "not_configured");
  stubFetch([() => new Response("", { status: 503 }), () => grokBody({ used_units: ["U1"], confidence: 0.4, evidence_steps: [], reason: "" })]);
  assert.equal((await createGrokAdapter({ apiKey: "k", sleep: noSleep }).call(req("grok_unit"))).ok, true);
});

function fakeClaude(msgs: ClaudeMessage[]) {
  const calls: Record<string, unknown>[] = [];
  const client: ClaudeClient = { beta: { messages: { async create(p) { calls.push(p); return msgs[Math.min(calls.length - 1, msgs.length - 1)]; } } } };
  return { client, calls };
}
const cm = (content: unknown, extra: Partial<ClaudeMessage> = {}): ClaudeMessage => ({
  content: [{ type: "text", text: JSON.stringify(content) }], model: "cv", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 80, cache_creation_input_tokens: 20 }, ...extra,
});
test("Claude: SDK 주입 정상, cache_control 1개(options 끝), temperature 없음, 캐시 토큰", async () => {
  const f = fakeClaude([cm({ primary: "U2", secondary: ["U3"], confidence: 0.9, evidence_steps: ["S1"], reason: "" })]);
  const r = await createClaudeAdapter({ client: f.client, model: "cm" }).call(req("concept"));
  assert.equal(r.ok, true);
  assert.deepEqual(r.usage, { inputTokens: 110, outputTokens: 5, cachedInputTokens: 80, cacheWriteTokens: 20, costUsd: null });
  const p = f.calls[0] as any;
  assert.equal("temperature" in p, false);
  assert.equal(p.output_config.effort, "low");
  assert.equal(p.max_tokens, 2000);
  const marks = JSON.stringify(p).match(/cache_control/g) ?? [];
  assert.equal(marks.length, 1);
  assert.deepEqual(p.messages[0].content[0].cache_control, { type: "ephemeral" });
  assert.ok(p.messages[0].content[1].text.includes("[문제]"));
  assert.ok(!p.messages[0].content[0].text.includes("[문제]"));
  assert.deepEqual(p.output_config.format.schema.properties.primary.enum, ["U1", "U2", "U3"]);
});
test("Claude: refusal 은 실패, 스키마 위반은 1회 다시 요청, 429 는 SDK 가 처리", async () => {
  const f1 = fakeClaude([cm({}, { stop_reason: "refusal", stop_details: { category: "x" } })]);
  assert.equal((await createClaudeAdapter({ client: f1.client }).call(req())).error, "refusal:x");
  const f2 = fakeClaude([cm({ used_units: [] }), cm({ used_units: ["U1"], confidence: 0.5, evidence_steps: [], reason: "" })]);
  const r = await createClaudeAdapter({ client: f2.client }).call(req());
  assert.equal(r.ok, true);
  assert.equal(f2.calls.length, 2);
  const f3 = fakeClaude([cm({ used_units: ["ZZ"], confidence: 1, evidence_steps: [], reason: "" })]);
  assert.equal((await createClaudeAdapter({ client: f3.client }).call(req())).error, "out_of_candidates");
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal((await createClaudeAdapter().call(req())).error, "not_configured");
});

test("promptBuild: 같은 후보 집합이면 system·options 블록이 바이트까지 같고, 후보 순서와 무관, 문제는 뒤", () => {
  const a = buildPrompt("unit", problem(1), opts);
  const b = buildPrompt("unit", problem(2, "전혀 다른 해답이다. 아주 길게 쓴다."), [opts[2], opts[0], opts[1]]);
  assert.equal(a.system, b.system);
  assert.equal(a.optionsBlock, b.optionsBlock);
  assert.ok(!a.optionsBlock.includes("함수"));
  assert.notEqual(a.problemBlock, b.problemBlock);
  assert.ok(a.problemBlock.includes("S1:"));
});
