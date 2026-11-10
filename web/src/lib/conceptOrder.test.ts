// 실행: node --experimental-strip-types --test src/lib/conceptOrder.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareEdges, dropCycles, parseEdges } from "./conceptOrder.ts";

test("parseEdges: 목록에 없는 번호·자기 자신은 버린다", () => {
  const text = '```json\n{"edges":[{"before":1,"after":2},{"before":2,"after":2},{"before":1,"after":9}]}\n```';
  assert.deepEqual(parseEdges(text, [1, 2, 3]), [[1, 2]]);
  assert.deepEqual(parseEdges('{"edges":[]}', [1, 2]), []);
  assert.equal(parseEdges("모르겠습니다", [1, 2]), null);
  assert.equal(parseEdges('{"x":1}', [1, 2]), null);
});

test("compareEdges: 같으면 확정, 다르면 분쟁", () => {
  const r = compareEdges(
    [[1, 2], [2, 3], [4, 3]],
    [[1, 2], [3, 2], [1, 4]]
  );
  assert.deepEqual(r.agreed, [[1, 2]]);
  assert.deepEqual(r.disputes, [
    { a: 2, b: 3, gemini: "ab", claude: "ba" },
    { a: 3, b: 4, gemini: "ba", claude: "none" },
    { a: 1, b: 4, gemini: "none", claude: "ab" },
  ]);
});

test("compareEdges: 한 모델이 양방향을 내면 관계 없음", () => {
  const r = compareEdges([[1, 2], [2, 1]], []);
  assert.deepEqual(r, { agreed: [], disputes: [] });
});

test("dropCycles: 순환을 만드는 관계는 뺀다", () => {
  const r = dropCycles([[1, 2], [2, 3], [3, 1], [1, 3]]);
  assert.deepEqual(r.kept, [[1, 2], [2, 3], [1, 3]]);
  assert.deepEqual(r.dropped, [[3, 1]]);
});
