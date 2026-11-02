import type { FieldKind } from "../shared/messages";

export interface LocatedField {
  el: HTMLElement;
  kind: FieldKind;
  /** Editor family detected from public DOM markers only (never framework internals). */
  editor: string;
}

export type LocateResult =
  | { ok: true; field: LocatedField }
  | { ok: false; reason: "no_field" | "unsupported_field" | "sensitive_field" };

const TEXT_INPUT_TYPES = new Set(["text", "search", ""]);
const SENSITIVE_INPUT_TYPES = new Set(["password", "email", "tel", "number"]);

/** Follows focus into open shadow roots. Closed shadow roots and cross-origin iframes are unreachable. */
export function deepActiveElement(doc: Document = document): Element | null {
  let el: Element | null = doc.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

function detectEditor(el: HTMLElement): string {
  if (el.closest(".ProseMirror")) return "prosemirror";
  if (el.closest("[data-lexical-editor]")) return "lexical";
  if (el.closest("[data-slate-editor]")) return "slate";
  if (el.closest(".ql-editor")) return "quill";
  if (el.closest(".cm-content")) return "codemirror";
  return "plain";
}

/** Returns the root of the editable region containing `el` (the outermost contenteditable host). */
function editableRoot(el: HTMLElement): HTMLElement {
  let root = el;
  let parent = el.parentElement;
  while (parent && parent.isContentEditable) {
    root = parent;
    parent = parent.parentElement;
  }
  return root;
}

export function locateField(doc: Document = document): LocateResult {
  const active = deepActiveElement(doc);
  if (!active || active === doc.body || active === doc.documentElement) return { ok: false, reason: "no_field" };
  if (active.tagName === "IFRAME") return { ok: false, reason: "unsupported_field" }; // focus is inside a frame we don't inject into

  if (active instanceof HTMLTextAreaElement) {
    if (active.readOnly || active.disabled) return { ok: false, reason: "unsupported_field" };
    return { ok: true, field: { el: active, kind: "textarea", editor: "native" } };
  }
  if (active instanceof HTMLInputElement) {
    const type = (active.getAttribute("type") ?? "").toLowerCase();
    if (SENSITIVE_INPUT_TYPES.has(type) || /^cc-/.test(active.autocomplete)) return { ok: false, reason: "sensitive_field" };
    if (!TEXT_INPUT_TYPES.has(type) || active.readOnly || active.disabled) return { ok: false, reason: "unsupported_field" };
    return { ok: true, field: { el: active, kind: "input", editor: "native" } };
  }
  if (active instanceof HTMLElement && active.isContentEditable) {
    const root = editableRoot(active);
    return { ok: true, field: { el: root, kind: "contenteditable", editor: detectEditor(root) } };
  }
  return { ok: false, reason: "no_field" };
}

export function readFieldText(field: LocatedField): string {
  if (field.el instanceof HTMLTextAreaElement || field.el instanceof HTMLInputElement) return field.el.value;
  // innerText reflects rendered line breaks (block elements, <br>) better than textContent.
  return field.el.innerText.replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").replace(/\n$/, "");
}
