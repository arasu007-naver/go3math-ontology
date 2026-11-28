import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyOverride, confirmResult, OverrideError, savePilotLabel, type OverrideStore } from "../server/e2cOverride.ts";
import { makeDeps, conceptsOf, problemOf, scripted, type Script } from "./testkit.ts";
import { processProblem, type ResultRow } from "../server/e2cPipeline.ts";
import { buildReport, writeReport, pilotMetrics } from "./report.ts";

const U1 = "L4-HALG-01", U3 = "L4-HCAL1-01";
const ok: Script = (r) => (r.stage === "unit" ? { unit: [U1] } : { primary: `${U1}#1`, secondary: [`${U1}#2`] });
async function setup() {
  const deps = makeDeps({ jev: scripted("jev", ok), claude: scripted("claude", ok), gemini: scripted("gemini", ok), grok: scripted("grok", ok) });
  const row = await processProblem(problemOf(1), deps, { jobRunId: null, shadowGrok: false });
  const overrides: { before: ResultRow; after: ResultRow; reason: string }[] = [];
  const labels: unknown[] = [];
  const store: OverrideStore = {
    getResult: async (id) => deps.store.results.get(id) ?? null,
    conceptIdsOfUnit: async (u) => (u.startsWith("L4-") ? conceptsOf(u).map((c) => c.conceptId) : null),
    saveOverride: async (a) => { overrides.push(a); deps.store.results.set(a.after.problemId, a.after); },
    saveConfirmed: async (r) => void deps.store.results.set(r.problemId, r),
    savePilotLabel: async (l) => void labels.push(l),
  };
  return { deps, row, store, overrides, labels };
}
const code = (p: Promise<unknown>) => p.then(() => 200, (e) => (e instanceof OverrideError ? e.status : 500));

test("override: 채택 단원 밖 개념, 보조 4개, 사유 없음은 400", async () => {
  const { store } = await setup();
  assert.equal(await code(applyOverride(store, { problemId: 1, primaryConceptId: `${U3}#1`, reason: "x" }, "a")), 400);
  assert.equal(await code(applyOverride(store, { problemId: 1, primaryConceptId: `${U1}#1`, secondaryConceptIds: [2, 3, 4, 5].map((n) => `${U1}#${n}`), reason: "x" }, "a")), 400);
  assert.equal(await code(applyOverride(store, { problemId: 1, primaryConceptId: `${U1}#1`, reason: " " }, "a")), 400);
  assert.equal(await code(applyOverride(store, { problemId: 99, primaryConceptId: `${U1}#1`, reason: "x" }, "a")), 404);
});

test("override: 정상 요청은 manual_override 추가, status=overridden, decision_source=manual", async () => {
  const { store, overrides, deps } = await setup();
  const after = await applyOverride(store, { problemId: 1, primaryConceptId: `${U1}#3`, secondaryConceptIds: [`${U1}#4`], reason: "검토" }, "a");
  assert.equal(overrides.length, 1);
  assert.equal(after.status, "overridden");
  assert.equal(after.conceptSource, "manual");
  assert.equal(after.unitSource, "majority"); // 단원은 그대로
  assert.equal(deps.store.results.get(1)!.primaryConceptId, `${U1}#3`);
});

test("override: 단원을 바꾸면 unit manual, 개념 단계 재실행 표시, 이전 개념은 이력에 남는다", async () => {
  const { store, row } = await setup();
  const after = await applyOverride(store, { problemId: 1, unitId: U3, reason: "단원 오류" }, "a");
  assert.equal(after.unitSource, "manual");
  assert.equal(after.finalUnitId, U3);
  assert.equal(after.rerunConcept, true);
  assert.equal(after.primaryConceptId, null);
  assert.deepEqual((after.conceptDetail as { history: { primaryConceptId: string }[] }).history[0].primaryConceptId, row.primaryConceptId);
  assert.equal(await code(confirmResult(store, 1, "a")), 400); // 주 개념 없이는 확인 불가
  await applyOverride(store, { problemId: 1, primaryConceptId: `${U3}#2`, reason: "개념 선택" }, "a");
  assert.equal((await confirmResult(store, 1, "a")).status, "confirmed");
});

test("파일럿 라벨: 단원 밖 개념은 400", async () => {
  const { store, labels } = await setup();
  assert.equal(await code(savePilotLabel(store, { problemId: 1, unitId: U1, primaryConceptId: `${U3}#1`, secondaryConceptIds: [] }, "a")), 400);
  await savePilotLabel(store, { problemId: 1, unitId: U1, primaryConceptId: `${U1}#1`, secondaryConceptIds: [] }, "a");
  assert.equal(labels.length, 1);
});

test("리포트: 픽스처로 reports/e2c-<kind>-<date>.md 생성, 캐시·Batch 절감과 파일럿 지표 포함", async () => {
  const { deps, row } = await setup();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2c-report-"));
  const data = {
    kind: "pilot", date: "2026-11-28", jobId: "job1", mode: "realtime", targetCount: 7142, rows: [row], calls: deps.store.calls, reusedByModel: { claude: 2 },
    labels: [{ problemId: 1, unitId: U1, primaryConceptId: `${U1}#1`, secondaryConceptIds: [`${U1}#2`] }],
  };
  const file = writeReport(dir, data);
  assert.equal(file, path.join(dir, "reports", "e2c-pilot-2026-11-28.md"));
  const md = fs.readFileSync(file, "utf8");
  for (const s of ["대상 필터 건수", "7142", "사유 코드", "결정 경로", "모델별 결과 캐시 재사용 합계: 2건", "캐시 입력 토큰 비율", "Batch 처리 건수", "Batch·캐시로 줄인 추정 금액", "파일럿 지표", "단원 정확도"]) assert.ok(md.includes(s), s);
  const m = pilotMetrics([row], data.labels);
  assert.equal(m.unitAccuracy, 1);
  assert.equal(m.primaryAccuracy, 1);
  assert.ok(buildReport({ ...data, kind: "run_all", labels: undefined }).indexOf("파일럿 지표") < 0);
});
