// 실행: npm run test:e2c
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickFinalUnit, type PrecedenceGraph } from "./precedence.ts";
import { tallyUnits, tallyConcepts } from "./vote.ts";
import { computeReasons, type ReviewInput } from "./review.ts";
import { preprocess, resolveExam, splitSteps, type RawProblem } from "./preprocess.ts";
import { callHash } from "./hash.ts";
import { subjectPrefixes } from "./subjectMap.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import type { ConceptProposal } from "./types.ts";

const g = (over: Partial<PrecedenceGraph> = {}): PrecedenceGraph => ({
  unitPrereq: [],
  subjectPrereq: [],
  unitSubject: { A1: "SA", A2: "SA", A3: "SA", B1: "SB", B2: "SB" },
  subjectOrder: { SA: 0, SB: 1 },
  unitOrder: { A1: 1, A2: 2, A3: 3, B1: 1, B2: 2 },
  ...over,
});

test("pickFinalUnit: 단일 최대 → precedence", () => {
  const r = pickFinalUnit(["A1", "A2", "A3"], g({ unitPrereq: [["A1", "A2"], ["A2", "A3"]] }));
  assert.deepEqual(r, { unitId: "A3", rule: "precedence" });
});
test("pickFinalUnit: 선후 미연결 동률 → curriculum_order(과목 순서, 단원 번호상 가장 뒤)", () => {
  assert.deepEqual(pickFinalUnit(["A1", "A3"], g()), { unitId: "A3", rule: "curriculum_order" });
  assert.deepEqual(pickFinalUnit(["A3", "B1"], g()), { unitId: "B1", rule: "curriculum_order" });
});
test("pickFinalUnit: 과목 PREREQ_OF 만으로 앞 과목 단원 < 뒤 과목 단원", () => {
  // 과목 순서를 일부러 거꾸로 줘도 PREREQ_OF 가 우선
  const r = pickFinalUnit(["A3", "B1"], g({ subjectPrereq: [["SA", "SB"]], subjectOrder: { SA: 5, SB: 0 } }));
  assert.deepEqual(r, { unitId: "B1", rule: "precedence" });
});
test("pickFinalUnit: 사이클 → precedence_cycle", () => {
  const r = pickFinalUnit(["A1", "A2"], g({ unitPrereq: [["A1", "A2"], ["A2", "A1"]] }));
  assert.equal(r.error, "precedence_cycle");
  assert.equal(r.unitId, null);
});
test("pickFinalUnit: 단원 하나, 빈 집합", () => {
  assert.equal(pickFinalUnit(["A2"], g()).unitId, "A2");
  assert.equal(pickFinalUnit([], g()).error, "empty");
});

const v = (model: "jev" | "claude" | "gemini", unitId: string | null, ok = unitId != null) => ({ model, ok, unitId });
test("tallyUnits: 3/3, 2/3, 모두 다름", () => {
  const a = tallyUnits([v("jev", "U1"), v("claude", "U1"), v("gemini", "U1")]);
  assert.equal(a.status, "decided");
  assert.equal(a.status === "decided" && a.agreement, "3/3");
  const b = tallyUnits([v("jev", "U1"), v("claude", "U2"), v("gemini", "U1")]);
  assert.equal(b.status === "decided" && b.unitId, "U1");
  assert.deepEqual(b.flags, ["majority_2of3"]);
  const c = tallyUnits([v("jev", "U1"), v("claude", "U2"), v("gemini", "U3")]);
  assert.equal(c.status, "needs_grok");
  assert.equal(c.agreement, "none");
});
test("tallyUnits: 성공 2개 일치/불일치, 1개, 0개", () => {
  const a = tallyUnits([v("jev", null, false), v("claude", "U1"), v("gemini", "U1")]);
  assert.equal(a.status, "decided");
  assert.deepEqual(a.flags, ["two_models_only"]);
  assert.equal(tallyUnits([v("jev", null, false), v("claude", "U1"), v("gemini", "U2")]).status, "needs_grok");
  const one = tallyUnits([v("jev", null, false), v("claude", "U1"), v("gemini", null, false)]);
  assert.equal(one.status, "needs_grok");
  assert.deepEqual(one.flags, ["insufficient_models"]);
  assert.equal(tallyUnits([v("jev", null, false), v("claude", null, false), v("gemini", null, false)]).status, "error");
});

const cp = (model: "jev" | "claude" | "gemini", primary: string | null, secondary: string[] = [], confidence = 0.8, ok = primary != null): ConceptProposal => ({
  model, ok, primary, secondary, confidence, evidenceSteps: [],
});
test("tallyConcepts: 주 개념 다수결, 보조는 역할 무관 2표 이상만, 주 개념 제외", () => {
  const t = tallyConcepts([cp("jev", "C1", ["C2", "C9"]), cp("claude", "C1", ["C2"]), cp("gemini", "C2", ["C1", "C7"])]);
  assert.equal(t.status, "decided");
  if (t.status !== "decided") return;
  assert.equal(t.primary, "C1");
  assert.deepEqual(t.secondary, ["C2"]); // C1 제외, C9·C7 은 1표
});
test("tallyConcepts: 보조 3개 초과 시 (모델 수, 평균 확신도, id) 정렬", () => {
  const t = tallyConcepts([
    cp("jev", "P", ["C5", "C4", "C3", "C2"], 0.9),
    cp("claude", "P", ["C5", "C4", "C3", "C2"], 0.5),
    cp("gemini", "P", ["C5", "C1"], 0.7),
  ]);
  if (t.status !== "decided") return assert.fail();
  assert.deepEqual(t.secondary, ["C5", "C2", "C3"]); // C5 3표, 나머지 2표 → 확신도 같으면 id 순
});
test("tallyConcepts: 성공 2개면 두 모델 공통만, 불일치/1개/0개", () => {
  const t = tallyConcepts([cp("jev", null, [], 0, false), cp("claude", "P", ["C1", "C2"]), cp("gemini", "P", ["C2", "C3"])]);
  if (t.status !== "decided") return assert.fail();
  assert.equal(t.agreement, "2/2");
  assert.deepEqual(t.secondary, ["C2"]);
  assert.deepEqual(t.flags, ["two_models_only"]);
  const n = tallyConcepts([cp("jev", "A", ["B"]), cp("claude", "C", ["B"]), cp("gemini", "D")]);
  assert.equal(n.status, "needs_grok");
  assert.deepEqual(n.status === "needs_grok" && n.union, ["A", "B", "C", "D"]);
  assert.equal(tallyConcepts([cp("claude", "P")]).status, "needs_grok");
  assert.equal(tallyConcepts([]).status, "error");
});

const base: ReviewInput = {
  unitSource: "majority", conceptSource: "majority", unitFlags: [], conceptFlags: [], unitTie: false, unitConf: 0.9, conceptConf: 0.9,
  hintConflict: false, outOfCandidates: false, truncated: false, candidateFallback: false,
};
test("사유 코드: auto 판정과 각 코드", () => {
  const cfg = DEFAULT_CONFIG;
  assert.deepEqual(computeReasons(base, cfg), { reasons: [], status: "auto" });
  const info = computeReasons({ ...base, unitFlags: ["majority_2of3"], candidateFallback: true }, cfg);
  assert.equal(info.status, "auto");
  assert.deepEqual(info.reasons.sort(), ["candidate_fallback", "majority_2of3"]);
  const cases: [Partial<ReviewInput>, string][] = [
    [{ unitSource: "grok" }, "unit_grok"],
    [{ conceptSource: "grok" }, "concept_grok"],
    [{ unitFlags: ["two_models_only"] }, "two_models_only"],
    [{ conceptFlags: ["insufficient_models"] }, "insufficient_models"],
    [{ unitTie: true }, "unit_tie"],
    [{ unitConf: 0.4 }, "unit_low_conf"],
    [{ conceptConf: 0.5 }, "concept_low_conf"],
    [{ hintConflict: true }, "unit_hint_conflict"],
    [{ outOfCandidates: true }, "out_of_candidates"],
    [{ truncated: true }, "truncated"],
  ];
  for (const [over, code] of cases) {
    const r = computeReasons({ ...base, ...over }, cfg);
    assert.ok(r.reasons.includes(code as never), code);
    assert.equal(r.status, "needs_review", code);
  }
});

const raw = (over: Partial<RawProblem> = {}): RawProblem => ({
  id: 1, statement: "<p>함수 `f(x)=x^2` 의 값을 구하시오.</p>", note: "<div>`f(2)=4` 이다. 따라서 답은 4.</div><div>끝났다.</div>",
  year: 2022, month: 11, subscriber: "평가원", subject: "COMMON", number: 3, points: 3, ...over,
});
test("전처리: HTML 제거(backtick 유지) + S번호 분할", () => {
  const p = preprocess(raw());
  assert.equal(p.problemText, "함수 `f(x)=x^2` 의 값을 구하시오.");
  assert.deepEqual(p.keySteps.map((s) => s.id), ["S1", "S2", "S3"]);
  assert.equal(p.keySteps[0].text, "`f(2)=4` 이다.");
  assert.equal(p.skipped, false);
  assert.equal(p.truncated, false);
  assert.equal(p.meta.exam, "수능");
});
test("splitSteps: backtick 안 마침표는 자르지 않는다", () => {
  assert.deepEqual(splitSteps("`x=1. 5` 이다. 끝"), ["`x=1. 5` 이다.", "끝"]);
});
test("전처리: 40자 미만 skip, 6000자 초과 truncated", () => {
  assert.equal(preprocess(raw({ statement: "짧다", note: "짧다" })).skipped, true);
  const longNote = Array.from({ length: 400 }, (_, i) => `단계 ${i} 에서 값을 계산한다.`).join("\n");
  const p = preprocess(raw({ note: longNote }));
  assert.equal(p.truncated, true);
  assert.ok(p.keySteps.some((s) => s.id === "" && s.text.includes("중략")));
  assert.equal(p.keySteps[0].id, "S1");
  assert.equal(p.keySteps[p.keySteps.length - 1].id, "S400");
  assert.ok(p.problemText.length + p.keySteps.reduce((n, s) => n + s.text.length + s.id.length + 2, 0) <= 6100);
});
test("메타 해석: 시험 종류", () => {
  assert.equal(resolveExam("평가원", 11), "수능");
  assert.equal(resolveExam("평가원", 6), "모평");
  assert.equal(resolveExam("서울시교육청", 3), "학평");
  assert.equal(resolveExam("기타", 3), "기타");
});
test("과목 매핑", () => {
  assert.deepEqual(subjectPrefixes("COMMON"), ["L4-HALG", "L4-HCAL1"]);
  assert.deepEqual(subjectPrefixes("CALCULUS"), ["L4-HCAL2"]);
  assert.equal(subjectPrefixes("GA_TYPE"), null);
  assert.equal(subjectPrefixes(null), null);
});
test("해시 멱등: 같은 입력 같은 해시, 프롬프트 버전이 바뀌면 다른 해시", () => {
  const a = { inputHash: preprocess(raw()).inputHash, stage: "unit", role: "proposer", options: [{ id: "b", text: "B" }, { id: "a", text: "A" }], promptVersion: "e2c-unit-v2", model: "m" };
  assert.equal(preprocess(raw()).inputHash, preprocess(raw()).inputHash);
  assert.equal(callHash(a), callHash({ ...a, options: [...a.options].reverse() }));
  assert.notEqual(callHash(a), callHash({ ...a, promptVersion: "e2c-unit-v3" }));
});
