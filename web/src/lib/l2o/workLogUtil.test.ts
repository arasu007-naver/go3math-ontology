// 실행: npm run test:l2o
import { test } from "node:test";
import assert from "node:assert/strict";
import { actorOfJudgedBy, isDescriptiveQuiz, isValidDate, splitQuizzes } from "./workLogUtil.ts";

test("isDescriptiveQuiz: quiz_type 또는 빈 options", () => {
  assert.equal(isDescriptiveQuiz({ quiz_type: "descriptive", options: ["a"] }), true);
  assert.equal(isDescriptiveQuiz({ options: [] }), true);
  assert.equal(isDescriptiveQuiz({}), true);
  assert.equal(isDescriptiveQuiz({ options: ["a", "b"] }), false);
});

test("splitQuizzes: 객관식·서술형 개수", () => {
  assert.deepEqual(splitQuizzes([{ options: ["a"] }, { options: [] }, { options: ["x"] }]), { quiz: 2, descriptive: 1 });
});

test("actorOfJudgedBy: override:<id> 면 id, 아니면 system", () => {
  assert.equal(actorOfJudgedBy("override:u12"), "u12");
  assert.equal(actorOfJudgedBy("llm"), "system");
  assert.equal(actorOfJudgedBy(null), "system");
});

test("isValidDate", () => {
  assert.equal(isValidDate("2026-11-28"), true);
  assert.equal(isValidDate("2026-13-01"), false);
  assert.equal(isValidDate("2026-02-30"), false);
  assert.equal(isValidDate("abc"), false);
});

import { baselineDiff, canMoveTo, computeDayNav, kstDay } from "./workLogUtil.ts";

const DAYS = ["2026-11-28", "2026-11-20", "2026-09-01"];

test("computeDayNav: date 없으면 최근 날짜", () => {
  const n = computeDayNav(DAYS);
  assert.equal(n.date, "2026-11-28");
  assert.equal(n.pageIndex, 1);
  assert.equal(n.newerDate, null);
  assert.equal(n.olderDate, "2026-11-20");
});

test("computeDayNav: 가운데 날짜", () => {
  const n = computeDayNav(DAYS, "2026-11-20");
  assert.equal(n.pageIndex, 2);
  assert.equal(n.newerDate, "2026-11-28");
  assert.equal(n.olderDate, "2026-09-01");
  assert.equal(n.firstDate, "2026-11-28");
  assert.equal(n.lastDate, "2026-09-01");
});

test("computeDayNav: 로그 없는 날짜는 pageIndex null, 가장 가까운 날짜", () => {
  const n = computeDayNav(DAYS, "2026-10-15");
  assert.equal(n.pageIndex, null);
  assert.equal(n.newerDate, "2026-11-20");
  assert.equal(n.olderDate, "2026-09-01");
});

test("computeDayNav: 이력 0건", () => {
  assert.deepEqual(computeDayNav([]), { date: null, pageIndex: null, firstDate: null, lastDate: null, newerDate: null, olderDate: null });
});

test("kstDay: Asia/Seoul 경계", () => {
  assert.equal(kstDay("2026-11-27T15:30:00.000Z"), "2026-11-28");
  assert.equal(kstDay("2026-11-27T14:59:59.000Z"), "2026-11-27");
});

test("baselineDiff", () => {
  assert.deepEqual(baselineDiff(640, 600, 1234, null), { conceptsNotMigrated: 40, problemsNotLinked: 1234 });
  assert.deepEqual(baselineDiff(null, 5, null, null), { conceptsNotMigrated: 0, problemsNotLinked: 0 });
});

test("canMoveTo: null 이거나 현재와 같으면 비활성", () => {
  assert.equal(canMoveTo(null, "2026-11-28"), false);
  assert.equal(canMoveTo("2026-11-28", "2026-11-28"), false);
  assert.equal(canMoveTo("2026-11-20", "2026-11-28"), true);
});
