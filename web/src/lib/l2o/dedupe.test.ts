// 실행: npm run test:l2o
import { test } from "node:test";
import assert from "node:assert/strict";
import { components, cosine, judgePair, normalizeText, pickRepresentative } from "./dedupe.ts";

test("normalizeText: 전각·대소문자·공백·backtick 안 공백", () => {
  assert.equal(normalizeText("  ＡＢＣ  집합\n의   원소  ` a in A ` "), "abc 집합 의 원소 `aina`");
  assert.equal(normalizeText("`x ^ 2`와 `y`"), normalizeText("`x^2`와  `y`"));
});

test("cosine", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([0, 0], [1, 1]), 0);
});

test("pickRepresentative: html > 길이 > 연도 > id", () => {
  const base = { hasHtmlStatement: false, statementLength: 10, curriculumYear: "2015" };
  assert.equal(pickRepresentative([{ id: 2, ...base }, { id: 1, ...base }]), 1);
  assert.equal(pickRepresentative([{ id: 1, ...base }, { id: 2, ...base, curriculumYear: "2022" }]), 2);
  assert.equal(pickRepresentative([{ id: 1, ...base, curriculumYear: "2022" }, { id: 2, ...base, statementLength: 11 }]), 2);
  assert.equal(pickRepresentative([{ id: 1, ...base, statementLength: 99 }, { id: 2, ...base, hasHtmlStatement: true }]), 2);
});

test("components: 단독 포함, 정렬", () => {
  assert.deepEqual(components([5, 1, 3, 2, 4], [[5, 3], [3, 1], [2, 4]]), [[1, 3, 5], [2, 4]]);
  assert.deepEqual(components([2, 1], []), [[1], [2]]);
});

test("judgePair", () => {
  assert.equal(judgePair(0.9), "merge");
  assert.equal(judgePair(0.8), "merge");
  assert.equal(judgePair(0.6), "review");
  assert.equal(judgePair(0.2), "separate");
  assert.equal(judgePair(null), "review");
});
