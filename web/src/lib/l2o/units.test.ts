// 실행: npm run test:l2o
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, parseUnitAnswer, pickCandidates, reasonOf, type Unit, type Vote } from "./units.ts";

const unit = (id: string, school: Unit["school"], areas: string[]): Unit => ({ unitId: id, path: id, school, areas });
const units: Unit[] = [
  ...Array.from({ length: 20 }, (_, i) => unit(`H${String(i).padStart(2, "0")}`, "HIGHSCHOOL", ["L1-FUNC"])),
  unit("M1", "MIDDLESCHOOL", ["L1-GEO"]),
  unit("M2", "MIDDLESCHOOL", ["L1-GEO"]),
  unit("M3", "MIDDLESCHOOL", ["L1-NUM"]),
  unit("M4", "MIDDLESCHOOL", ["L1-NUM"]),
];
const score = (id: string) => (id.startsWith("H") ? Number(id.slice(1)) : 0);

test("pickCandidates: 15개 상한, 유사도 상위, id 순 정렬", () => {
  const r = pickCandidates({ schoolType: "HIGHSCHOOL", mathField: "CALCULUS" }, units, score);
  assert.equal(r.candidates.length, 15);
  assert.equal(r.fallback, false);
  assert.deepEqual(r.candidates.map((c) => c.unitId), Array.from({ length: 15 }, (_, i) => `H${String(i + 5).padStart(2, "0")}`));
});

test("pickCandidates: 영역 필터 결과 3개 미만 → 학교급 전체로 확장", () => {
  const r = pickCandidates({ schoolType: "MIDDLESCHOOL", mathField: "GEOMETRY" }, units, score);
  assert.equal(r.fallback, true);
  assert.deepEqual(r.candidates.map((c) => c.unitId), ["M1", "M2", "M3", "M4"]);
});

test("pickCandidates: 영역 일치가 정확히 3개여도 학교급 유사도 순으로 15개까지 채운다(레거시 field 오류 대비)", () => {
  const hs = [...units, unit("N1", "HIGHSCHOOL", ["L1-NUM"]), unit("N2", "HIGHSCHOOL", ["L1-NUM"]), unit("N3", "HIGHSCHOOL", ["L1-NUM"])];
  const r = pickCandidates({ schoolType: "HIGHSCHOOL", mathField: "NUMBERS" }, hs, score);
  const ids = r.candidates.map((c) => c.unitId);
  assert.equal(r.fallback, true);
  assert.equal(ids.length, 15);
  for (const id of ["N1", "N2", "N3", "H19", "H08"]) assert.ok(ids.includes(id), id); // 영역 일치 3개 + 유사도 상위 12개(H08~H19)
  assert.ok(!ids.includes("H07"));
});

test("pickCandidates: 학교급 단원 0개(초등) → 전체로 확장", () => {
  const r = pickCandidates({ schoolType: "ELEMENTARY", mathField: "NUMBERS" }, units, score);
  assert.equal(r.fallback, true);
  assert.equal(r.candidates.length, 15);
});

test("pickCandidates: school_type 없으면 필터 없이 전체에서 상위 15", () => {
  const r = pickCandidates({ schoolType: null, mathField: "ALGEBRA" }, units, score);
  assert.equal(r.fallback, false);
  assert.equal(r.candidates.length, 15);
});

const v = (selector: Vote["selector"], unitId: string | null, confidence = 0.5, error?: string): Vote => ({ selector, unitId, confidence, error });

test("decide: 3/3 → 자동", () => {
  assert.deepEqual(decide([v("jev", "A"), v("claude", "A"), v("gemini", "A")]), { status: "auto_agreed", majorityUnitId: "A", agreeCount: 3, suggestion: "A" });
});

test("decide: 2/3 → 검토, 제안은 2표 단원", () => {
  const d = decide([v("jev", "A", 0.9), v("claude", "B", 0.1), v("gemini", "B", 0.1)]);
  assert.equal(d.status, "needs_review");
  assert.equal(d.suggestion, "B");
  assert.equal(d.agreeCount, 2);
});

test("decide: 1/1/1 → 검토, 제안은 최고 confidence", () => {
  const d = decide([v("jev", "A", 0.2), v("claude", "B", 0.9), v("gemini", "C", 0.5)]);
  assert.equal(d.status, "needs_review");
  assert.equal(d.suggestion, "B");
  assert.equal(d.agreeCount, 1);
});

test("decide: 오류 포함 2표 일치 → 검토", () => {
  const d = decide([v("jev", null, null as unknown as number, "not_configured"), v("claude", "A"), v("gemini", "A")]);
  assert.equal(d.status, "needs_review");
  assert.equal(d.suggestion, "A");
});

test("decide: 유효 1표 / 0표", () => {
  assert.equal(decide([v("jev", "A"), v("claude", null, 0, "timeout"), v("gemini", null)]).suggestion, "A");
  assert.deepEqual(decide([]), { status: "needs_review", majorityUnitId: null, agreeCount: 0, suggestion: null });
});

test("parseUnitAnswer", () => {
  const ids = ["L4-HALG-01", "L4-HALG-02"];
  assert.deepEqual(parseUnitAnswer('{"unit_id":"L4-HALG-01","confidence":0.8,"reason":"지수"}', ids), { unitId: "L4-HALG-01", confidence: 0.8, reason: "지수" });
  assert.equal(parseUnitAnswer('```json\n{"unit_id":"L4-HALG-02","confidence":1.4}\n```', ids).confidence, 1);
  assert.equal(parseUnitAnswer('{"unit_id":"L4-XXX","confidence":0.5}', ids).error, "out_of_candidates");
  assert.equal(parseUnitAnswer("unit is L4-HALG-01", ids).error, "invalid_json");
  assert.deepEqual(parseUnitAnswer('{"unit_id":null,"confidence":0,"reason":"모름"}', ids), { unitId: null, confidence: 0, reason: "모름" });
  assert.equal(parseUnitAnswer('{"unit_id":"NONE","confidence":0}', ids).unitId, null);
});

test("reasonOf: Claude·Gemini 원응답 안의 JSON 문자열에서 reason 추출, 없으면 null", () => {
  const claude = { content: [{ type: "text", text: '{"unit_id":"L4-HALG-07","confidence":0.97,"reason":"수열의 \\"합\\" 공식"}' }] };
  const gemini = { candidates: [{ content: { parts: [{ text: '{"unit_id":"NONE","confidence":0,"reason":"후보에 없음"}' }] } }] };
  assert.equal(reasonOf(claude), '수열의 "합" 공식');
  assert.equal(reasonOf(gemini), "후보에 없음");
  assert.equal(reasonOf({ answers: { unit: { choice: "A" } } }), null);
});
