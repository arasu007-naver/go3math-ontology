// 실행: node --experimental-strip-types --test src/lib/bookIndices.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupChapterFiles, linkIndexId, toPages } from "./bookIndices.ts";

const set = (n: number, prefix = "") =>
  ["indices", "dictonary", "flashcards", "quizzes"].map((k) => `${prefix}제${n}장-${k}.json`);

test("groupChapterFiles: 4파일 한 벌을 장별로 묶는다", () => {
  const r = groupChapterFiles([...set(2, "book/"), ...set(1), "readme.txt", "__MACOSX/제1장-indices.json"]);
  assert.deepEqual(r.missing, []);
  assert.deepEqual([...r.chapters.keys()], [1, 2]);
  assert.equal(r.chapters.get(2)!.dictionary, "book/제2장-dictonary.json");
});

test("groupChapterFiles: 빠진 파일을 알려 준다", () => {
  const r = groupChapterFiles(set(3).filter((f) => !f.includes("quizzes")));
  assert.equal(r.chapters.size, 0);
  assert.deepEqual(r.missing, ["제3장-quizzes.json"]);
});

test("groupChapterFiles: 깨진 한글 파일명·dictionary 철자도 받는다", () => {
  const r = groupChapterFiles(["Á¦12Àå-indices.json", "Á¦12Àå-dictionary.json", "Á¦12Àå-flashcards.json", "Á¦12Àå-quizzes.json"]);
  assert.deepEqual([...r.chapters.keys()], [12]);
});

test("linkIndexId: index 키로 색인 id 를 찾는다", () => {
  const ids = new Map([["다항식", 7]]);
  assert.equal(linkIndexId({ index: " 다항식 " }, ids), 7);
  assert.equal(linkIndexId({ index: "없는 색인" }, ids), null);
  assert.equal(linkIndexId({}, ids), null);
});

test("toPages: 정수만 남긴다", () => {
  assert.deepEqual(toPages([1, "2", "x", 3.5]), [1, 2]);
  assert.deepEqual(toPages(undefined), []);
});
