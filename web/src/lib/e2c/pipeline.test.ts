import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDeps, MemStore, problemOf, scripted, conceptsOf, type Script } from "./testkit.ts";
import { makeCaller, processProblem, type CallEvent } from "../server/e2cPipeline.ts";
import type { ModelName } from "./types.ts";

const U1 = "L4-HALG-01", U2 = "L4-HALG-02", U3 = "L4-HCAL1-01";
const unitScript = (u: string): Script => (req) => (req.stage === "unit" ? { unit: [u] } : { primary: `${u}#1`, secondary: [`${u}#2`] });
const mk = (s: Partial<Record<ModelName, Script>>) => ({
  jev: scripted("jev", s.jev ?? unitScript(U1)),
  claude: scripted("claude", s.claude ?? unitScript(U1)),
  gemini: scripted("gemini", s.gemini ?? unitScript(U1)),
  grok: scripted("grok", s.grok ?? ((req) => ({ unit: [U2], primary: req.options[0].id, secondary: [] }))),
});
const ctx = { jobRunId: null, shadowGrok: false };
const grokCalls = (a: ReturnType<typeof mk>) => a.grok.calls.length;

test("단원 표가 2표 이상 일치하고 그림자가 꺼져 있으면 Grok 호출 0회", async () => {
  const a = mk({ gemini: unitScript(U2) });
  const deps = makeDeps(a);
  const row = await processProblem(problemOf(1), deps, ctx);
  assert.equal(grokCalls(a), 0);
  assert.equal(row.finalUnitId, U1);
  assert.equal(row.unitSource, "majority");
  assert.ok(row.reasons.includes("majority_2of3"));
  assert.equal(row.status, "auto");
});

test("세 표가 모두 다르면 Grok 단원 호출 1회, grok 결정, unit_grok 사유", async () => {
  const a = mk({ jev: unitScript(U1), claude: unitScript(U2), gemini: unitScript(U3), grok: (req) => (req.stage === "grok_unit" ? { unit: [U2] } : { primary: req.options[0].id }) });
  const row = await processProblem(problemOf(2), makeDeps(a), ctx);
  const unitGrok = a.grok.calls.filter((c) => c.stage === "grok_unit");
  assert.equal(unitGrok.length, 1);
  assert.deepEqual(unitGrok[0].options.map((o) => o.id), [U1, U2, U3].sort()); // 성공 모델 관련 단원의 합집합
  assert.equal(row.unitSource, "grok");
  assert.equal(row.finalUnitId, U2);
  assert.ok(row.reasons.includes("unit_grok"));
  assert.equal(row.status, "needs_review");
});

test("JEV 미설정 + 나머지 두 모델 일치 → two_models_only, needs_review", async () => {
  const a = mk({ jev: () => ({ error: "not_configured" }) });
  const row = await processProblem(problemOf(3), makeDeps(a), ctx);
  assert.ok(row.reasons.includes("two_models_only"));
  assert.equal(row.status, "needs_review");
  assert.equal(grokCalls(a), 0);
});

test("제안 모델 3개 모두 실패 → error, Grok 호출 0회", async () => {
  const f: Script = () => ({ error: "HTTP 500" });
  const a = mk({ jev: f, claude: f, gemini: f });
  const row = await processProblem(problemOf(4), makeDeps(a), ctx);
  assert.equal(row.status, "error");
  assert.equal(grokCalls(a), 0);
});

test("최종 결과: 단원 1개, 주 개념 1개, 보조 ≤3, 모두 채택 단원 소속", async () => {
  const a = mk({});
  const row = await processProblem(problemOf(5), makeDeps(a), ctx);
  const ids = new Set(conceptsOf(row.finalUnitId!).map((c) => c.conceptId));
  assert.ok(row.primaryConceptId && ids.has(row.primaryConceptId));
  assert.ok(row.secondaryConceptIds.length <= 3 && row.secondaryConceptIds.every((c) => ids.has(c) && c !== row.primaryConceptId));
  assert.equal(row.status, "auto");
});

test("skipped_no_text 문항은 모델 호출 0회", async () => {
  const a = mk({});
  const row = await processProblem(problemOf(6, { statement: "짧다", note: "짧다" }), makeDeps(a), ctx);
  assert.equal(row.status, "skipped_no_text");
  assert.equal([a.jev, a.claude, a.gemini, a.grok].reduce((n, x) => n + x.calls.length, 0), 0);
});

test("그림자 Grok: 다수결 사례에도 shadow_judge 로 저장만 하고 결정은 그대로", async () => {
  const a = mk({});
  const deps = makeDeps(a);
  const row = await processProblem(problemOf(7), deps, { jobRunId: null, shadowGrok: true });
  assert.equal(row.unitSource, "majority");
  assert.ok(deps.store.calls.some((c) => c.role === "shadow_judge" && c.stage === "grok_unit"));
  assert.ok(!row.reasons.includes("unit_grok"));
});

test("개념 단계: 주 개념 불일치 → Grok 개념 결정, concept_grok", async () => {
  const a = mk({
    jev: (r) => (r.stage === "unit" ? { unit: [U1] } : { primary: `${U1}#1` }),
    claude: (r) => (r.stage === "unit" ? { unit: [U1] } : { primary: `${U1}#2`, secondary: [`${U1}#1`] }),
    gemini: (r) => (r.stage === "unit" ? { unit: [U1] } : { primary: `${U1}#3` }),
    grok: (r) => ({ primary: `${U1}#2`, secondary: [`${U1}#1`], unit: [U1] }),
  });
  const row = await processProblem(problemOf(8), makeDeps(a), ctx);
  assert.equal(row.conceptSource, "grok");
  assert.equal(row.primaryConceptId, `${U1}#2`);
  assert.ok(row.reasons.includes("concept_grok"));
  const g = a.grok.calls.find((c) => c.stage === "grok_concept")!;
  assert.deepEqual(g.options.map((o) => o.id), [`${U1}#1`, `${U1}#2`, `${U1}#3`]);
});

test("캐시 재사용: 같은 문항을 두 번 돌리면 두 번째는 모델·임베딩 호출 0회, 프롬프트 버전이 바뀌면 그 단계만 다시", async () => {
  const a = mk({ gemini: unitScript(U2) });
  const deps = makeDeps(a);
  const events: CallEvent[] = [];
  const c = { jobRunId: null, shadowGrok: false, onCall: (e: CallEvent) => events.push(e) };
  await processProblem(problemOf(9), deps, c);
  const total = () => [a.jev, a.claude, a.gemini, a.grok].reduce((n, x) => n + x.calls.length, 0);
  const first = total();
  const embedN = deps.embedCalls.n;
  deps.store.results.clear();
  events.length = 0;
  await processProblem(problemOf(9), deps, c);
  assert.equal(total(), first);
  assert.equal(deps.embedCalls.n, embedN);
  assert.ok(events.length > 0 && events.every((e) => e.reused));
  // 개념 단계 프롬프트 버전만 바꾸면 개념 호출만 다시
  deps.store.results.clear();
  const caller = makeCaller(deps, c);
  const bumped: typeof caller = (s) => caller(s.stage === "concept" ? { ...s, req: { ...s.req, promptVersion: "e2c-concept-v3" } } : s);
  await processProblem(problemOf(9), deps, c, bumped);
  assert.equal(total(), first + 3);
});

test("재실행: overridden/confirmed 는 그대로(호출도 없음), 일반 재실행은 model_call 만 추가", async () => {
  const a = mk({});
  const deps = makeDeps(a);
  const row = await processProblem(problemOf(10), deps, ctx);
  deps.store.results.set(10, { ...row, status: "overridden", finalUnitId: U3, unitSource: "manual" });
  const calls = deps.store.calls.length;
  const again = await processProblem(problemOf(10), deps, ctx);
  assert.equal(again.status, "overridden");
  assert.equal(deps.store.results.get(10)!.finalUnitId, U3);
  assert.equal(deps.store.calls.length, calls);
  deps.store.results.set(10, { ...row, status: "confirmed" });
  assert.equal((await processProblem(problemOf(10), deps, ctx)).status, "confirmed");
  // 검토 필요 행 재실행: 결과는 갱신되지만 model_call 은 추가만(이전 호출 유지)
  deps.store.results.set(10, { ...row, status: "needs_review" });
  const before = deps.store.calls.slice();
  await processProblem(problemOf(10), deps, ctx, makeCaller(deps, ctx));
  assert.deepEqual(deps.store.calls.slice(0, before.length), before);
});
