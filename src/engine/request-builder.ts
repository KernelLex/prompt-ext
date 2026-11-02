import { REGISTRY } from "./frameworks/registry";
import { renderCatalog, selectCatalog } from "./frameworks/select";
import type { Technique } from "./frameworks/types";
import { buildSystemPrompt, buildUserMessage } from "./instructions/system";
import type { Mode, ProviderRequest, TaskType } from "./types";

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Output cap scaled to input size: generous enough for Deep mode, bounded to limit cost (FR21). */
export function outputTokenBudget(prompt: string, mode: Mode): number {
  const multiplier = mode === "light" ? 2 : mode === "balanced" ? 3 : 4;
  return Math.min(4096, Math.max(512, multiplier * estimateTokens(prompt) + 400));
}

export function randomNonce(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface BuildOptions {
  mode: Mode;
  hint: TaskType;
  nonce?: string;
  registry?: ReadonlyMap<string, Technique>;
}

export function buildRequest(prompt: string, opts: BuildOptions): ProviderRequest {
  const registry = opts.registry ?? REGISTRY;
  const catalog = selectCatalog(registry, opts.mode, opts.hint);
  return {
    system: buildSystemPrompt(opts.mode, renderCatalog(catalog, opts.hint)),
    user: buildUserMessage(prompt, opts.mode, opts.hint, opts.nonce ?? randomNonce()),
    maxOutputTokens: outputTokenBudget(prompt, opts.mode),
    temperature: 0.2,
  };
}
