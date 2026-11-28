import { buildClaudeParams, claudeModel, parseClaude, type ClaudeMessage } from "../claude.ts";
import { fail } from "../common.ts";
import type { BatchAdapter, BatchItem, BatchOutcome } from "../types.ts";

// Anthropic Message Batches. custom_id 는 [A-Za-z0-9_-]{1,64} 만 허용해 ':' 등을 '_' 로 바꾸고, 결과는 items 의 id 로 되돌린다.
export type ClaudeBatchClient = {
  beta: {
    messages: {
      batches: {
        create(p: { requests: { custom_id: string; params: Record<string, unknown> }[] }): Promise<{ id: string }>;
        retrieve(id: string): Promise<{ processing_status: string }>;
        results(id: string): Promise<AsyncIterable<{ custom_id: string; result: { type: string; message?: ClaudeMessage } }>>;
      };
    };
  };
};

export const customId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);

export function createClaudeBatchAdapter(client: ClaudeBatchClient, model = claudeModel()): BatchAdapter {
  return {
    name: "claude",
    model,
    async submit(items: BatchItem[]) {
      const requests = items.map((it) => {
        const { betas: _b, fallbacks: _f, ...params } = buildClaudeParams(it.req, model);
        void _b; void _f;
        return { custom_id: customId(it.id), params };
      });
      return (await client.beta.messages.batches.create({ requests })).id;
    },
    async collect(batchId, items) {
      const st = await client.beta.messages.batches.retrieve(batchId);
      if (st.processing_status !== "ended") return { done: false, outcomes: [] };
      const byCustom = new Map(items.map((it) => [customId(it.id), it]));
      const outcomes: BatchOutcome[] = [];
      for await (const r of await client.beta.messages.batches.results(batchId)) {
        const it = byCustom.get(r.custom_id);
        if (!it) continue;
        if (r.result.type === "succeeded" && r.result.message) outcomes.push({ id: it.id, result: parseClaude(r.result.message, it.req, model, Date.now()) });
        else outcomes.push({ id: it.id, failed: r.result.type, result: fail(model, r.result.type, Date.now()) });
      }
      return { done: true, outcomes };
    },
  };
}
