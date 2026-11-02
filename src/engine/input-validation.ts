import { looksLikeSecret } from "../shared/redact";

/** Upper bound on prompt size sent to a provider (plan FR6). Protects free-tier token budgets. */
export const MAX_INPUT_CHARS = 12_000;
export const MIN_INPUT_CHARS = 3;

export type InputCheck =
  | { ok: true; possibleSecret: boolean }
  | { ok: false; reason: "empty" | "too_short" | "too_long"; detail: string };

export function validateInput(text: string): InputCheck {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty", detail: "The text box is empty." };
  if (trimmed.replace(/\s/g, "").length < MIN_INPUT_CHARS) {
    return { ok: false, reason: "too_short", detail: "Type a little more before enhancing." };
  }
  if (text.length > MAX_INPUT_CHARS) {
    return {
      ok: false,
      reason: "too_long",
      detail: `The prompt is ${text.length.toLocaleString("en-US")} characters; the limit is ${MAX_INPUT_CHARS.toLocaleString("en-US")}.`,
    };
  }
  return { ok: true, possibleSecret: looksLikeSecret(text) };
}
