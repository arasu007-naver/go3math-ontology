import type { BatchAdapter, BatchItem, ModelResult } from "../types.ts";

export type BatchRun = { batchId: string; results: Map<string, ModelResult>; retry: BatchItem[] };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// 제출 → 완료까지 폴링 → 결과 수집. 실패·만료·누락·파싱 실패 항목만 retry(realtime 재시도 목록)에 넣는다.
export async function runBatch(
  adapter: BatchAdapter,
  items: BatchItem[],
  opts: { pollMs?: number; maxPolls?: number; sleep?: (ms: number) => Promise<void>; batchId?: string; onSubmitted?: (batchId: string) => Promise<void> | void } = {}
): Promise<BatchRun> {
  if (!items.length) return { batchId: "", results: new Map(), retry: [] };
  const sleep = opts.sleep ?? defaultSleep;
  const batchId = opts.batchId ?? (await adapter.submit(items));
  if (!opts.batchId) await opts.onSubmitted?.(batchId);
  const maxPolls = opts.maxPolls ?? 2880;
  let outcomes: Awaited<ReturnType<BatchAdapter["collect"]>> = { done: false, outcomes: [] };
  for (let i = 0; i < maxPolls; i++) {
    outcomes = await adapter.collect(batchId, items);
    if (outcomes.done) break;
    await sleep(opts.pollMs ?? 30000);
  }
  const results = new Map<string, ModelResult>();
  for (const o of outcomes.outcomes) if (o.result?.ok) results.set(o.id, o.result);
  const retry = items.filter((it) => !results.has(it.id));
  return { batchId, results, retry };
}

// 실패한 항목의 사유도 남기고 싶을 때(리포트)
export const failedIds = (items: BatchItem[], results: Map<string, ModelResult>) => items.filter((i) => !results.has(i.id)).map((i) => i.id);
