// e2c 공용 타입
export type ModelName = "jev" | "claude" | "gemini" | "grok";
export const PROPOSERS: ModelName[] = ["jev", "claude", "gemini"];
export type Stage = "unit" | "concept" | "grok_unit" | "grok_concept";
export type Role = "proposer" | "judge" | "shadow_judge";
export type DecisionSource = "majority" | "grok" | "manual";

export type ReasonCode =
  | "unit_grok" | "concept_grok" | "two_models_only" | "insufficient_models" | "unit_tie" | "unit_low_conf"
  | "concept_low_conf" | "unit_hint_conflict" | "out_of_candidates" | "truncated"
  | "majority_2of3" | "candidate_fallback";

export type ResultStatus = "auto" | "needs_review" | "error" | "skipped_no_text" | "overridden" | "confirmed" | "applied";
export const LOCKED_STATUSES: ResultStatus[] = ["overridden", "confirmed", "applied"];

export type ProblemMeta = { year: number | null; month: number | null; exam: string | null; subject: string | null; number: number | null; points: number | null };
export type KeyStep = { id: string; text: string };

export type ProblemInput = {
  id: number;
  meta: ProblemMeta;
  problemText: string;
  solutionText: string;
  keySteps: KeyStep[]; // 잘렸으면 id="" 인 중략 표시가 끼어 있다
  truncated: boolean;
  skipped: boolean; // skipped_no_text
  inputHash: string;
  legacyConceptHints: string[];
  droppedHints: number;
};

export type UnitOption = { unitId: string; subjectId: string; subjectName: string; name: string; order: number; text: string };
export type ConceptOption = { conceptId: string; unitId: string; text: string };

export type UnitProposal = {
  model: ModelName;
  ok: boolean;
  error?: string;
  unitIds: string[]; // 관련 단원 집합
  probs?: Record<string, number>;
  confidence: number | null;
  evidenceSteps: string[];
  picked?: string | null; // pickFinalUnit 결과
  rule?: "precedence" | "curriculum_order";
};
export type ConceptProposal = {
  model: ModelName;
  ok: boolean;
  error?: string;
  primary: string | null;
  secondary: string[];
  probs?: Record<string, number>;
  confidence: number | null;
  evidenceSteps: string[];
};

export type Usage = { inputTokens: number; outputTokens: number; cachedInputTokens: number; cacheWriteTokens: number; costUsd: number | null };
export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, costUsd: null };
