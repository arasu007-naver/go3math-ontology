import { NONE, parseUnitAnswer } from "@/lib/l2o/units";
import { errorText, postJson, SYSTEM_PROMPT, userPrompt, withRetry, type SelectorInput, type SelectorOutput, type UnitSelector } from "./common";

// Gemini (Generative Language API): temperature 0, JSON 응답 + responseSchema(후보 enum)
const MODEL = process.env.GEMINI_MODEL || "gemini-4-argon";

type GeminiResponse = { candidates?: { content?: { parts?: { text?: string }[] } }[]; modelVersion?: string };

async function call(i: SelectorInput, key: string): Promise<GeminiResponse> {
  const ids = i.candidates.map((u) => u.unitId);
  return (await withRetry(() =>
    postJson(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, { "x-goog-api-key": key }, {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userPrompt(i) }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            unit_id: { type: "STRING", enum: [...ids, NONE] },
            confidence: { type: "NUMBER" },
            reason: { type: "STRING" },
          },
          required: ["unit_id", "confidence", "reason"],
        },
      },
    })
  )) as GeminiResponse;
}

export const geminiSelector: UnitSelector = {
  name: "gemini",
  model: MODEL,
  async select(i: SelectorInput): Promise<SelectorOutput> {
    const t0 = Date.now();
    const key = process.env.GEMINI_API_KEY;
    if (!key) return { selectedUnitId: null, confidence: null, raw: null, model: MODEL, latencyMs: 0, error: "not_configured" };
    const ids = i.candidates.map((u) => u.unitId);
    try {
      let raw = await call(i, key);
      for (let attempt = 0; ; attempt++) {
        const text = raw.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        const p = parseUnitAnswer(text, ids);
        if (p.error === "invalid_json" && attempt === 0) {
          raw = await call(i, key);
          continue;
        }
        return { selectedUnitId: p.unitId, confidence: p.confidence, raw, model: MODEL, modelVersion: raw.modelVersion, latencyMs: Date.now() - t0, error: p.error };
      }
    } catch (e) {
      return { selectedUnitId: null, confidence: null, raw: null, model: MODEL, latencyMs: Date.now() - t0, error: errorText(e) };
    }
  },
};
