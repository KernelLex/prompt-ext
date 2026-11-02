/**
 * Local circuit breaker (FR18): after a quota-exhausted response, block further requests to that
 * provider until the reset hint (or a default window) passes, unless the user explicitly overrides.
 */
export const DEFAULT_BLOCK_MS = 15 * 60 * 1000;

export interface KeyValueStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

const keyFor = (providerId: string) => `circuit:${providerId}`;

export async function blockedUntil(store: KeyValueStore, providerId: string, now = Date.now()): Promise<number | null> {
  const value = (await store.get(keyFor(providerId)))[keyFor(providerId)];
  if (typeof value !== "number") return null;
  if (value <= now) {
    await store.remove(keyFor(providerId));
    return null;
  }
  return value;
}

export async function tripCircuit(store: KeyValueStore, providerId: string, retryAfterMs: number | undefined, now = Date.now()): Promise<number> {
  const until = now + (retryAfterMs && retryAfterMs > 0 ? retryAfterMs : DEFAULT_BLOCK_MS);
  await store.set({ [keyFor(providerId)]: until });
  return until;
}

export async function resetCircuit(store: KeyValueStore, providerId: string): Promise<void> {
  await store.remove(keyFor(providerId));
}
