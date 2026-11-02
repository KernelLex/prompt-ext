import { parseSettings, type Settings } from "./schema";

/** Minimal subset of chrome.storage.StorageArea, so storage can be faked in unit tests. */
export interface StorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

const SETTINGS_KEY = "settings";

export async function loadSettings(local: StorageAreaLike): Promise<Settings> {
  const raw = await local.get(SETTINGS_KEY);
  return parseSettings(raw[SETTINGS_KEY]);
}

export async function saveSettings(local: StorageAreaLike, settings: Settings): Promise<void> {
  await local.set({ [SETTINGS_KEY]: settings });
}
