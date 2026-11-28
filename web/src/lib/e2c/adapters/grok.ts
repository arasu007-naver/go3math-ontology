import { errorText, postJson } from "../../server/selectors/common.ts";
import { withRetry } from "../retry.ts";
import type { Usage } from "../types.ts";
import { callWithRepair, fail, outputSchema, parseAnswer } from "./common.ts";
import type { AdapterOpts, ModelAdapter, ModelRequest, ModelResult } from "./types.ts";

// Grok (xAI chat completions). 비용은 usage.cost_in_usd_ticks × 1e-10. 접두 순서는 system → options → 문제.
export const XAI_BASE = "https://api.x.ai/v1";
export const grokModel = () => process.env.GROK_MODEL || "grok-4.7";
export const reasoningEffort = () => process.env.GROK_REASONING_EFFORT || "low";
export const TICKS_TO_USD = 1e-10;

export type GrokResponse = {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
    cost_in_usd_ticks?: number;
  };
};

export function buildGrokBody(req: ModelRequest, model: string): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.optionsBlock ? `${req.optionsBlock}\n\n${req.problemBlock}` : req.problemBlock },
    ],
    response_format: { type: "json_schema", json_schema: { name: "e2c_answer", strict: true, schema: outputSchema(req, true) } },
    reasoning_effort: reasoningEffort(),
  };
}

export function grokUsage(u: GrokResponse["usage"]): Usage {
  return {
    inputTokens: u?.prompt_tokens ?? 0,
    outputTokens: (u?.completion_tokens ?? 0) + (u?.completion_tokens_details?.reasoning_tokens ?? 0),
    cachedInputTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: 0,
    costUsd: u?.cost_in_usd_ticks != null ? u.cost_in_usd_ticks * TICKS_TO_USD : null,
  };
}

export function parseGrok(raw: GrokResponse, req: ModelRequest, model: string, t0: number): ModelResult {
  const usage = grokUsage(raw.usage);
  const p = parseAnswer(raw.choices?.[0]?.message?.content ?? "", req);
  if ("error" in p) return fail(model, p.error, t0, raw, usage);
  return { ok: true, answer: p.answer, raw, usage, latencyMs: Date.now() - t0, model, modelVersion: raw.model };
}

export function createGrokAdapter(opts: AdapterOpts = {}): ModelAdapter {
  const model = opts.model ?? grokModel();
  return {
    name: "grok",
    model,
    async call(req: ModelRequest): Promise<ModelResult> {
      const t0 = Date.now();
      const key = opts.apiKey ?? process.env.XAI_API_KEY;
      if (!key) return fail(model, "not_configured", t0);
      try {
        return await callWithRepair(async () => {
          const raw = (await withRetry(() => postJson(`${XAI_BASE}/chat/completions`, { Authorization: `Bearer ${key}` }, buildGrokBody(req, model), 120000), { sleep: opts.sleep })) as GrokResponse;
          return parseGrok(raw, req, model, t0);
        });
      } catch (e) {
        return fail(model, errorText(e), t0);
      }
    },
  };
}
