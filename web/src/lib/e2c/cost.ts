import { DEFAULT_CONFIG, type Pricing } from "./config.ts";
import type { Usage } from "./types.ts";

// inputTokens 는 캐시 읽기·쓰기를 포함한 전체 입력 토큰이다.
export function computeCost(model: string, u: Usage, pricing: Record<string, Pricing> = DEFAULT_CONFIG.pricing, batch = false): number {
  if (u.costUsd != null) return u.costUsd; // xAI cost_in_usd_ticks 우선
  const p = pricing[model];
  if (!p) return 0;
  const plain = Math.max(0, u.inputTokens - u.cachedInputTokens - u.cacheWriteTokens);
  const usd = (plain * p.input + u.cachedInputTokens * p.cachedInput + u.cacheWriteTokens * p.cacheWrite + u.outputTokens * p.output) / 1e6;
  return batch ? usd * p.batchDiscount : usd;
}

// 캐시·Batch 가 없었다면 냈을 비용과의 차이
export function savedCost(model: string, u: Usage, pricing: Record<string, Pricing> = DEFAULT_CONFIG.pricing, batch = false): number {
  const p = pricing[model];
  if (!p) return 0;
  const full = (u.inputTokens * p.input + u.outputTokens * p.output) / 1e6;
  return Math.max(0, full - computeCost(model, { ...u, costUsd: null }, pricing, batch));
}

export type EstimateInput = {
  problems: number; // 대상 문항 수
  cachedCalls: number; // 이미 캐시된 호출 수(제안 단계 합)
  avgChars: number; // 문항 평균 문자 수(1자 = 1토큰)
  mode: "realtime" | "batch";
  grokRate?: number; // 다수결이 없어 Grok 을 부르는 비율 추정
  pricing?: Record<string, Pricing>;
};
const SYSTEM_TOKENS = 400;
const UNIT_OPTIONS_TOKENS = 700;
const CONCEPT_OPTIONS_TOKENS = 2400;
const OUT_TOKENS = 150;

export function estimateJobCost(i: EstimateInput): number {
  const pricing = i.pricing ?? DEFAULT_CONFIG.pricing;
  const batch = i.mode === "batch";
  const grokRate = i.grokRate ?? 0.15;
  const perCall = (model: string, opts: number) =>
    computeCost(model, { inputTokens: SYSTEM_TOKENS + opts + i.avgChars, outputTokens: OUT_TOKENS, cachedInputTokens: 0, cacheWriteTokens: 0, costUsd: null }, pricing, batch && model !== "jev");
  const per = (opts: number) => perCall("claude", opts) + perCall("gemini", opts) + perCall("grok", opts) * grokRate;
  const full = i.problems * (per(UNIT_OPTIONS_TOKENS) + per(CONCEPT_OPTIONS_TOKENS));
  const calls = i.problems * (3 * 2 + 2 * grokRate);
  const avgCall = calls ? full / calls : 0;
  return Math.max(0, full - i.cachedCalls * avgCall);
}
