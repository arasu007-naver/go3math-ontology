import { HttpError } from "../server/selectors/common.ts";

// e2c 재시도: 429/5xx/timeout → 1s, 2s, 4s, 8s (최대 5회 시도), Retry-After 가 있으면 그 값 우선
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const MAX_ATTEMPTS = 5;

export async function withRetry<T>(fn: () => Promise<T>, opts: { sleep?: (ms: number) => Promise<void>; maxAttempts?: number } = {}): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const max = opts.maxAttempts ?? MAX_ATTEMPTS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const retryable =
        (e instanceof HttpError && (e.status === 429 || e.status >= 500)) ||
        (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"));
      if (!retryable || attempt + 1 >= max) throw e;
      await sleep(e instanceof HttpError && e.retryAfter != null ? e.retryAfter * 1000 : 1000 * 2 ** attempt);
    }
  }
}
