import { isToContent, type ApplyStatus, type CaptureResponse, type ToBackground, type ToContent, type ToastAction } from "../shared/messages";
import { normalizeForCompare } from "../shared/text";
import { copyText } from "./clipboard";
import { locateField, readFieldText, type LocatedField } from "./field-locator";
import { adaptForField, fieldMatches, replaceFieldText } from "./insertion";
import { Toast } from "./toast";

/**
 * Content script, injected on demand (activeTab + scripting) into the main frame only.
 * Responsibilities: find the focused field, read it, write it, verify, undo, and show status.
 * It makes no network requests and never sees API keys. It never submits forms or presses keys.
 */

declare global {
  interface Window {
    __promptEnhancerLoaded?: boolean;
  }
}

interface Capture {
  field: LocatedField;
  text: string;
}
interface UndoRecord {
  field: LocatedField;
  original: string;
  enhanced: string;
}

const toast = new Toast();
let capture: Capture | null = null;
let undo: UndoRecord | null = null;
let enhancing = false;

const RESTORE_HINT = "or Alt+Shift+Z";

function send(msg: ToBackground): void {
  chrome.runtime.sendMessage(msg).catch(() => undefined);
}

function onEscape(ev: KeyboardEvent): void {
  if (enhancing && ev.key === "Escape") {
    ev.stopPropagation();
    send({ type: "pe/cancel" });
  }
}

function setEnhancing(on: boolean): void {
  enhancing = on;
  if (on) window.addEventListener("keydown", onEscape, true);
  else window.removeEventListener("keydown", onEscape, true);
}

function handleCapture(): CaptureResponse {
  const located = locateField();
  if (!located.ok) {
    capture = null;
    const messages: Record<typeof located.reason, string> = {
      no_field: "Click into a text box first, then try again.",
      unsupported_field: "This editor isn't supported. Nothing was sent.",
      sensitive_field: "This looks like a password or personal-data field. Nothing was sent.",
    };
    toast.setAnchor(null);
    toast.show(
      {
        tone: "info",
        title: located.reason === "no_field" ? "No text box selected" : "This field isn't supported",
        detail: messages[located.reason],
        autoHideMs: 6000,
      },
      () => toast.hide(),
    );
    return { ok: false, reason: located.reason };
  }
  try {
    const text = readFieldText(located.field);
    capture = { field: located.field, text };
    toast.setAnchor(located.field.el);
    return { ok: true, text, kind: located.field.kind, editor: located.field.editor };
  } catch {
    return { ok: false, reason: "read_failed" };
  }
}

function showInserted(chips: string[], notes: string): void {
  toast.show(
    {
      tone: "ok",
      title: "Prompt enhanced — not sent",
      detail: notes || "Review it, then send it yourself.",
      chips,
      actions: [{ id: "undo", label: "Undo", primary: true }],
      hint: RESTORE_HINT,
      autoHideMs: 10_000,
    },
    (id) => (id === "undo" ? void handleRestore() : toast.hide()),
  );
}

function doInsert(field: LocatedField, original: string, enhanced: string): ApplyStatus {
  const result = replaceFieldText(field, enhanced, original);
  if (result.ok) {
    undo = { field, original, enhanced: adaptForField(field, enhanced) };
    return "inserted";
  }
  return "insert_failed";
}

function showInsertFailed(enhanced: string, field: LocatedField): void {
  toast.show(
    {
      tone: "warn",
      title: "Couldn't update this editor safely",
      detail: "Your original text is unchanged. You can copy the enhanced prompt and paste it yourself.",
      actions: [{ id: "copy", label: "Copy enhanced", primary: true }, { id: "dismiss", label: "Dismiss" }],
    },
    (id) => {
      if (id === "copy") void copyText(enhanced, field.el).then((ok) => showCopied(ok));
      else toast.hide();
    },
  );
}

function showCopied(ok: boolean): void {
  toast.show(
    { tone: ok ? "ok" : "warn", title: ok ? "Copied to clipboard" : "Copy failed", detail: ok ? "Your text box was not changed." : "Your browser blocked clipboard access.", autoHideMs: 4000 },
    () => toast.hide(),
  );
}

function handleApply(msg: Extract<ToContent, { type: "pe/apply" }>): ApplyStatus {
  setEnhancing(false);
  const cap = capture;
  if (!cap || !cap.field.el.isConnected) {
    toast.show(
      {
        tone: "warn",
        title: "The text box is gone",
        detail: "The page replaced the editor while enhancing. Nothing was inserted.",
        actions: [{ id: "copy", label: "Copy enhanced", primary: true }, { id: "dismiss", label: "Dismiss" }],
      },
      (id) => (id === "copy" ? void copyText(msg.enhanced).then(showCopied) : toast.hide()),
    );
    return "field_gone";
  }
  const current = readFieldText(cap.field);
  if (normalizeForCompare(current) !== normalizeForCompare(cap.text)) {
    toast.show(
      {
        tone: "warn",
        title: "You edited the text while it was enhancing",
        detail: "The enhanced version was not inserted, so your new typing isn't overwritten.",
        actions: [
          { id: "replace_anyway", label: "Replace anyway", primary: true },
          { id: "copy", label: "Copy enhanced" },
          { id: "dismiss", label: "Dismiss" },
        ],
      },
      (id) => {
        if (id === "replace_anyway") {
          const latest = readFieldText(cap.field);
          const status = doInsert(cap.field, latest, msg.enhanced);
          if (status === "inserted") showInserted(msg.chips, msg.notes);
          else showInsertFailed(msg.enhanced, cap.field);
        } else if (id === "copy") void copyText(msg.enhanced, cap.field.el).then(showCopied);
        else toast.hide();
      },
    );
    return "field_changed";
  }
  const status = doInsert(cap.field, cap.text, msg.enhanced);
  if (status === "inserted") showInserted(msg.chips, msg.notes);
  else showInsertFailed(msg.enhanced, cap.field);
  return status;
}

function handleBlocked(msg: Extract<ToContent, { type: "pe/blocked" }>): void {
  setEnhancing(false);
  const actions: ToastAction[] = [];
  if (msg.enhanced) actions.push({ id: "copy", label: "Copy result", primary: true });
  if (msg.enhanced && msg.allowInsertAnyway) actions.push({ id: "insert_anyway", label: "Insert anyway" });
  actions.push({ id: "retry", label: "Retry" }, { id: "dismiss", label: "Dismiss" });
  toast.show({ tone: "warn", title: msg.title, detail: msg.detail, actions }, (id) => {
    const cap = capture;
    if (id === "copy" && msg.enhanced) void copyText(msg.enhanced, cap?.field.el).then(showCopied);
    else if (id === "insert_anyway" && msg.enhanced && cap) {
      // Explicit user choice (D3). Still guarded: only if the field is unchanged.
      if (!cap.field.el.isConnected || !fieldMatches(cap.field, cap.text)) {
        toast.show({ tone: "warn", title: "Text changed — not inserted", detail: "Copy the result instead.", autoHideMs: 5000 }, () => toast.hide());
        return;
      }
      const status = doInsert(cap.field, cap.text, msg.enhanced);
      if (status === "inserted") showInserted(["Inserted with warnings"], "Review carefully: this result failed a check.");
      else showInsertFailed(msg.enhanced, cap.field);
    } else if (id === "retry") send({ type: "pe/retry", force: false });
    else toast.hide();
  });
}

function handleError(msg: Extract<ToContent, { type: "pe/error" }>): void {
  setEnhancing(false);
  const labels: Partial<Record<ToastAction["id"], string>> = {
    settings: "Open settings",
    retry: "Retry",
    force_retry: "Try anyway",
    dismiss: "Dismiss",
  };
  const actions: ToastAction[] = msg.actions.map((id, i) => ({ id, label: labels[id] ?? id, primary: i === 0 && id !== "dismiss" }));
  toast.show({ tone: "error", title: msg.title, detail: msg.detail, actions }, (id) => {
    if (id === "settings") send({ type: "pe/open-options" });
    else if (id === "retry") send({ type: "pe/retry", force: false });
    else if (id === "force_retry") send({ type: "pe/retry", force: true });
    toast.hide();
  });
}

async function handleRestore(): Promise<ApplyStatus | "nothing"> {
  const rec = undo;
  if (!rec) {
    toast.show({ tone: "info", title: "Nothing to restore", detail: "No enhancement has been applied on this page.", autoHideMs: 4000 }, () => toast.hide());
    return "nothing";
  }
  toast.setAnchor(rec.field.el);
  if (!rec.field.el.isConnected) {
    toast.show(
      {
        tone: "warn",
        title: "The text box is gone",
        detail: "You can still copy your original prompt.",
        actions: [{ id: "copy", label: "Copy original", primary: true }, { id: "dismiss", label: "Dismiss" }],
      },
      (id) => (id === "copy" ? void copyText(rec.original).then(showCopied) : toast.hide()),
    );
    return "field_gone";
  }
  const restore = (): ApplyStatus => {
    const current = readFieldText(rec.field);
    const result = replaceFieldText(rec.field, rec.original, current);
    if (result.ok) {
      undo = null;
      toast.show({ tone: "ok", title: "Original prompt restored", autoHideMs: 4000 }, () => toast.hide());
      return "inserted";
    }
    toast.show(
      {
        tone: "warn",
        title: "Couldn't restore in this editor",
        detail: "Copy your original prompt and paste it back.",
        actions: [{ id: "copy", label: "Copy original", primary: true }],
      },
      () => void copyText(rec.original, rec.field.el).then(showCopied),
    );
    return "insert_failed";
  };
  if (fieldMatches(rec.field, rec.enhanced)) return restore();
  toast.show(
    {
      tone: "warn",
      title: "Text changed since enhancement",
      detail: "Replace the current text with your original prompt?",
      actions: [
        { id: "replace_anyway", label: "Replace with original", primary: true },
        { id: "copy", label: "Copy original" },
        { id: "dismiss", label: "Cancel" },
      ],
    },
    (id) => {
      if (id === "replace_anyway") restore();
      else if (id === "copy") void copyText(rec.original, rec.field.el).then(showCopied);
      else toast.hide();
    },
  );
  return "field_changed";
}

function handleConfirmSecret(providerName: string, respond: (r: { confirmed: boolean }) => void): void {
  toast.show(
    {
      tone: "warn",
      title: "This text may contain a secret",
      detail: `It looks like it includes an API key or private key. Send it to ${providerName} anyway?`,
      actions: [{ id: "dismiss", label: "Don't send", primary: true }, { id: "send_anyway", label: "Send anyway" }],
    },
    (id) => {
      toast.hide();
      respond({ confirmed: id === "send_anyway" });
    },
  );
}

function init(): void {
  if (window.__promptEnhancerLoaded) return;
  window.__promptEnhancerLoaded = true;

  chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !isToContent(msg)) return false;
    switch (msg.type) {
      case "pe/ping":
        sendResponse({ ok: true });
        return false;
      case "pe/capture":
        sendResponse(handleCapture());
        return false;
      case "pe/confirm-secret":
        handleConfirmSecret(msg.providerName, sendResponse);
        return true; // async response
      case "pe/progress":
        setEnhancing(true);
        toast.show(
          {
            tone: "progress",
            title: "Enhancing prompt…",
            detail: `Sending only this text box to ${msg.providerName} (${msg.model}). Your text stays unchanged until the result is checked.`,
            actions: [{ id: "cancel", label: "Cancel" }],
            hint: "Esc",
          },
          (id) => (id === "cancel" ? send({ type: "pe/cancel" }) : undefined),
        );
        sendResponse({ ok: true });
        return false;
      case "pe/busy":
        toast.show(
          { tone: "progress", title: "Already enhancing…", detail: "Wait for the current request to finish.", actions: [{ id: "cancel", label: "Cancel" }] },
          (id) => (id === "cancel" ? send({ type: "pe/cancel" }) : undefined),
        );
        sendResponse({ ok: true });
        return false;
      case "pe/apply":
        sendResponse({ status: handleApply(msg) });
        return false;
      case "pe/unchanged":
        setEnhancing(false);
        toast.show(
          { tone: "info", title: "Already clear — no changes", detail: "Your prompt is specific enough. It was left as is.", chips: msg.chips, autoHideMs: 6000 },
          () => toast.hide(),
        );
        sendResponse({ ok: true });
        return false;
      case "pe/blocked":
        handleBlocked(msg);
        sendResponse({ ok: true });
        return false;
      case "pe/error":
        handleError(msg);
        sendResponse({ ok: true });
        return false;
      case "pe/restore":
        void handleRestore().then((status) => sendResponse({ status }));
        return true;
    }
  });
}

init();

