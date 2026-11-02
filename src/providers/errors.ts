import { redact } from "../shared/redact";

export type ProviderErrorKind =
  | "auth"
  | "forbidden"
  | "quota_exhausted"
  | "rate_limited"
  | "invalid_request"
  | "model_unavailable"
  | "server"
  | "timeout"
  | "network"
  | "cancelled"
  | "malformed_response"
  | "missing_permission";

export interface ProviderErrorInfo {
  status?: number;
  /** Provider-suggested wait before retrying, if any. */
  retryAfterMs?: number;
}

/** The single error type crossing the provider boundary. Messages are always redacted. */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly info: ProviderErrorInfo;

  constructor(kind: ProviderErrorKind, detail: string, info: ProviderErrorInfo = {}) {
    super(redact(detail).slice(0, 300));
    this.name = "ProviderError";
    this.kind = kind;
    this.info = info;
  }

  static from(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;
    if (err instanceof DOMException && err.name === "TimeoutError") return new ProviderError("timeout", "The request timed out.");
    if (err instanceof DOMException && err.name === "AbortError") return new ProviderError("cancelled", "The request was cancelled.");
    return new ProviderError("network", err instanceof Error ? err.message : "Network error.");
  }
}

export const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set(["server", "network", "rate_limited"]);

export interface UserFacingError {
  title: string;
  detail: string;
  actions: Array<"settings" | "retry" | "force_retry" | "dismiss">;
}

/** Plain-language messages. Never includes raw provider bodies beyond the redacted, truncated detail. */
export function describeError(err: ProviderError, providerName: string): UserFacingError {
  const keep = " Your text was not changed.";
  switch (err.kind) {
    case "auth":
      return { title: `${providerName} rejected your API key`, detail: `Check or replace the key in Settings.${keep}`, actions: ["settings", "dismiss"] };
    case "forbidden":
      return { title: `${providerName} refused the request`, detail: `Your key may not have access to this model or project.${keep}`, actions: ["settings", "dismiss"] };
    case "missing_permission":
      return { title: `Permission needed for ${providerName}`, detail: `Re-save your key in Settings to grant access to the ${providerName} API.${keep}`, actions: ["settings", "dismiss"] };
    case "quota_exhausted":
      return { title: `${providerName} quota reached`, detail: `Your free-tier limit is used up for now. No further requests will be sent until it resets.${keep}`, actions: ["force_retry", "dismiss"] };
    case "rate_limited":
      return { title: `${providerName} is rate limiting requests`, detail: `Wait a moment and try again.${keep}`, actions: ["retry", "dismiss"] };
    case "invalid_request":
      return { title: `${providerName} rejected the request`, detail: `${err.message}${keep}`, actions: ["dismiss"] };
    case "model_unavailable":
      return { title: "Model not available", detail: `The selected model isn't available to your key. Pick another model in Settings.${keep}`, actions: ["settings", "dismiss"] };
    case "server":
      return { title: `${providerName} had a server error`, detail: `Try again shortly.${keep}`, actions: ["retry", "dismiss"] };
    case "timeout":
      return { title: "The request timed out", detail: `${providerName} took too long to respond.${keep}`, actions: ["retry", "dismiss"] };
    case "network":
      return { title: "Network error", detail: `Couldn't reach ${providerName}.${keep}`, actions: ["retry", "dismiss"] };
    case "cancelled":
      return { title: "Cancelled", detail: "Your text was not changed.", actions: ["dismiss"] };
    case "malformed_response":
      return { title: "Unusable response", detail: `${providerName} returned a response that couldn't be read.${keep}`, actions: ["retry", "dismiss"] };
  }
}
