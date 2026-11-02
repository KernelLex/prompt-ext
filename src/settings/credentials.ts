import type { StorageAreaLike } from "./store";

/**
 * API key storage. Keys are stored under their own storage key (never inside the settings object),
 * read only on the request path, and never logged.
 *
 * SECURITY: chrome.storage is not encrypted at rest beyond OS profile protection. Anyone with
 * access to this browser profile, or malware on the machine, can read a saved key. "Remember key"
 * off keeps it in memory-only session storage instead.
 */
const credKey = (providerId: string) => `cred:${providerId}`;

export interface CredentialStores {
  local: StorageAreaLike;
  session: StorageAreaLike;
}

export async function getApiKey(stores: CredentialStores, providerId: string): Promise<string | null> {
  const k = credKey(providerId);
  const fromSession = (await stores.session.get(k))[k];
  if (typeof fromSession === "string" && fromSession) return fromSession;
  const fromLocal = (await stores.local.get(k))[k];
  return typeof fromLocal === "string" && fromLocal ? fromLocal : null;
}

export async function setApiKey(stores: CredentialStores, providerId: string, key: string, remember: boolean): Promise<void> {
  const k = credKey(providerId);
  const value = key.trim();
  if (!value) throw new Error("Empty key");
  // Store in exactly one place.
  if (remember) {
    await stores.session.remove(k);
    await stores.local.set({ [k]: value });
  } else {
    await stores.local.remove(k);
    await stores.session.set({ [k]: value });
  }
}

export async function removeApiKey(stores: CredentialStores, providerId: string): Promise<void> {
  const k = credKey(providerId);
  await stores.local.remove(k);
  await stores.session.remove(k);
}

/** Moves an existing key between persistent and session storage when the preference changes. */
export async function moveApiKey(stores: CredentialStores, providerId: string, remember: boolean): Promise<void> {
  const key = await getApiKey(stores, providerId);
  if (key) await setApiKey(stores, providerId, key, remember);
}
