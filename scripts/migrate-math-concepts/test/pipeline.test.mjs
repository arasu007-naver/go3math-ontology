// DB·API 없이 돌리는 단위 테스트: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, writeCsv, readCsv, normalizeTitle, titleSimilarity, gradeOf, stripHtml } from "../lib/util.mjs";
import { buildMergeGroups, applyMergeGroups } from "../lib/merge.mjs";
import { passesFilter, pickCandidates, pickPrereqs } from "../lib/candidates.mjs";
import { decide, reviewRow, evenSample } from "../lib/review.mjs";
import { validateJudgment, judgePrompt } from "../lib/prompts.mjs";
import os from "node:os";
import path from "node:path";

const concept = (id, o = {}) => {
  const c = {
    id, is_on: true, raw_title: `개념${id}`, raw_statement: `본문${id}`, concept_type: "DEFINITION", math_field: "ALGEBRA",
    curriculum_year: "2015", updated_at: "2024-01-01 00:00:00", grade: 10, chapters: [], ...o,
  };
  return { title: c.raw_title, statement: c.raw_statement, ...c };
};

test("제목 정규화·유사도·학년", () => {
  assert.equal(normalizeTitle(" 이차 방정식(근의 공식) "), "이차방정식근의공식");
  assert.equal(normalizeTitle("A·B, C!"), "abc");
  assert.ok(titleSimilarity("이차방정식의근", "이차방정식의해") >= 0.8);
  assert.equal(gradeOf("HIGHSCHOOL_2"), 11);
  assert.equal(gradeOf("MIDDLESCHOOL_1"), 7);
  assert.equal(gradeOf("ELEMENTARY_6"), 6);
  assert.equal(gradeOf(null), null);
});

test("HTML 제거: 태그·이미지·엔티티, 백틱 안 수식은 그대로", () => {
  assert.equal(stripHtml('<div style="">비례배분의 법칙</div>'), "비례배분의 법칙");
  assert.equal(stripHtml('<div>①`x_1ltx_2 `</div><div>② `a<b>c`&nbsp;이다</div>'), "①`x_1ltx_2 `\n② `a<b>c` 이다");
  assert.equal(stripHtml('<div><img src="x.png" /></div>'), "[이미지]");
  assert.equal(normalizeTitle(stripHtml('<div  class="conceptClass"   >집합의 표현 방법</div>')), "집합의표현방법");
});

test("CSV 왕복 (쉼표·따옴표·줄바꿈·BOM·목록)", () => {
  const file = path.join(os.tmpdir(), `mmc-${process.pid}.csv`);
  writeCsv(file, ["a", "b", "c"], [{ a: 'x,"y"', b: "줄\n바꿈", c: [1, 2, 3] }, { a: "", b: null, c: "z" }]);
  const rows = readCsv(file);
  assert.deepEqual(rows, [{ a: 'x,"y"', b: "줄\n바꿈", c: "1 2 3" }, { a: "", b: "", c: "z" }]);
  assert.deepEqual(parseCsv("﻿h1,h2\r\n1,2\r\n\r\n"), [{ h1: "1", h2: "2" }]);
});

test("병합 그룹: 연쇄 union, 대표 선정, 검수 표시", () => {
  const cs = [
    concept(1, { raw_statement: "짧음" }),
    concept(2, { curriculum_year: "2022", raw_statement: "2022 본문" }),
    concept(3, { raw_statement: "아주 긴 본문입니다 아주 긴 본문" }),
    concept(4),
    concept(5, { grade: 7, concept_type: "THEOREM" }),
    concept(6),
  ];
  const pairs = [{ a: 1, b: 2 }, { a: 2, b: 3 }, { a: 1, b: 3 }, { a: 5, b: 6 }, { a: 4, b: 6 }];
  const v = { "1-2": "same", "2-3": "same", "1-3": "different", "5-6": "same", "4-6": "parent_child" };
  const groups = buildMergeGroups(cs, pairs, (p) => ({ verdict: v[`${p.a}-${p.b}`], rationale: "r" }));
  assert.equal(groups.length, 2);
  const g1 = groups.find((g) => g.merged_ids.includes(1));
  assert.equal(g1.representative_id, 2); // 2022 우선
  assert.deepEqual([...g1.merged_ids].sort(), [1, 3]);
  assert.equal(g1.needs_review, "Y"); // 1-3 은 different (연쇄)
  assert.equal(g1.approved, "");
  const g2 = groups.find((g) => g.merged_ids.includes(5) || g.representative_id === 5);
  assert.match(g2.review_reasons, /학년 2단계/);
  assert.match(g2.review_reasons, /concept_type/);
  // 대상이기만 한 루트(6)도 그룹에 들어간다
  assert.deepEqual([g2.representative_id, ...g2.merged_ids].sort(), [5, 6]);
});

test("병합 적용: approved=Y 만, merge_notes 원문 보존, 단원 힌트 합침", () => {
  const cs = [
    concept(1, { raw_statement: "공통 본문", chapters: [{ id: 9, title: "구단원" }] }),
    concept(2, { raw_statement: "공통 본문 그리고 추가 성질 `x^2`" }),
    concept(3, { raw_statement: "공통 본문" }),
    concept(4),
    concept(5),
  ];
  const rows = [
    { group_id: "G1", representative_id: "2", merged_ids: "1 3", approved: "Y" },
    { group_id: "G2", representative_id: "4", merged_ids: "5", approved: "" },
  ];
  const reps = applyMergeGroups(cs, rows);
  assert.deepEqual(reps.map((r) => r.id), [2, 4, 5]);
  const r2 = reps[0];
  assert.deepEqual(r2.merged_source_ids, [1, 3]);
  assert.deepEqual(r2.merge_notes, []); // 1·3 본문이 대표 본문에 포함
  assert.deepEqual(r2.chapters.map((c) => c.id), [9]);

  const reps2 = applyMergeGroups(cs, [{ group_id: "G1", representative_id: "1", merged_ids: "2", approved: "y" }]);
  assert.deepEqual(reps2[0].merge_notes, [{ source_id: 2, raw_title: "개념2", raw_statement: "공통 본문 그리고 추가 성질 `x^2`" }]);

  assert.throws(() => applyMergeGroups(cs, [
    { group_id: "G1", representative_id: "1", merged_ids: "2", approved: "Y" },
    { group_id: "G2", representative_id: "3", merged_ids: "2", approved: "Y" },
  ]), /여러 그룹/);
  assert.throws(() => applyMergeGroups(cs, [{ group_id: "G1", representative_id: "1", merged_ids: "99", approved: "Y" }]), /없습니다/);
});

test("후보 필터: 학년 ±1, 영역, 선택 과목, 필터 해제", () => {
  const unit = (id, grade, areas) => ({ id, grade, areas });
  assert.ok(passesFilter(concept(1, { grade: 10 }), unit("u", 11, ["L1-EQ"])));
  assert.ok(!passesFilter(concept(1, { grade: 10 }), unit("u", 12, ["L1-EQ"])));
  assert.ok(!passesFilter(concept(1, { grade: 10 }), unit("u", 10, ["L1-GEO"]))); // ALGEBRA ↛ 도형
  assert.ok(passesFilter(concept(1, { grade: 11 }), unit("u", null, ["L1-FUNC"])));
  assert.ok(!passesFilter(concept(1, { grade: 5 }), unit("u", null, ["L1-FUNC"]))); // 초등 개념에 선택 과목 X
  // 기본값 메타데이터(school_type 없음): 학년 null, 분야 필터도 쓰지 않는다
  assert.ok(passesFilter(concept(1, { grade: null, meta_reliable: false }), unit("u", 7, ["L1-GEO"])));

  const units = [unit("a", 10, ["L1-EQ"]), unit("b", 12, ["L1-EQ"]), unit("c", 10, ["L1-GEO"])];
  const vecs = [[1, 0], [0.9, 0.1], [0, 1]];
  const r1 = pickCandidates(concept(1), [1, 0], units, vecs, 1);
  assert.deepEqual(r1, { candidates: [{ unit_id: "a", score: 1 }], filter_relaxed: false });
  const r2 = pickCandidates(concept(1), [0, 1], units, vecs, 2); // 필터 통과 1개 < 2 → 해제
  assert.equal(r2.filter_relaxed, true);
  assert.deepEqual(r2.candidates.map((c) => c.unit_id), ["c", "b"]);
});

test("선수 개념 후보: 같은·하위 학년, 같은 분야, 자기 자신 제외", () => {
  const reps = [concept(1, { grade: 10 }), concept(2, { grade: 9 }), concept(3, { grade: 11 }), concept(4, { grade: 9, math_field: "GEOMETRY" })];
  const vecs = [[1, 0], [1, 0], [1, 0], [1, 0]];
  assert.deepEqual(pickPrereqs(reps[0], vecs[0], reps, vecs, 5), [2]);
  const loose = [concept(1, { grade: null, meta_reliable: false }), concept(4, { grade: 9, math_field: "GEOMETRY" })];
  assert.deepEqual(pickPrereqs(loose[0], [1, 0], loose, [[1, 0], [1, 0]], 5), [4]);
});

test("확정 규칙", () => {
  const r = (p, c) => ({ result: { primary_unit_id: p, confidence: c } });
  assert.equal(decide({ claude: r("u1", 0.9), gemini: r("u1", 0.8) }, 0.8), "confirmed");
  assert.equal(decide({ claude: r("u1", 0.9), gemini: r("u1", 0.79) }, 0.8), "review");
  assert.equal(decide({ claude: r("u1", 0.9), gemini: r("u2", 0.9) }, 0.8), "review");
  assert.equal(decide({ claude: r(null, 0), gemini: r(null, 0) }, 0.8), "review");
  assert.equal(decide({ claude: { error: "x" }, gemini: r("u1", 0.9) }, 0.8), "error");
  assert.equal(decide({ claude: r("u1", 0.9) }, 0.8), "pending");
});

test("판정 검증: 후보 밖 primary 거부, 후보 밖 보조·코드·선수 제거, null 이면 confidence 0", () => {
  const item = { item_id: "7", item_type: "concept", candidateAchievementCodes: ["[10공수1-01-01]"] };
  const cand = new Set(["u1", "u2"]);
  const pre = new Set(["3"]);
  const base = { item_id: "7", item_type: "concept", primary_unit_id: "u1", secondary_unit_ids: ["u2", "u9", "u1"], achievement_codes: ["[10공수1-01-01]", "X"], prerequisite_concept_ids: ["3", "4"], rationale: "r", confidence: 0.9 };
  const j = validateJudgment(base, item, cand, pre);
  assert.deepEqual(j.secondary_unit_ids, ["u2"]);
  assert.deepEqual(j.achievement_codes, ["[10공수1-01-01]"]);
  assert.deepEqual(j.prerequisite_concept_ids, ["3"]);
  assert.deepEqual(j.dropped, ["u9", "X", "4"]);
  assert.throws(() => validateJudgment({ ...base, primary_unit_id: "u9" }, item, cand, pre), /후보 밖/);
  assert.throws(() => validateJudgment({ ...base, item_id: "8" }, item, cand, pre), /item_id/);
  assert.throws(() => validateJudgment({ ...base, extra: 1 }, item, cand, pre));
  assert.equal(validateJudgment({ ...base, primary_unit_id: null, confidence: 0.7 }, item, cand, pre).confidence, 0);
});

test("검수 행: 자동 확정은 미리 채우고, 검수자가 적은 값은 유지", () => {
  const units = new Map([["u1", { path: "공통 수학1 > 다항식의 연산" }]]);
  const rep = concept(7, { raw_statement: "본문\n둘째 줄" });
  const res = { primary_unit_id: "u1", secondary_unit_ids: [], achievement_codes: [], prerequisite_concept_ids: ["3"], confidence: 0.9, rationale: "r" };
  const st = { status: "confirmed", claude: { result: res }, gemini: { result: res } };
  const row = reviewRow({ item_id: "7", item_type: "concept" }, rep, st, units, undefined);
  assert.equal(row.final_primary_unit_id, "u1");
  assert.deepEqual(row.final_prerequisite_ids, ["3"]);
  assert.equal(row.claude_primary_path, "공통 수학1 > 다항식의 연산");
  assert.equal(row.statement_excerpt, "본문 둘째 줄");
  assert.equal(row.approved, "");
  const kept = reviewRow({ item_id: "7", item_type: "concept" }, rep, { ...st, status: "review" }, units, { final_primary_unit_id: "u2", approved: "Y" });
  assert.equal(kept.final_primary_unit_id, "u2");
  assert.equal(kept.approved, "Y");
  const blank = reviewRow({ item_id: "7", item_type: "concept" }, rep, { ...st, status: "review" }, units, undefined);
  assert.equal(blank.final_primary_unit_id, "");
});

test("균등 표본", () => {
  assert.deepEqual(evenSample([1, 2, 3, 4, 5, 6], 3), [1, 3, 5]);
  assert.deepEqual(evenSample([1, 2], 5), [1, 2]);
});

test("판정 프롬프트: 후보가 같으면 system 이 같아 캐시된다, 항목 내용은 user 에", () => {
  const units = [
    { id: "L4-B", area_names: ["함수"], path: "대수 > 수열", grade: 11, achievements: [] },
    { id: "L3-A", area_names: ["수와 연산"], path: "소인수분해", grade: 7, achievements: [] },
  ];
  const item = (id, title) => ({ item_id: id, item_type: "concept", concept: concept(Number(id), { raw_title: title, meta_reliable: false }) });
  const p1 = judgePrompt(item("1", "등차수열"), units, []);
  const p2 = judgePrompt(item("2", "소수"), [...units].reverse(), []);
  assert.equal(p1.system, p2.system);
  assert.ok(p1.system.indexOf("L3-A") < p1.system.indexOf("L4-B"));
  assert.match(p1.user, /제목: 등차수열/);
  assert.match(p1.user, /미상/);
  assert.doesNotMatch(p1.user, /후보 단원/);
});
