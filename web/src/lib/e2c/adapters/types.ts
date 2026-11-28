import type { ModelName, Role, Stage, Usage } from "../types.ts";

export type ModelRequest = {
  stage: Stage;
  role: Role;
  promptVersion: string;
  system: string;
  optionsBlock: string;
  problemBlock: string;
  instruction: string;
  options: { id: string; text: string }[]; // 허용 id (범위)
  maxSecondary: number;
};

export type UnitAnswer = { kind: "unit"; unitIds: string[]; probs?: Record<string, number>; confidence: number | null; evidenceSteps: string[]; reason?: string };
export type ConceptAnswer = {
  kind: "concept";
  primary: string;
  secondary: string[];
  probs?: Record<string, number>;
  confidence: number | null;
  evidenceSteps: string[];
  reason?: string;
};
export type Answer = UnitAnswer | ConceptAnswer;

export type ModelResult = {
  ok: boolean;
  error?: string; // not_configured | out_of_candidates | invalid_json | schema | refusal:* | HTTP …
  answer?: Answer;
  raw: unknown;
  usage: Usage;
  latencyMs: number;
  model: string;
  modelVersion?: string;
};

export interface ModelAdapter {
  name: ModelName;
  model: string;
  call(req: ModelRequest, signal?: AbortSignal): Promise<ModelResult>;
}

export type AdapterOpts = { apiKey?: string; model?: string; sleep?: (ms: number) => Promise<void> };

// Batch: id = problemId:stage:model:promptVersion
export type BatchItem = { id: string; req: ModelRequest };
export type BatchOutcome = { id: string; result?: ModelResult; failed?: string };
export interface BatchAdapter {
  name: ModelName;
  model: string;
  submit(items: BatchItem[]): Promise<string>;
  collect(batchId: string, items: BatchItem[]): Promise<{ done: boolean; outcomes: BatchOutcome[] }>;
}
export const batchItemId = (problemId: number, stage: Stage, model: string, promptVersion: string) => `${problemId}:${stage}:${model}:${promptVersion}`;
