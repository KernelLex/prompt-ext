import type { ProviderAdapter, ProviderCallContext } from "../providers/types";
import { ProviderError } from "../providers/errors";
import { hintTaskType } from "./classify-hint";
import { REGISTRY } from "./frameworks/registry";
import { validateInput } from "./input-validation";
import { validateOutput, type ValidationIssue } from "./output-validation";
import { buildRequest } from "./request-builder";
import { parseEnhancement } from "./response-parser";
import type { EnhancementContract, Mode } from "./types";

export type EnhanceOutcome =
  | { kind: "enhanced"; text: string; result: EnhancementContract; warnings: ValidationIssue[] }
  | { kind: "unchanged"; result: EnhancementContract }
  | { kind: "blocked"; text: string | null; overridable: boolean; issues: ValidationIssue[] }
  | { kind: "error"; error: ProviderError }
  | { kind: "invalid_input"; detail: string };

export interface EnhanceOptions {
  mode: Mode;
  adapter: ProviderAdapter;
  call: ProviderCallContext;
  nonce?: string;
}

/**
 * The enhancement pipeline: validate → hint → build request → one provider call → parse → validate.
 * Pure orchestration; no Chrome APIs, no DOM. The editor is only touched by the caller, and only
 * when this returns "enhanced".
 */
export async function enhancePrompt(prompt: string, opts: EnhanceOptions): Promise<EnhanceOutcome> {
  const input = validateInput(prompt);
  if (!input.ok) return { kind: "invalid_input", detail: input.detail };

  const hint = hintTaskType(prompt);
  const request = buildRequest(prompt, { mode: opts.mode, hint, ...(opts.nonce ? { nonce: opts.nonce } : {}) });

  let raw: string;
  try {
    raw = await opts.adapter.complete(request, opts.call);
  } catch (err) {
    return { kind: "error", error: ProviderError.from(err) };
  }

  const parsed = parseEnhancement(raw, REGISTRY);
  if (!parsed.ok) {
    return { kind: "error", error: new ProviderError("malformed_response", parsed.detail) };
  }

  const check = validateOutput(prompt, parsed.value, opts.mode);
  if (check.status === "fail") {
    const text = parsed.value.enhanced_prompt.trim().length > 0 ? parsed.value.enhanced_prompt : null;
    return { kind: "blocked", text, overridable: check.overridable, issues: check.issues };
  }
  if (check.unchanged) return { kind: "unchanged", result: parsed.value };
  return { kind: "enhanced", text: parsed.value.enhanced_prompt, result: parsed.value, warnings: check.issues };
}
