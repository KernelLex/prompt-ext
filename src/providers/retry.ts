import { ProviderError, RETRYABLE } from "./errors";

export interface RetryOptions {
  maxRetries?: number;
  /** Never wait longer than this for a retry; longer provider hints mean "fail now". */
  maxDelayMs?: number;
  baseDelayMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Bounded retry (FR17): at most `maxRetries` (default 1) for transient errors only. No loops. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const maxRetries = opts.maxRetries ?? 1;
  const maxDelay = opts.maxDelayMs ?? 5000;
  const base = opts.baseDelayMs ?? 800;
  const sleep = opts.sleep ?? abortableSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const e = ProviderError.from(err);
      if (attempt >= maxRetries || !RETRYABLE.has(e.kind) || opts.signal.aborted) throw e;
      const delay = e.info.retryAfterMs ?? base + Math.floor(Math.random() * base);
      if (delay > maxDelay) throw e;
      await sleep(delay, opts.signal);
    }
  }
}
