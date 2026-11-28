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
