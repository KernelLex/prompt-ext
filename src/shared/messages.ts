/** Typed messages between the service worker (SW) and the on-demand content script (CS). */

export type FieldKind = "textarea" | "input" | "contenteditable";

export type CaptureResponse =
  | { ok: true; text: string; kind: FieldKind; editor: string }
  | { ok: false; reason: "no_field" | "unsupported_field" | "sensitive_field" | "read_failed" };

export type ApplyStatus = "inserted" | "field_changed" | "field_gone" | "insert_failed";

export interface ToastAction {
  id: "undo" | "cancel" | "settings" | "retry" | "force_retry" | "copy" | "insert_anyway" | "replace_anyway" | "send_anyway" | "dismiss";
  label: string;
  primary?: boolean;
}

/** SW → CS */
export type ToContent =
  | { type: "pe/ping" }
  | { type: "pe/capture" }
  | { type: "pe/confirm-secret"; providerName: string }
  | { type: "pe/progress"; providerName: string; model: string }
  | { type: "pe/apply"; enhanced: string; notes: string; chips: string[] }
  | { type: "pe/unchanged"; chips: string[] }
  | { type: "pe/blocked"; title: string; detail: string; enhanced: string | null; allowInsertAnyway: boolean }
  | { type: "pe/error"; title: string; detail: string; actions: ToastAction["id"][] }
  | { type: "pe/busy" }
  | { type: "pe/restore" };

/** CS → SW */
export type ToBackground =
  | { type: "pe/cancel" }
  | { type: "pe/open-options" }
  | { type: "pe/retry"; force: boolean };

const CONTENT_TYPES = new Set([
  "pe/ping", "pe/capture", "pe/confirm-secret", "pe/progress", "pe/apply", "pe/unchanged",
  "pe/blocked", "pe/error", "pe/busy", "pe/restore",
]);
const BACKGROUND_TYPES = new Set(["pe/cancel", "pe/open-options", "pe/retry"]);

export function isToContent(msg: unknown): msg is ToContent {
  return typeof msg === "object" && msg !== null && CONTENT_TYPES.has((msg as { type?: unknown }).type as string);
}

export function isToBackground(msg: unknown): msg is ToBackground {
  return typeof msg === "object" && msg !== null && BACKGROUND_TYPES.has((msg as { type?: unknown }).type as string);
}
