import { enhancePrompt, type EnhanceOutcome } from "../engine/pipeline";
import { validateInput } from "../engine/input-validation";
import { blockedUntil, resetCircuit, tripCircuit } from "../providers/circuit";
import { describeError, ProviderError } from "../providers/errors";
import { getAdapter } from "../providers/registry";
import { withRetry } from "../providers/retry";
import type { ProviderAdapter } from "../providers/types";
import { getApiKey } from "../settings/credentials";
import { hasValidConsent, type Settings } from "../settings/schema";
import { loadSettings } from "../settings/store";
import { debug } from "../shared/debug";
import type { ApplyStatus, CaptureResponse, ToContent } from "../shared/messages";
import { setBadge } from "./badge";
import { ensureContentScript, sendToTab } from "./inject";

/** One enhancement per tab (FR19). The controller lets the user cancel (FR20). */
const inflight = new Map<number, AbortController>();

export function cancelEnhancement(tabId: number): void {
  inflight.get(tabId)?.abort(new DOMException("Cancelled by user", "AbortError"));
}

export function isInflight(tabId: number): boolean {
  return inflight.has(tabId);
}

const TASK_LABEL: Record<string, string> = {
  coding: "Coding", research: "Research", writing: "Writing", analysis: "Analysis",
  factual: "Factual", planning: "Planning", creative: "Creative", other: "General",
};

function chipsFor(taskType: string, techniques: string[], mode: string): string[] {
  const pretty = (id: string) => id.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return [TASK_LABEL[taskType] ?? "General", ...techniques.slice(0, 3).map(pretty), mode[0]!.toUpperCase() + mode.slice(1)];
}

async function needsSetup(settings: Settings, adapter: ProviderAdapter | undefined): Promise<string | null> {
  if (!adapter) return "provider";
  const key = await getApiKey({ local: chrome.storage.local, session: chrome.storage.session }, adapter.id);
  if (!key) return "key";
  if (!hasValidConsent(settings, adapter.id)) return "consent";
  return null;
}

async function show(tabId: number, msg: ToContent): Promise<void> {
  await sendToTab(tabId, msg);
}

export interface RunOptions {
  /** Ignore a tripped quota circuit breaker (explicit user override, FR18). */
  force?: boolean;
}

/** The full enhancement workflow for one tab, triggered by an intentional user action. */
export async function runEnhancement(tabId: number, opts: RunOptions = {}): Promise<void> {
  if (inflight.has(tabId)) {
    await show(tabId, { type: "pe/busy" });
    return;
  }
  // Reserve the slot synchronously-ish before any await that could interleave a second trigger.
  const controller = new AbortController();
  inflight.set(tabId, controller);
  try {
    await run(tabId, controller, opts);
  } finally {
    inflight.delete(tabId);
  }
}

async function run(tabId: number, controller: AbortController, opts: RunOptions): Promise<void> {
  const settings = await loadSettings(chrome.storage.local);
  const adapter = getAdapter(settings.activeProvider);
  const setup = await needsSetup(settings, adapter);
  if (setup || !adapter) {
    await setBadge(tabId, "error", "set up your API key first");
    await chrome.runtime.openOptionsPage();
    return;
  }

  if (!(await ensureContentScript(tabId))) {
    await setBadge(tabId, "error", "can't run on this page");
    return;
  }

  const captured = await sendToTab<CaptureResponse>(tabId, { type: "pe/capture" });
  if (!captured?.ok) {
    await setBadge(tabId, "error", captured?.reason === "no_field" ? "click into a text box first" : "this field isn't supported");
    return;
  }

  const input = validateInput(captured.text);
  if (!input.ok) {
    await show(tabId, { type: "pe/error", title: "Nothing to enhance", detail: input.detail, actions: ["dismiss"] });
    await setBadge(tabId, "error", input.detail);
    return;
  }
  if (input.possibleSecret) {
    const answer = await sendToTab<{ confirmed: boolean }>(tabId, { type: "pe/confirm-secret", providerName: adapter.displayName });
    if (!answer?.confirmed) return;
  }

  const session = chrome.storage.session;
  if (!opts.force) {
    const until = await blockedUntil(session, adapter.id);
    if (until) {
      const at = new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      await show(tabId, {
        type: "pe/error",
        title: `${adapter.displayName} quota reached`,
        detail: `Paused until about ${at} to avoid repeated failing requests. Your text was not changed.`,
        actions: ["force_retry", "dismiss"],
      });
      await setBadge(tabId, "error", "quota reached");
      return;
    }
  } else {
    await resetCircuit(session, adapter.id);
  }

  const granted = await chrome.permissions.contains({ origins: [adapter.hostPermission] });
  if (!granted) {
    const e = describeError(new ProviderError("missing_permission", "Host permission missing"), adapter.displayName);
    await show(tabId, { type: "pe/error", ...e });
    await setBadge(tabId, "error", e.title);
    return;
  }

  const apiKey = await getApiKey({ local: chrome.storage.local, session }, adapter.id);
  if (!apiKey) return;
  const model = settings.providers[adapter.id]?.model ?? adapter.defaultModel;

  await show(tabId, { type: "pe/progress", providerName: adapter.displayName, model });
  await setBadge(tabId, "running", `enhancing with ${adapter.displayName}…`);
  debug("enhance:start", { tabId, mode: settings.mode, chars: captured.text.length });
  const started = Date.now();

  const retryingAdapter: ProviderAdapter = {
    ...adapter,
    complete: (req, ctx) => withRetry(() => adapter.complete(req, ctx), { signal: controller.signal }),
  };
  const outcome: EnhanceOutcome = await enhancePrompt(captured.text, {
    mode: settings.mode,
    adapter: retryingAdapter,
    call: { apiKey, model, signal: controller.signal },
  });
  debug("enhance:done", { tabId, kind: outcome.kind, ms: Date.now() - started });

  await deliver(tabId, outcome, adapter, settings);
}

async function deliver(tabId: number, outcome: EnhanceOutcome, adapter: ProviderAdapter, settings: Settings): Promise<void> {
  switch (outcome.kind) {
    case "enhanced": {
      const res = await sendToTab<{ status: ApplyStatus }>(tabId, {
        type: "pe/apply",
        enhanced: outcome.text,
        notes: outcome.result.notes,
        chips: chipsFor(outcome.result.task_type, outcome.result.techniques, settings.mode),
      });
      const ok = res?.status === "inserted";
      await setBadge(tabId, ok ? "ok" : "error", ok ? "enhanced (not sent)" : "not inserted");
      return;
    }
    case "unchanged":
      await show(tabId, { type: "pe/unchanged", chips: chipsFor(outcome.result.task_type, [], settings.mode) });
      await setBadge(tabId, "ok", "no changes needed");
      return;
    case "blocked": {
      const first = outcome.issues.find((i) => i.severity !== "warning") ?? outcome.issues[0];
      const items = outcome.issues.flatMap((i) => i.items ?? []);
      const detail = `${first?.detail ?? "The result failed a safety check."}${items.length ? ` Missing: ${items.map((i) => `“${i.length > 40 ? `${i.slice(0, 37)}…` : i}”`).join(", ")}.` : ""} Nothing was inserted.`;
      await show(tabId, {
        type: "pe/blocked",
        title: "Result didn't pass checks",
        detail,
        enhanced: outcome.text,
        allowInsertAnyway: settings.allowInsertAnyway && outcome.overridable,
      });
      await setBadge(tabId, "error", "result failed checks");
      return;
    }
    case "error": {
      if (outcome.error.kind === "quota_exhausted") await tripCircuit(chrome.storage.session, adapter.id, outcome.error.info.retryAfterMs);
      const e = describeError(outcome.error, adapter.displayName);
      await show(tabId, { type: "pe/error", ...e });
      await setBadge(tabId, "error", e.title);
      return;
    }
    case "invalid_input":
      await show(tabId, { type: "pe/error", title: "Nothing to enhance", detail: outcome.detail, actions: ["dismiss"] });
      return;
  }
}

/** Restore-original command: asks the page's content script to undo, if it exists. */
export async function runRestore(tabId: number): Promise<void> {
  if (!(await ensureContentScript(tabId))) {
    await setBadge(tabId, "error", "nothing to restore here");
    return;
  }
  await sendToTab(tabId, { type: "pe/restore" });
}
