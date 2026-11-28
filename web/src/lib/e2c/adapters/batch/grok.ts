import { buildGrokBody, grokModel, parseGrok, XAI_BASE, type GrokResponse } from "../grok.ts";
import { fail } from "../common.ts";
import type { BatchAdapter, BatchItem, BatchOutcome } from "../types.ts";

// xAI Batch API. batch_request_id = problemId:stage:model:promptVersion (docs/e2c-schema.md 참고)
type XaiBatchState = { num_requests?: number; num_pending?: number };
type XaiResult = { batch_request_id: string; response?: { chat_get_completion?: GrokResponse }; error_message?: string };

export function createGrokBatchAdapter(opts: { apiKey?: string; model?: string; fetchFn?: typeof fetch } = {}): BatchAdapter {
  const model = opts.model ?? grokModel();
  const doFetch = () => opts.fetchFn ?? globalThis.fetch;
  async function call<T>(path: string, body?: unknown): Promise<T> {
    const key = opts.apiKey ?? process.env.XAI_API_KEY;
    if (!key) throw new Error("not_configured");
    const res = await doFetch()(`${XAI_BASE}${path}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }
  return {
    name: "grok",
    model,
    async submit(items: BatchItem[]) {
      const b = await call<{ batch_id?: string; id?: string }>("/batches", { name: `e2c-${Date.now()}` });
      const id = b.batch_id ?? b.id;
      if (!id) throw new Error("batch id 없음");
      for (let i = 0; i < items.length; i += 100) {
        await call(`/batches/${id}/requests`, {
          batch_requests: items.slice(i, i + 100).map((it) => ({ batch_request_id: it.id, batch_request: { chat_get_completion: buildGrokBody(it.req, model) } })),
        });
      }
      return id;
    },
    async collect(batchId, items) {
      const b = await call<{ state?: XaiBatchState }>(`/batches/${batchId}`);
      if ((b.state?.num_pending ?? 0) > 0) return { done: false, outcomes: [] };
      const byId = new Map(items.map((it) => [it.id, it]));
      const outcomes: BatchOutcome[] = [];
      let token: string | undefined;
      do {
        const page = await call<{ results?: XaiResult[]; pagination_token?: string | null }>(`/batches/${batchId}/results?page_size=100${token ? `&pagination_token=${token}` : ""}`);
        for (const r of page.results ?? []) {
          const it = byId.get(r.batch_request_id);
          if (!it) continue;
          const c = r.response?.chat_get_completion;
          if (c) outcomes.push({ id: it.id, result: parseGrok(c, it.req, model, Date.now()) });
          else outcomes.push({ id: it.id, failed: r.error_message ?? "failed", result: fail(model, r.error_message ?? "failed", Date.now()) });
        }
        token = page.pagination_token ?? undefined;
      } while (token);
      return { done: true, outcomes };
    },
  };
}
