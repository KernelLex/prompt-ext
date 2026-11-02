/**
 * Debug logging for test builds only. Production builds compile this to a no-op (esbuild define).
 * Never pass prompt text, keys, or provider payloads here — event names and small metadata only.
 */
export function debug(event: string, meta?: Record<string, string | number | boolean>): void {
  if (__TEST__) {
    // eslint-disable-next-line no-console
    console.debug(`[prompt-enhancer] ${event}`, meta ?? "");
  }
}
