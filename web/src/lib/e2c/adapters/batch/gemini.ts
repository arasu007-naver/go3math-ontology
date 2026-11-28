import { errorText } from "../../../server/selectors/common.ts";
import { fail } from "../common.ts";
import { buildGeminiBody, geminiBase, geminiModel, parseGemini, type GeminiResponse } from "../gemini.ts";
import type { BatchAdapter, BatchItem, BatchOutcome } from "../types.ts";

// Gemini Batch API (inline requests). metadata.key 에 id 를 싣는다.
type Inlined = { metadata?: { key?: string }; response?: GeminiResponse; error?: unknown };
type Operation = { name?: string; done?: boolean; error?: unknown; response?: { inlinedResponses?: { inlinedResponses?: Inlined[] } | Inlined[] } };

async function call(url: string, key: string, body?: unknown): Promise<Operation> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Operation;
}

export function createGeminiBatchAdapter(opts: { apiKey?: string; model?: string } = {}): BatchAdapter {
  const model = opts.model ?? geminiModel();
  const key = () => {
    const k = opts.apiKey ?? process.env.GEMINI_API_KEY;
    if (!k) throw new Error("not_configured");
    return k;
  };
  return {
    name: "gemini",
    model,
    async submit(items: BatchItem[]) {
      const requests = items.map((it) => ({ request: buildGeminiBody(it.req), metadata: { key: it.id } }));
      const op = await call(`${geminiBase}/models/${model}:batchGenerateContent`, key(), {
        batch: { display_name: `e2c-${Date.now()}`, input_config: { requests: { requests } } },
      });
      if (!op.name) throw new Error("batch name 없음");
      return op.name;
    },
    async collect(batchId, items) {
      let op: Operation;
      try {
        op = await call(`${geminiBase}/${batchId}`, key());
      } catch (e) {
        return { done: true, outcomes: items.map((it) => ({ id: it.id, failed: errorText(e) })) };
      }
      if (!op.done) return { done: false, outcomes: [] };
      const inl = op.response?.inlinedResponses;
      const list = (Array.isArray(inl) ? inl : inl?.inlinedResponses) ?? [];
      const byId = new Map(items.map((it) => [it.id, it]));
      const outcomes: BatchOutcome[] = [];
      for (const r of list) {
        const it = r.metadata?.key ? byId.get(r.metadata.key) : undefined;
        if (!it) continue;
        if (r.response) outcomes.push({ id: it.id, result: parseGemini(r.response, it.req, model, Date.now()) });
        else outcomes.push({ id: it.id, failed: "failed", result: fail(model, "failed", Date.now()) });
      }
      return { done: true, outcomes };
    },
  };
}
