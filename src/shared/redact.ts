/**
 * Removes anything that looks like a credential from a string before it is shown or logged.
 * Applied to every provider error message (plan §10).
 */
const KEY_PATTERNS: RegExp[] = [
  /gsk_[A-Za-z0-9]{8,}/g, // Groq
  /AIza[0-9A-Za-z_-]{20,}/g, // Google
  /sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic style
  /Bearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
  /([?&](?:key|api_key|apikey|token)=)[^&\s]+/gi,
];

export function redact(input: string): string {
  let out = input;
  for (const re of KEY_PATTERNS) {
    out = out.replace(re, (match, prefix?: string) =>
      typeof prefix === "string" && match.startsWith(prefix) ? `${prefix}[redacted]` : "[redacted]",
    );
  }
  return out;
}

/** Display form for a saved key: first 4 and last 4 characters only. */
export function maskKey(key: string): string {
  if (key.length <= 10) return "••••";
  return `${key.slice(0, 4)}${"•".repeat(12)}${key.slice(-4)}`;
}

/** Heuristic: does this prompt text appear to contain a secret? (FR7 — warn, don't block.) */
export function looksLikeSecret(text: string): boolean {
  return (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text) ||
    /\b(?:gsk_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/.test(
      text,
    )
  );
}
