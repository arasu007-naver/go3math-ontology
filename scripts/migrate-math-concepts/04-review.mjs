// 검수 결과 반영 (스펙 5장)
//   node 04-review.mjs --approve-confirmed   자동 확정(confirmed) 건 중 approved 가 빈 행을 Y 로 일괄 승인
//   node 04-review.mjs                       review_queue.csv 를 검사해 approved=Y 행을 out/approved.jsonl 로 만든다
// 검수자가 채우는 열:
//   final_primary_unit_id   단원 id (2022 개정 범위 밖이라 단원 없이 개념만 기록하려면 NONE)
//   final_secondary_unit_ids / final_achievement_codes / final_prerequisite_ids   공백 구분 목록
//   replace_existing        Y 면 KG 의 기존 primary 단원 엣지와 다를 때 이력 보존 교체를 승인
//   approved                Y 승인 / N 거부 / 빈칸 미검수
import { cfg, out } from "./lib/config.mjs";
import { REVIEW_HEADER } from "./lib/review.mjs";
import { parseArgs, readCsv, readJson, readJsonl, splitList, writeCsv, writeJsonl } from "./lib/util.mjs";

const args = parseArgs();
const rows = readCsv(out("review_queue.csv"));
if (!rows.length) throw new Error("out/review_queue.csv 가 없거나 비었습니다. 03-judge.mjs 를 먼저 실행하세요.");

if (args["approve-confirmed"]) {
  let n = 0;
  for (const r of rows) if (r.status === "confirmed" && !r.approved.trim()) { r.approved = "Y"; n++; }
  writeCsv(out("review_queue.csv"), REVIEW_HEADER, rows);
  console.log(`자동 확정 ${n}건을 일괄 승인했습니다 (review_queue.csv). 이어서 인자 없이 다시 실행하세요.`);
  process.exit(0);
}

const units = new Set(readJson(out("units.json")).map((u) => u.id));
const reps = new Set(readJsonl(out("concepts_merged.jsonl")).map((c) => String(c.id)));
const results = new Map(readJsonl(out("mapping_results.jsonl")).map((r) => [r.item_id, r]));

const approved = [], problems = [];
let rejected = 0, pending = 0;
for (const r of rows) {
  const flag = r.approved.trim().toUpperCase();
  if (flag === "N") { rejected++; continue; }
  if (flag !== "Y") { pending++; continue; }
  const errs = [];
  const primaryRaw = r.final_primary_unit_id.trim();
  const primary = primaryRaw.toUpperCase() === "NONE" ? null : primaryRaw;
  if (!primaryRaw) errs.push("final_primary_unit_id 비어 있음");
  else if (primary && !units.has(primary)) errs.push(`없는 단원 ${primary}`);
  const secondary = splitList(r.final_secondary_unit_ids).filter((id) => id !== primary);
  for (const id of secondary) if (!units.has(id)) errs.push(`없는 보조 단원 ${id}`);
  const prereqs = splitList(r.final_prerequisite_ids);
  for (const id of prereqs) if (!reps.has(id) || id === r.item_id) errs.push(`잘못된 선수 개념 ${id}`);
  if (errs.length) { problems.push(`${r.item_id}: ${errs.join(", ")}`); continue; }

  // 판정 출처: 최종 단원이 모델 결과와 같으면 그 모델, 아니면 검수자
  const res = results.get(r.item_id);
  const c = res?.claude?.result, g = res?.gemini?.result;
  let source;
  if (c && g && c.primary_unit_id === primary && g.primary_unit_id === primary) {
    source = { judged_by: `${res.claude.model}+${res.gemini.model}`, confidence: Math.min(c.confidence, g.confidence), rationale: c.rationale };
  } else if (c?.primary_unit_id === primary) {
    source = { judged_by: `${res.claude.model}+human`, confidence: c.confidence, rationale: c.rationale };
  } else if (g?.primary_unit_id === primary) {
    source = { judged_by: `${res.gemini.model}+human`, confidence: g.confidence, rationale: g.rationale };
  } else {
    source = { judged_by: "human", confidence: 1, rationale: r.reviewer_note || "검수자 지정" };
  }

  approved.push({
    item_id: r.item_id,
    item_type: r.item_type,
    primary_unit_id: primary,
    secondary_unit_ids: secondary,
    achievement_codes: splitList(r.final_achievement_codes),
    prerequisite_ids: prereqs,
    replace_existing: r.replace_existing.trim().toUpperCase() === "Y",
    ...source,
  });
}

writeJsonl(out("approved.jsonl"), approved);
console.log(`승인 ${approved.length}건, 거부 ${rejected}건, 미검수 ${pending}건, 오류 ${problems.length}건 → ${out("approved.jsonl")}`);
if (problems.length) {
  console.log("오류 행 (approved.jsonl 에서 제외):\n  " + problems.join("\n  "));
  process.exitCode = 1;
}
if (!cfg.dryRun) console.log("DRY_RUN=false 입니다. 05-write-kg.mjs 를 실행하면 KG 에 기록합니다.");
