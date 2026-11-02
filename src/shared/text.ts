/** Normalizes text for equality checks between what we meant to insert and what the editor holds. */
export function normalizeForCompare(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Text inputs cannot hold newlines; collapse them the way a user would expect. */
export function toSingleLine(text: string): string {
  return text.replace(/\s*\n+\s*/g, " ").trim();
}
