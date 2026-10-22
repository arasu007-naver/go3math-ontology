// 단계 0. 중복 개념 병합 후보 탐지 + Claude 판정. 원본 DB 는 읽기만 한다.
//   node 01-merge.mjs --detect-only   후보 쌍만 뽑는다(임베딩 비용만 듦) → out/merge_candidates.csv
//   node 01-merge.mjs                 후보 쌍을 판정하고 병합 그룹을 만든다 → out/merge_groups.csv 외
// merge_groups.csv 의 approved 열이 Y 인 그룹만 다음 단계(02)에서 병합된다.
// 사용자 검수 대상(needs_review=Y)은 approved 가 비어 있으니, 검토 후 Y 를 적는다(병합 거부는 N).
import { cfg, out } from "./lib/config.mjs";
import { openMaria, loadConcepts, conceptText } from "./lib/source.mjs";
import { embed, claudeJson, BudgetError } from "./lib/llm.mjs";
import { buildMergeGroups } from "./lib/merge.mjs";
import { MERGE_SYSTEM, mergeUserPrompt, mergeSchema, MergeVerdict } from "./lib/prompts.mjs";
import { cosine, normalizeTitle, titleSimilarity, pool, readJson, writeJson, writeCsv, parseArgs, gradeLabel } from "./lib/util.mjs";

const args = parseArgs();
const m = await openMaria();
let concepts;
try {
  concepts = await loadConcepts(m);
} finally {
  await m.end();
}
const all = concepts.length;
concepts = concepts.filter((c) => c.is_on); // is_on=0 은 병합 후보에서도 제외
console.log(`원본 ${all}개 중 is_on=1 ${concepts.length}개 (is_on=0 ${all - concepts.length}개 제외)`);
const byId = new Map(concepts.map((c) => [c.id, c]));

// ---------- 1. 후보 탐지 ----------
const pairs = new Map(); // "a-b" (a<b) → { a, b, reasons:Set, cosine, titleSim }
const addPair = (x, y, reason, extra = {}) => {
  const [a, b] = x.id < y.id ? [x, y] : [y, x];
  const k = `${a.id}-${b.id}`;
  const p = pairs.get(k) ?? pairs.set(k, { a: a.id, b: b.id, reasons: new Set() }).get(k);
  p.reasons.add(reason);
  Object.assign(p, extra);
};

const norm = concepts.map((c) => normalizeTitle(c.title));
const vecs = await embed(concepts.map(conceptText));
for (let i = 0; i < concepts.length; i++) {
  for (let j = i + 1; j < concepts.length; j++) {
    const [x, y] = [concepts[i], concepts[j]];
    if (norm[i] && norm[i] === norm[j]) addPair(x, y, "title_exact");
    const cos = cosine(vecs[i], vecs[j]);
    if (cos >= cfg.merge.cosine) addPair(x, y, "embedding", { cosine: cos });
    if (x.math_field && x.math_field === y.math_field && Math.min(norm[i].length, norm[j].length) >= 3) {
      const sim = titleSimilarity(norm[i], norm[j]);
      if (sim >= cfg.merge.titleSimilarity) addPair(x, y, "title_similar", { titleSim: sim });
    }
  }
}
const pairList = [...pairs.values()].map((p) => ({ ...p, reasons: [...p.reasons].join(" ") }));
console.log(`중복 후보 쌍: ${pairList.length}개`);

const pairRow = (p, v) => ({
  a: p.a, a_title: byId.get(p.a).title, a_grade: gradeLabel(byId.get(p.a).grade), a_type: byId.get(p.a).concept_type,
  b: p.b, b_title: byId.get(p.b).title, b_grade: gradeLabel(byId.get(p.b).grade), b_type: byId.get(p.b).concept_type,
  reasons: p.reasons, cosine: p.cosine?.toFixed(3) ?? "", title_sim: p.titleSim?.toFixed(2) ?? "",
  verdict: v?.verdict ?? "", parent_id: v?.parent_id ?? "", rationale: v?.rationale ?? v?.error ?? "",
});
const pairHeader = ["a", "a_title", "a_grade", "a_type", "b", "b_title", "b_grade", "b_type", "reasons", "cosine", "title_sim", "verdict", "parent_id", "rationale"];

if (args["detect-only"]) {
  writeCsv(out("merge_candidates.csv"), pairHeader, pairList.map((p) => pairRow(p)));
  console.log(`→ ${out("merge_candidates.csv")}`);
  process.exit(0);
}

// ---------- 2. 판정 (체크포인트: out/merge_state.json) ----------
const stateFile = out("merge_state.json");
const state = readJson(stateFile, {});
const todo = pairList.filter((p) => !state[`${p.a}-${p.b}`]?.verdict);
let done = 0;
try {
  await pool(todo, cfg.concurrency, async (p) => {
    const k = `${p.a}-${p.b}`;
    try {
      const { data, model } = await claudeJson({ system: MERGE_SYSTEM, user: mergeUserPrompt(byId.get(p.a), byId.get(p.b)), schema: mergeSchema, stage: "merge" });
      const v = MergeVerdict.parse(data);
      if (v.verdict === "parent_child" && ![String(p.a), String(p.b)].includes(v.parent_id)) v.parent_id = null;
      state[k] = { ...v, model };
    } catch (e) {
      if (e instanceof BudgetError) throw e;
      state[k] = { error: e.message };
    }
    writeJson(stateFile, state);
    process.stdout.write(`  판정 ${++done}/${todo.length}\r`);
  });
} catch (e) {
  if (!(e instanceof BudgetError)) throw e;
  console.error(`\n${e.message}`);
  process.exitCode = 2;
}

// ---------- 3. 병합 그룹 (same 쌍을 묶고 대표 선정, 검수 대상 표시) ----------
const groupRows = buildMergeGroups(concepts, pairList, (p) => state[`${p.a}-${p.b}`]);

writeCsv(out("merge_pairs.csv"), pairHeader, pairList.map((p) => pairRow(p, state[`${p.a}-${p.b}`])));
writeCsv(
  out("merge_groups.csv"),
  ["group_id", "representative_id", "merged_ids", "titles", "grades", "concept_types", "rationale", "needs_review", "review_reasons", "approved"],
  groupRows
);
writeCsv(
  out("parent_child_candidates.csv"),
  ["a", "a_title", "b", "b_title", "parent_id", "rationale"],
  pairList.filter((p) => state[`${p.a}-${p.b}`]?.verdict === "parent_child").map((p) => ({
    a: p.a, a_title: byId.get(p.a).title, b: p.b, b_title: byId.get(p.b).title, ...state[`${p.a}-${p.b}`],
  }))
);

const verdicts = pairList.map((p) => state[`${p.a}-${p.b}`]?.verdict ?? (state[`${p.a}-${p.b}`]?.error ? "error" : "pending"));
const cnt = (v) => verdicts.filter((x) => x === v).length;
console.log(
  `\n쌍 ${pairList.length}: same ${cnt("same")}, parent_child ${cnt("parent_child")}, different ${cnt("different")}, 오류 ${cnt("error")}, 미판정 ${cnt("pending")}\n` +
    `병합 그룹 ${groupRows.length}개 (병합되어 사라지는 개념 ${groupRows.reduce((s, g) => s + g.merged_ids.length, 0)}개), 사용자 검수 대상 ${groupRows.filter((g) => g.needs_review).length}개\n` +
    `→ ${out("merge_groups.csv")}, merge_pairs.csv, parent_child_candidates.csv`
);
