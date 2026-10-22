// 입력 파라미터 (스펙 2장). 비밀값은 환경변수로만 받고 로그에 남기지 않는다.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const OUT = process.env.OUT_DIR || path.join(ROOT, "out");
export const out = (name) => path.join(OUT, name);

const bool = (v, d) => (v == null || v === "" ? d : /^(1|true|yes|y)$/i.test(v));
const num = (v, d) => (v == null || v === "" ? d : Number(v));

const conceptTable = process.env.CONCEPT_TABLE || "mathdb.math_concepts";
if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/.test(conceptTable)) throw new Error(`CONCEPT_TABLE 형식이 잘못됐습니다: ${conceptTable}`);

export const cfg = {
  conceptTable,
  topK: num(process.env.TOP_K, 10),
  confThreshold: num(process.env.CONF_THRESHOLD, 0.8),
  dryRun: bool(process.env.DRY_RUN, true),
  budgetUsd: num(process.env.BUDGET_USD, 20),
  concurrency: num(process.env.CONCURRENCY, 4),
  effort: process.env.EFFORT || "medium",
  geminiThinkingBudget: num(process.env.GEMINI_THINKING_BUDGET, 2048),
  claudeFallbacks: bool(process.env.CLAUDE_FALLBACKS, true),
  achievementFile: process.env.ACHIEVEMENT_FILE || "",
  // gemini-2.5-pro 는 신규 사용자에게 닫혀(2026-10) 후속 모델을 쓴다
  models: { judge: "claude-sonnet-5-5", cross: process.env.GEMINI_MODEL || "gemini-3.1-pro-preview", embed: "gemini-embedding-001" },
  // 단계 0 중복 탐지 기준
  merge: { cosine: num(process.env.MERGE_COSINE, 0.92), titleSimilarity: 0.8 },
  prereqCandidates: 15,
};

// USD / 1M tokens (2026-10 기준. 가격이 바뀌면 여기만 고친다)
export const PRICES = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "gemini-2.5-pro": { input: 1.25, output: 10, cacheRead: 0.125 },
  "gemini-3.1-pro-preview": { input: 2, output: 12, cacheRead: 0.2 }, // 200K 토큰 이하 기준, 프리뷰 가격은 바뀔 수 있다
  "gemini-embedding-001": { input: 0.15 },
};

export function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`환경변수가 필요합니다: ${missing.join(", ")} (.env.example 참고)`);
}
