import { normalizeForCompare, toSingleLine } from "../shared/text";
import { readFieldText, type LocatedField } from "./field-locator";

/**
 * Replaces the whole content of a field with `text`, using the safest strategy that works,
 * verifying by reading the field back. Never submits, never presses Enter, never clicks.
 */
export type Strategy = "exec-insert-text" | "native-setter" | "synthetic-paste";

export interface ReplaceResult {
  ok: boolean;
  strategy?: Strategy;
  /** True if the field holds exactly its original text after a failed attempt. */
  rolledBack?: boolean;
}

function strategiesFor(field: LocatedField): Strategy[] {
  if (field.kind !== "contenteditable") return ["exec-insert-text", "native-setter"];
  // Rich editors generally handle paste of text/plain into their own model more faithfully.
  if (field.editor === "prosemirror" || field.editor === "lexical") return ["synthetic-paste", "exec-insert-text"];
  return ["exec-insert-text", "synthetic-paste"];
}

function selectAll(field: LocatedField): void {
  const el = field.el;
  el.focus({ preventScroll: true });
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.select();
    return;
  }
  const sel = el.ownerDocument.getSelection();
  if (!sel) return;
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
  // Editors such as ProseMirror sync their model's selection from `selectionchange`, which the
  // browser fires asynchronously. Without this synchronous nudge a following paste is applied to the
  // editor's stale selection and appends instead of replacing (found in M1 testing).
  el.ownerDocument.dispatchEvent(new Event("selectionchange"));
}

function runStrategy(field: LocatedField, strategy: Strategy, text: string): void {
  const el = field.el;
  switch (strategy) {
    case "exec-insert-text": {
      selectAll(field);
      // Deprecated in specs but still the most compatible way to insert text that editors treat as
      // user input (fires beforeinput/input and integrates with native undo).
      el.ownerDocument.execCommand("insertText", false, text);
      return;
    }
    case "native-setter": {
      if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) return;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      // Prototype setter bypasses framework value trackers (e.g. React) so their onChange sees the change.
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: text }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    case "synthetic-paste": {
      selectAll(field);
      const data = new DataTransfer();
      data.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      return;
    }
  }
}

function placeCaretAtEnd(field: LocatedField): void {
  const el = field.el;
  el.focus({ preventScroll: true });
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const end = el.value.length;
    el.setSelectionRange(end, end);
    return;
  }
  const sel = el.ownerDocument.getSelection();
  if (!sel) return;
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function fieldMatches(field: LocatedField, text: string): boolean {
  return normalizeForCompare(readFieldText(field)) === normalizeForCompare(text);
}

/** Text as it will appear in this kind of field (text inputs cannot hold newlines). */
export function adaptForField(field: LocatedField, text: string): string {
  return field.kind === "input" ? toSingleLine(text) : text;
}

export function replaceFieldText(field: LocatedField, rawText: string, original: string): ReplaceResult {
  const text = adaptForField(field, rawText);
  for (const strategy of strategiesFor(field)) {
    try {
      runStrategy(field, strategy, text);
    } catch {
      // fall through to verification / next strategy
    }
    if (fieldMatches(field, text)) {
      placeCaretAtEnd(field);
      if (__TEST__) document.documentElement.dataset.peStrategy = strategy;
      return { ok: true, strategy };
    }
    // Partial or wrong result: restore before trying the next strategy.
    if (!fieldMatches(field, original)) restoreExactly(field, original);
  }
  if (__TEST__) document.documentElement.dataset.peStrategy = "failed";
  const rolledBack = fieldMatches(field, original) || restoreExactly(field, original);
  return { ok: false, rolledBack };
}

/** Puts `original` back using every strategy until the field verifiably holds it. */
function restoreExactly(field: LocatedField, original: string): boolean {
  for (const strategy of strategiesFor(field)) {
    try {
      runStrategy(field, strategy, original);
    } catch {
      /* try next */
    }
    if (fieldMatches(field, original)) return true;
  }
  return false;
}
