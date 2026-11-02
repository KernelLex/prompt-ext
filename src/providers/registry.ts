import { createGroqAdapter } from "./groq/adapter";
import type { ProviderAdapter } from "./types";

/**
 * Configured providers. Gemini is intentionally absent until its terms, data-use policy, and
 * geographic restrictions are re-verified (plan decision D2, milestone M5).
 */
const ADAPTERS: ReadonlyMap<string, ProviderAdapter> = new Map([["groq", createGroqAdapter()]]);

export function getAdapter(id: string): ProviderAdapter | undefined {
  return ADAPTERS.get(id);
}

export function listAdapters(): ProviderAdapter[] {
  return [...ADAPTERS.values()];
}

/** Providers shown in settings but not yet available (D2). */
export const PLANNED_PROVIDERS = [{ id: "gemini", displayName: "Google Gemini", reason: "Not available yet — pending terms and data-use review." }];
