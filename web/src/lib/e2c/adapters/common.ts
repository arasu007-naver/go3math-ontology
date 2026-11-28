import { ZERO_USAGE, type Usage } from "../types.ts";
import type { Answer, ModelRequest, ModelResult } from "./types.ts";

const STEP = /^S\d+$/;

// 출력 JSON 스키마. limits=false 이면 길이·개수 제한을 빼 구조화 출력이 받는 부분집합만 쓴다(코드가 따로 검증).
export function outputSchema(req: ModelRequest, limits: boolean): Record<string, unknown> {
  const ids = req.options.map((o) => o.id);
  const isUnit = req.stage === "unit" || req.stage === "grok_unit";
  const evidence = { type: "array", items: { type: "string" }, ...(limits ? { maxItems: 5 } : {}) };
  const reason = { type: "string", ...(limits ? { maxLength: isUnit ? 300 : 500 } : {}) };
  const props = isUnit
    ? {
        used_units: { type: "array", items: { type: "string", enum: ids }, ...(limits ? { minItems: 1, maxItems: 3 } : {}) },
        confidence: { type: "number" },
        evidence_steps: evidence,
        reason,
      }
    : {
        primary: { type: "string", enum: ids },
        secondary: { type: "array", items: { type: "string", enum: ids }, ...(limits ? { maxItems: 3 } : {}) },
        confidence: { type: "number" },
        evidence_steps: evidence,
        reason,
      };
  return { type: "object", properties: props, required: Object.keys(props), additionalProperties: false };
}

// Gemini responseSchema: 타입을 대문자로, additionalProperties 제거
export function toGeminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (s && typeof s === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) {
      if (k === "additionalProperties") continue;
      o[k] = k === "type" && typeof v === "string" ? v.toUpperCase() : toGeminiSchema(v);
    }
    return o;
  }
  return s;
}

export type Parsed = { answer: Answer } | { error: "invalid_json" | "schema" | "out_of_candidates" };

export function parseAnswer(text: string, req: ModelRequest): Parsed {
  let j: unknown;
  try {
    j = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { error: "invalid_json" };
  }
  if (!j || typeof j !== "object") return { error: "invalid_json" };
  const o = j as Record<string, unknown>;
  const allowed = new Set(req.options.map((x) => x.id));
  const conf = typeof o.confidence === "number" && Number.isFinite(o.confidence) ? Math.min(1, Math.max(0, o.confidence)) : null;
  const evidenceSteps = Array.isArray(o.evidence_steps) ? o.evidence_steps.filter((x): x is string => typeof x === "string" && STEP.test(x)) : [];
  const reason = typeof o.reason === "string" ? o.reason : undefined;
  const idList = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null);
  if (req.stage === "unit" || req.stage === "grok_unit") {
    const ids = idList(o.used_units);
    if (!ids || !ids.length) return { error: "schema" };
    if (ids.some((x) => !allowed.has(x)) || new Set(ids).size !== ids.length) return { error: "out_of_candidates" };
    return { answer: { kind: "unit", unitIds: ids, confidence: conf, evidenceSteps, reason } };
  }
  const secondary = idList(o.secondary) ?? [];
  if (typeof o.primary !== "string" || !o.primary) return { error: "schema" };
  if (secondary.length > req.maxSecondary) return { error: "schema" };
  const all = [o.primary, ...secondary];
  if (all.some((x) => !allowed.has(x)) || new Set(all).size !== all.length) return { error: "out_of_candidates" };
  return { answer: { kind: "concept", primary: o.primary, secondary, confidence: conf, evidenceSteps, reason } };
}

export const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  costUsd: a.costUsd == null && b.costUsd == null ? null : (a.costUsd ?? 0) + (b.costUsd ?? 0),
});

export const fail = (model: string, error: string, t0: number, raw: unknown = null, usage: Usage = ZERO_USAGE): ModelResult => ({
  ok: false, error, raw, usage, latencyMs: Date.now() - t0, model,
});

// 한 번 호출하고, 스키마 위반·범위 밖 id 면 1회만 다시 요청한다.
export async function callWithRepair(once: () => Promise<ModelResult>): Promise<ModelResult> {
  const first = await once();
  if (first.ok || !["invalid_json", "schema", "out_of_candidates"].includes(first.error ?? "")) return first;
  const second = await once();
  return { ...second, usage: addUsage(first.usage, second.usage), latencyMs: first.latencyMs + second.latencyMs };
}
