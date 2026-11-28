import Anthropic from "@anthropic-ai/sdk";
import { errorText } from "../../server/selectors/common.ts";
import type { Usage } from "../types.ts";
import { callWithRepair, fail, outputSchema, parseAnswer } from "./common.ts";
import type { AdapterOpts, ModelAdapter, ModelRequest, ModelResult } from "./types.ts";

// Claude: beta messages + json_schema(후보 enum) + effort low. temperature 는 보내지 않는다(현재 모델이 400).
// 캐시: system(고정) → options 블록 끝에 cache_control → 문제 가변부.
export const claudeModel = () => process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
export const MAX_TOKENS = 2000;

// 주입 가능한 최소 SDK 모양
export type ClaudeClient = { beta: { messages: { create(params: Record<string, unknown>): Promise<ClaudeMessage> } } };
export type ClaudeMessage = {
  stop_reason?: string | null;
  stop_details?: { category?: string } | null;
  model?: string;
  content: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
};

export function buildClaudeParams(req: ModelRequest, model: string): Record<string, unknown> {
  const hasOptions = !!req.optionsBlock;
  const cc = { cache_control: { type: "ephemeral" } };
  return {
    model,
    max_tokens: MAX_TOKENS,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: outputSchema(req, false) } },
    system: [{ type: "text", text: req.system, ...(hasOptions ? {} : cc) }],
    messages: [
      {
        role: "user",
        content: hasOptions
          ? [{ type: "text", text: req.optionsBlock, ...cc }, { type: "text", text: req.problemBlock }]
          : [{ type: "text", text: req.problemBlock }],
      },
    ],
  };
}

export function claudeUsage(u: ClaudeMessage["usage"]): Usage {
  const read = u?.cache_read_input_tokens ?? 0;
  const write = u?.cache_creation_input_tokens ?? 0;
  return { inputTokens: (u?.input_tokens ?? 0) + read + write, outputTokens: u?.output_tokens ?? 0, cachedInputTokens: read, cacheWriteTokens: write, costUsd: null };
}

export function parseClaude(raw: ClaudeMessage, req: ModelRequest, model: string, t0: number): ModelResult {
  const usage = claudeUsage(raw.usage);
  if (raw.stop_reason === "refusal") return fail(model, `refusal:${raw.stop_details?.category ?? ""}`, t0, raw, usage);
  const text = raw.content.flatMap((b) => (b.type === "text" ? [b.text ?? ""] : [])).join("");
  const p = parseAnswer(text, req);
  if ("error" in p) return fail(model, p.error, t0, raw, usage);
  return { ok: true, answer: p.answer, raw, usage, latencyMs: Date.now() - t0, model, modelVersion: raw.model };
}

let shared: ClaudeClient | null = null;

export function createClaudeAdapter(opts: AdapterOpts & { client?: ClaudeClient } = {}): ModelAdapter {
  const model = opts.model ?? claudeModel();
  return {
    name: "claude",
    model,
    async call(req: ModelRequest): Promise<ModelResult> {
      const t0 = Date.now();
      let client = opts.client ?? shared;
      if (!client) {
        const key = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
        if (!key) return fail(model, "not_configured", t0);
        client = shared = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 30000 }) as unknown as ClaudeClient;
      }
      try {
        return await callWithRepair(async () => parseClaude(await client.beta.messages.create(buildClaudeParams(req, model)), req, model, t0));
      } catch (e) {
        return fail(model, errorText(e), t0);
      }
    },
  };
}
