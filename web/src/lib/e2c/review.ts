import type { E2cConfig } from "./config.ts";
import type { ReasonCode, ResultStatus } from "./types.ts";

export const REVIEW_REASONS: ReasonCode[] = [
  "unit_grok", "concept_grok", "two_models_only", "insufficient_models", "unit_tie", "unit_low_conf", "concept_low_conf", "unit_hint_conflict", "out_of_candidates", "truncated",
];
export const INFO_REASONS: ReasonCode[] = ["majority_2of3", "candidate_fallback"];

export type ReviewInput = {
  unitSource: "majority" | "grok" | null;
  conceptSource: "majority" | "grok" | null;
  unitFlags: string[]; // tally flags
  conceptFlags: string[];
  unitTie: boolean; // 채택 단원을 지지한 모델의 표가 선후 미연결 동률(curriculum_order)로 정해짐
  unitConf: number | null; // 채택 단원 지지 모델 평균 확신도
  conceptConf: number | null;
  hintConflict: boolean;
  outOfCandidates: boolean;
  truncated: boolean;
  candidateFallback: boolean;
};

export function computeReasons(i: ReviewInput, cfg: Pick<E2cConfig, "unit_low_conf" | "concept_low_conf">): { reasons: ReasonCode[]; status: Extract<ResultStatus, "auto" | "needs_review"> } {
  const r = new Set<ReasonCode>();
  if (i.unitSource === "grok") r.add("unit_grok");
  if (i.conceptSource === "grok") r.add("concept_grok");
  for (const f of [...i.unitFlags, ...i.conceptFlags]) r.add(f as ReasonCode);
  if (i.unitTie) r.add("unit_tie");
  if (i.unitConf != null && i.unitConf < cfg.unit_low_conf) r.add("unit_low_conf");
  if (i.conceptConf != null && i.conceptConf < cfg.concept_low_conf) r.add("concept_low_conf");
  if (i.hintConflict) r.add("unit_hint_conflict");
  if (i.outOfCandidates) r.add("out_of_candidates");
  if (i.truncated) r.add("truncated");
  if (i.candidateFallback) r.add("candidate_fallback");
  const reasons = [...r];
  return { reasons, status: reasons.some((x) => REVIEW_REASONS.includes(x)) ? "needs_review" : "auto" };
}
