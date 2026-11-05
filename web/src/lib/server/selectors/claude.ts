import Anthropic from "@anthropic-ai/sdk";
import { NONE, parseUnitAnswer } from "@/lib/l2o/units";
import { errorText, SYSTEM_PROMPT, TIMEOUT_MS, userPrompt, type SelectorInput, type SelectorOutput, type UnitSelector } from "./common";

// Claude (Anthropic Messages API). Sonnet 5.5 는 temperature 를 받지 않아(400) 빼고, effort low + structured output(후보 enum)으로 고정한다.
// 거절(refusal) 대비 server-side fallback("default") 을 켠다. 재시도(429/5xx/timeout)는 SDK 가 Retry-After 를 지키며 한다.
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
let client: Anthropic | null = null;

async function call(i: SelectorInput) {
  client ??= new Anthropic({ maxRetries: 3, timeout: TIMEOUT_MS });
  const ids = i.candidates.map((u) => u.unitId);
  return client.beta.messages.create({
    model: MODEL,
    max_tokens: 2000, // 적응형 thinking + 짧은 JSON
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            unit_id: { type: "string", enum: [...ids, NONE] },
            confidence: { type: "number" },
            reason: { type: "string" },
          },
          required: ["unit_id", "confidence", "reason"],
          additionalProperties: false,
        },
      },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt(i) }],
  });
}

export const claudeSelector: UnitSelector = {
  name: "claude",
  model: MODEL,
  async select(i: SelectorInput): Promise<SelectorOutput> {
    const t0 = Date.now();
    const ids = i.candidates.map((u) => u.unitId);
    try {
      let raw = await call(i);
      for (let attempt = 0; ; attempt++) {
        if (raw.stop_reason === "refusal") {
          return { selectedUnitId: null, confidence: null, raw, model: MODEL, modelVersion: raw.model, latencyMs: Date.now() - t0, error: `refusal:${raw.stop_details?.category ?? ""}` };
        }
        const text = raw.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        const p = parseUnitAnswer(text, ids);
        if (p.error === "invalid_json" && attempt === 0) {
          raw = await call(i); // 깨진 JSON 은 한 번 다시 요청
          continue;
        }
        return { selectedUnitId: p.unitId, confidence: p.confidence, raw, model: MODEL, modelVersion: raw.model, latencyMs: Date.now() - t0, error: p.error };
      }
    } catch (e) {
      return { selectedUnitId: null, confidence: null, raw: null, model: MODEL, latencyMs: Date.now() - t0, error: errorText(e) };
    }
  },
};
