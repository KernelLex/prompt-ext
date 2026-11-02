import type { ProviderRequest } from "../engine/types";

export interface ModelInfo {
  id: string;
  label: string;
  /** Reasoning models spend output tokens on hidden reasoning; adapters add headroom. */
  reasoning: boolean;
  note: string;
}

export interface ProviderCallContext {
  apiKey: string;
  model: string;
  signal: AbortSignal;
}

/**
 * Provider-neutral adapter. Everything provider-specific (endpoints, wire format, error mapping,
 * models) lives behind this interface in `providers/<id>/`. Adapters throw only ProviderError.
 */
export interface ProviderAdapter {
  readonly id: string;
  readonly displayName: string;
  /** Host permission pattern requested (optionally) when the user configures this provider. */
  readonly hostPermission: string;
  readonly models: readonly ModelInfo[];
  readonly defaultModel: string;
  /** Returns the model's raw text output for the shared parser. */
  complete(request: ProviderRequest, ctx: ProviderCallContext): Promise<string>;
  /** Model IDs visible to this key (used to verify the allowlist at configuration time). */
  listModels(ctx: Omit<ProviderCallContext, "model">): Promise<string[]>;
}
