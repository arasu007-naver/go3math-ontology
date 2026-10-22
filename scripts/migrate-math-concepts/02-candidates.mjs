// 병합 적용 + 단계 1 후보 추출 (임베딩)
//   입력: out/merge_groups.csv (approved=Y 그룹만 병합)
//   출력: out/concepts_merged.jsonl (대표 개념), out/units.json (KG 단원 스냅샷), out/candidates.jsonl
// 사용: node --env-file=.env 02-candidates.mjs
import fs from "node:fs";
import { cfg, out } from "./lib/config.mjs";
import { openMaria, loadConcepts, conceptText } from "./lib/source.mjs";
import { openPg, loadUnits, unitText } from "./lib/kg.mjs";
import { applyMergeGroups } from "./lib/merge.mjs";
import { pickCandidates, pickPrereqs } from "./lib/candidates.mjs";
import { embed } from "./lib/llm.mjs";
import { readCsv, writeJson, writeJsonl } from "./lib/util.mjs";

if (!fs.existsSync(out("merge_groups.csv"))) throw new Error("out/merge_groups.csv 가 없습니다. 01-merge.mjs 를 먼저 실행하고 검수하세요.");

const m = await openMaria();
let concepts;
try {
  concepts = (await loadConcepts(m)).filter((c) => c.is_on);
} finally {
  await m.end();
}
const reps = applyMergeGroups(concepts, readCsv(out("merge_groups.csv")));
console.log(`is_on=1 ${concepts.length}개 → 대표 개념 ${reps.length}개 (병합 ${concepts.length - reps.length}개)`);

const pgc = await openPg();
let units;
try {
  units = await loadUnits(pgc);
} finally {
  await pgc.end();
}
if (!units.length) throw new Error("KG 에서 매핑할 단원(대단원·소단원)을 찾지 못했습니다");
console.log(`KG 단원 ${units.length}개 (성취기준 있는 단원 ${units.filter((u) => u.achievements.length).length}개)`);

const unitVecs = await embed(units.map(unitText));
const repVecs = await embed(reps.map(conceptText));

const rows = reps.map((c, i) => ({
  item_id: String(c.id),
  item_type: "concept",
  ...pickCandidates(c, repVecs[i], units, unitVecs, cfg.topK),
  prereq_candidates: pickPrereqs(c, repVecs[i], reps, repVecs, cfg.prereqCandidates).map(String),
}));

writeJsonl(out("concepts_merged.jsonl"), reps);
writeJson(out("units.json"), units);
writeJsonl(out("candidates.jsonl"), rows);
console.log(
  `\n후보 ${rows.length}건 (필터 해제 ${rows.filter((r) => r.filter_relaxed).length}건)\n→ ${out("candidates.jsonl")}, concepts_merged.jsonl, units.json`
);
