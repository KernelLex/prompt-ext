import type { ModelInfo } from "../types";

/**
 * Groq configuration — the only place Groq endpoints and model IDs live.
 *
 * VERIFICATION STATUS (2026-11-02): model IDs come from search snapshots of Groq's docs; the live
 * docs could not be loaded from the development environment (network policy). The options page
 * verifies this allowlist against GET /models for the user's own key before use.
 */
export const GROQ_BASE_URL: string = __GROQ_BASE_URL__;
/** Derived from the base URL so test builds (local mock server) exercise the same permission check. */
export const GROQ_HOST_PERMISSION = `${new URL(GROQ_BASE_URL).origin}/*`;

export const GROQ_MODELS: readonly ModelInfo[] = [
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B (recommended)",
    reasoning: true,
    note: "Strongest instruction-following of the free-tier candidates; reasoning effort set to low for latency.",
  },
  {
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B",
    reasoning: false,
    note: "Non-reasoning; typically lower latency.",
  },
  {
    id: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B Instant",
    reasoning: false,
    note: "Fastest; weaker at complex rewrites.",
  },
];

export const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";
/** Extra completion tokens for hidden reasoning on reasoning models. */
export const REASONING_HEADROOM_TOKENS = 1024;
export const REQUEST_TIMEOUT_MS = 20_000;
