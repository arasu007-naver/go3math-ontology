import { errorText, postJson } from "../../server/selectors/common.ts";
import { withRetry } from "../retry.ts";
import type { Usage } from "../types.ts";
import { callWithRepair, fail, outputSchema, parseAnswer, toGeminiSchema } from "./common.ts";
import type { AdapterOpts, ModelAdapter, ModelRequest, ModelResult } from "./types.ts";

// Gemini: generateContent, temperature 0, JSON + responseSchema. 접두 순서(system → options → 문제)를 지켜 implicit 캐시를 탄다.
export const geminiModel = () => process.env.GEMINI_MODEL || "gemini-4-argon";
export const geminiBase = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  modelVersion?: string;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
};

export function buildGeminiBody(req: ModelRequest): Record<string, unknown> {
  const parts = [...(req.optionsBlock ? [{ text: req.optionsBlock }] : []), { text: req.problemBlock }];
  return {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: toGeminiSchema(outputSchema(req, true)) },
  };
}

export function geminiUsage(u: GeminiResponse["usageMetadata"]): Usage {
  return {
    inputTokens: u?.promptTokenCount ?? 0,
    outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
    cachedInputTokens: u?.cachedContentTokenCount ?? 0,
    cacheWriteTokens: 0,
    costUsd: null,
  };
}

export function parseGemini(raw: GeminiResponse, req: ModelRequest, model: string, t0: number): ModelResult {
  const usage = geminiUsage(raw.usageMetadata);
  const text = raw.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const p = parseAnswer(text, req);
  if ("error" in p) return fail(model, p.error, t0, raw, usage);
  return { ok: true, answer: p.answer, raw, usage, latencyMs: Date.now() - t0, model, modelVersion: raw.modelVersion };
}

export function createGeminiAdapter(opts: AdapterOpts = {}): ModelAdapter {
  const model = opts.model ?? geminiModel();
  return {
    name: "gemini",
    model,
    async call(req: ModelRequest): Promise<ModelResult> {
      const t0 = Date.now();
      const key = opts.apiKey ?? process.env.GEMINI_API_KEY;
      if (!key) return fail(model, "not_configured", t0);
      try {
        return await callWithRepair(async () => {
          const raw = (await withRetry(() => postJson(`${geminiBase}/models/${model}:generateContent`, { "x-goog-api-key": key }, buildGeminiBody(req)), { sleep: opts.sleep })) as GeminiResponse;
          return parseGemini(raw, req, model, t0);
        });
      } catch (e) {
        return fail(model, errorText(e), t0);
      }
    },
  };
}
