import { errorText, postJson, withRetry, type SelectorInput, type SelectorOutput, type UnitSelector } from "./common";

// JEV (TypeSafe System One): 후보를 choice criteria 로, 개념 텍스트를 state 로 → 확률 분포. argmax=선택, max prob=confidence.
const JEV_URL = process.env.JEV_API_URL || "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";

type ChoiceAnswer = { choice: string; confidence: number; probabilities?: Record<string, number> };

export const jevSelector: UnitSelector = {
  name: "jev",
  model: MODEL,
  async select(i: SelectorInput): Promise<SelectorOutput> {
    const t0 = Date.now();
    const key = process.env.JEV_API_KEY || process.env.JEV_KEY;
    if (!key) return { selectedUnitId: null, confidence: null, raw: null, model: MODEL, latencyMs: 0, error: "not_configured" };
    const c = i.concept;
    const state = `Korean school math concept (math is AsciiMath in backticks)\ntitle: ${c.title}\nstatement: ${c.statement}`;
    const criteria = Object.fromEntries(i.candidates.map((u) => [u.unitId, `${u.path}${u.description ? ` — ${u.description}` : ""}`]));
    try {
      const raw = (await withRetry(() =>
        postJson(JEV_URL, { Authorization: `Bearer ${key}` }, {
          model: MODEL,
          state,
          questions: {
            unit: { type: "choice", instructions: "Which unit of the Korean 2022 math curriculum does this concept belong to?", criteria },
          },
        })
      )) as { model?: string; answers: { unit: ChoiceAnswer } };
      const a = raw.answers.unit;
      const ids = i.candidates.map((u) => u.unitId);
      const inCands = ids.includes(a.choice);
      return {
        selectedUnitId: inCands ? a.choice : null,
        confidence: a.probabilities?.[a.choice] ?? a.confidence ?? null,
        scores: a.probabilities,
        raw,
        model: MODEL,
        modelVersion: raw.model,
        latencyMs: Date.now() - t0,
        error: inCands ? undefined : "out_of_candidates",
      };
    } catch (e) {
      return { selectedUnitId: null, confidence: null, raw: null, model: MODEL, latencyMs: Date.now() - t0, error: errorText(e) };
    }
  },
};
