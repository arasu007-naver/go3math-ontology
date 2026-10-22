// 단계 2(Claude) · 단계 3(Gemini 교차검증) · 단계 4(확정 규칙) · 단계 5(선수 개념, 선택)
//   node 03-judge.mjs --sample 30        파일럿: 대표 개념 30개 (균등 표본)
//   node 03-judge.mjs                    전량
//   node 03-judge.mjs --ids 12,345       특정 항목만
//   --no-prereq                          선수 개념 후보를 주지 않는다
// 체크포인트 out/judge_state.json — 중단 후 다시 실행하면 끝난 판정은 건너뛰고 오류 건만 다시 한다.
// 출력: out/mapping_results.jsonl, out/review_queue.csv, out/cost_report.md
import fs from "node:fs";
import { cfg, out } from "./lib/config.mjs";
import { claudeJson, geminiJson, ledger, BudgetError } from "./lib/llm.mjs";
import { judgePrompt, judgmentSchema, validateJudgment } from "./lib/prompts.mjs";
import { decide, reviewRow, evenSample, REVIEW_HEADER } from "./lib/review.mjs";
import { parseArgs, pool, readCsv, readJson, readJsonl, sha, splitList, writeCsv, writeJson, writeJsonl, writeText } from "./lib/util.mjs";

const args = parseArgs();
if (!fs.existsSync(out("candidates.jsonl"))) throw new Error("out/candidates.jsonl 이 없습니다. 02-candidates.mjs 를 먼저 실행하세요.");

const reps = new Map(readJsonl(out("concepts_merged.jsonl")).map((c) => [String(c.id), c]));
const units = readJson(out("units.json"));
const unitsById = new Map(units.map((u) => [u.id, u]));
const allItems = readJsonl(out("candidates.jsonl")).map((row) => {
  const candUnits = row.candidates.map((c) => unitsById.get(c.unit_id));
  const prereqs = args["no-prereq"] ? [] : row.prereq_candidates.map((id) => reps.get(id)).filter(Boolean);
  const item = {
    item_id: row.item_id,
    item_type: row.item_type,
    concept: reps.get(row.item_id),
    candUnits,
    prereqs,
    candidateAchievementCodes: candUnits.flatMap((u) => u.achievements.map((a) => a.code)),
  };
  Object.assign(item, judgePrompt(item, candUnits, prereqs)); // item.system, item.user
  return item;
});

let items = allItems;
if (args.ids) {
  const ids = new Set(splitList(args.ids));
  items = allItems.filter((it) => ids.has(it.item_id));
} else if (args.sample) {
  items = evenSample([...allItems].sort((a, b) => Number(a.item_id) - Number(b.item_id)), Number(args.sample));
}

const stateFile = out("judge_state.json");
const state = readJson(stateFile, {});
const save = () => writeJson(stateFile, state);

async function judgeWith(call, item) {
  const candidateIds = new Set(item.candUnits.map((u) => u.id));
  const prereqIds = new Set(item.prereqs.map((p) => String(p.id)));
  try {
    const { data, model } = await call({ system: item.system, user: item.user, schema: judgmentSchema });
    return { result: validateJudgment(data, item, candidateIds, prereqIds), model };
  } catch (e) {
    if (e instanceof BudgetError) throw e;
    return { error: e.message.slice(0, 500) };
  }
}

const startCost = ledger.load().total;
const todo = items.filter((it) => {
  const st = state[it.item_id];
  return !st || st.input_hash !== sha(it.system + it.user) || st.status === "error" || st.status === "pending";
});
console.log(`대상 ${items.length}건 중 판정할 항목 ${todo.length}건 (누적 비용 $${startCost.toFixed(2)}, 예산 $${cfg.budgetUsd})`);

let done = 0;
try {
  await pool(todo, cfg.concurrency, async (it) => {
    const hash = sha(it.system + it.user);
    let st = state[it.item_id];
    if (!st || st.input_hash !== hash) st = state[it.item_id] = { input_hash: hash };
    // 두 모델은 서로의 결과를 보지 않는다(독립 판정)
    const [c, g] = await Promise.all([
      st.claude?.result ? st.claude : judgeWith(claudeJson, it),
      st.gemini?.result ? st.gemini : judgeWith(geminiJson, it),
    ]);
    Object.assign(st, { claude: c, gemini: g, judged_at: new Date().toISOString() });
    st.status = decide(st, cfg.confThreshold);
    save();
    done++;
    // 예산 초과 예상 시 중단 (이번 실행 평균 비용 × 남은 건수)
    const spent = ledger.load().total - startCost;
    const projected = ledger.data.total + (spent / done) * (todo.length - done);
    if (done >= 10 && projected > cfg.budgetUsd) {
      throw new BudgetError(`예상 총비용 $${projected.toFixed(2)} 가 예산 $${cfg.budgetUsd} 를 넘어 중단합니다 (${done}/${todo.length} 처리)`);
    }
    process.stdout.write(`  판정 ${done}/${todo.length} ($${ledger.data.total.toFixed(2)})\r`);
  });
} catch (e) {
  if (!(e instanceof BudgetError)) throw e;
  console.error(`\n${e.message}`);
  process.exitCode = 2;
}

// ---------- 결과 파일 (지금까지 판정한 전체 항목 기준) ----------
const judged = allItems.filter((it) => state[it.item_id]);
const results = judged.map((it) => {
  const st = state[it.item_id];
  return {
    item_id: it.item_id,
    item_type: it.item_type,
    status: st.status,
    candidates: it.candUnits.map((u) => u.id),
    claude: st.claude,
    gemini: st.gemini,
    judged_at: st.judged_at,
  };
});
writeJsonl(out("mapping_results.jsonl"), results);

const prev = new Map(readCsv(out("review_queue.csv")).map((r) => [r.item_id, r]));
writeCsv(out("review_queue.csv"), REVIEW_HEADER, judged.map((it) => reviewRow(it, it.concept, state[it.item_id], unitsById, prev.get(it.item_id))));

// ---------- 요약 · 비용 보고 ----------
const count = (s) => results.filter((r) => r.status === s).length;
const both = results.filter((r) => r.claude?.result && r.gemini?.result);
const agree = both.filter((r) => r.claude.result.primary_unit_id === r.gemini.result.primary_unit_id).length;
const agreeRate = both.length ? ((100 * agree) / both.length).toFixed(1) : "-";
const d = ledger.load();
const perItem = results.length ? (d.stages.judge ?? 0) / results.length : 0; // 판정 단계 비용만 (병합·임베딩 제외)
const report = [
  `# 비용·진행 보고`,
  ``,
  `생성: ${new Date().toISOString()}`,
  ``,
  `| 항목 | 값 |`, `|---|---|`,
  `| 판정한 대표 개념 | ${results.length} / ${allItems.length} |`,
  `| 자동 확정(confirmed) | ${count("confirmed")} |`,
  `| 검수 대기(review) | ${count("review")} |`,
  `| 오류(error) | ${count("error")} |`,
  `| 모델 간 primary 일치율 | ${agreeRate}% (${agree}/${both.length}) |`,
  `| 누적 비용 | $${d.total.toFixed(4)} |`,
  `| 판정 1건당 평균 (판정 단계만) | $${perItem.toFixed(4)} |`,
  `| 전량 예상 총비용 (지금까지 + 남은 판정) | $${(d.total + perItem * (allItems.length - results.length)).toFixed(2)} |`,
  `| 단계별 비용 | ${Object.entries(d.stages).map(([k, v]) => `${k} $${v.toFixed(4)}`).join(", ")} |`,
  ``,
  `## 모델별`,
  ``,
  `| 모델 | 호출 | 입력 | 출력(thinking 포함) | 캐시 읽기 | 캐시 쓰기 | 비용 |`, `|---|---|---|---|---|---|---|`,
  ...Object.entries(d.models).map(([mname, x]) => `| ${mname} | ${x.calls} | ${x.input} | ${x.output} | ${x.cacheRead} | ${x.cacheWrite} | $${x.cost.toFixed(4)} |`),
  ``,
];
writeText(out("cost_report.md"), report.join("\n"));
console.log(
  `\n판정 ${results.length}건: confirmed ${count("confirmed")}, review ${count("review")}, error ${count("error")}, 일치율 ${agreeRate}%, 누적 $${d.total.toFixed(2)}\n` +
    `→ ${out("mapping_results.jsonl")}, review_queue.csv, cost_report.md`
);
