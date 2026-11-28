import { postJson, errorText } from "../../server/selectors/common.ts";
import { DEFAULT_CONFIG } from "../config.ts";
import { withRetry } from "../retry.ts";
import { ZERO_USAGE } from "../types.ts";
import { fail } from "./common.ts";
import type { AdapterOpts, ModelAdapter, ModelRequest, ModelResult } from "./types.ts";

// JEV (TypeSafe System One choice API). docs/jev-api.md
type ChoiceAnswer = { choice: string; confidence?: number; probabilities?: Record<string, number> };
export const jevUrl = () => process.env.JEV_API_URL || "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";

export function createJevAdapter(opts: AdapterOpts & { unitMinProb?: number; secondaryMinProb?: number } = {}): ModelAdapter {
  const unitMin = opts.unitMinProb ?? DEFAULT_CONFIG.jev_unit_min_prob;
  const secMin = opts.secondaryMinProb ?? DEFAULT_CONFIG.jev_secondary_min_prob;
  return {
    name: "jev",
    model: MODEL,
    async call(req: ModelRequest): Promise<ModelResult> {
      const t0 = Date.now();
      const key = opts.apiKey ?? (process.env.JEV_API_KEY || process.env.JEV_KEY);
      if (!key) return fail(MODEL, "not_configured", t0);
      const criteria = Object.fromEntries(req.options.map((o) => [o.id, o.text]));
      try {
        const raw = (await withRetry(
          () =>
            postJson(jevUrl(), { Authorization: `Bearer ${key}` }, {
              model: MODEL,
              state: `${req.system}\n\n${req.problemBlock}`,
              questions: { q: { type: "choice", instructions: req.instruction, criteria } },
            }),
          { sleep: opts.sleep }
        )) as { model?: string; answers: { q: ChoiceAnswer } };
        const a = raw.answers.q;
        const ids = new Set(req.options.map((o) => o.id));
        const probs = a.probabilities ?? { [a.choice]: a.confidence ?? 1 };
        const ranked = Object.entries(probs).filter(([id]) => ids.has(id)).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
        if (!ids.has(a.choice) || !ranked.length) return fail(MODEL, "out_of_candidates", t0, raw);
        const top = ranked[0];
        const base = { ok: true, raw, usage: ZERO_USAGE, latencyMs: Date.now() - t0, model: MODEL, modelVersion: raw.model };
        if (req.stage === "unit" || req.stage === "grok_unit") {
          const unitIds = ranked.filter(([, p]) => p >= unitMin).map(([id]) => id);
          return { ...base, answer: { kind: "unit", unitIds: unitIds.length ? unitIds : [top[0]], probs: Object.fromEntries(ranked), confidence: top[1], evidenceSteps: [] } };
        }
        const secondary = ranked.slice(1).filter(([, p]) => p >= secMin).slice(0, req.maxSecondary).map(([id]) => id);
        return { ...base, answer: { kind: "concept", primary: top[0], secondary, probs: Object.fromEntries(ranked), confidence: top[1], evidenceSteps: [] } };
      } catch (e) {
        return fail(MODEL, errorText(e), t0);
      }
    },
  };
}
