import { MODES, type Mode } from "../engine/types";
import { describeError, ProviderError } from "../providers/errors";
import { getAdapter, listAdapters, PLANNED_PROVIDERS } from "../providers/registry";
import { getApiKey, moveApiKey, removeApiKey, setApiKey, type CredentialStores } from "../settings/credentials";
import { CONSENT_TEXT_VERSION, emptyProviderSettings, hasValidConsent, type Settings } from "../settings/schema";
import { loadSettings, saveSettings } from "../settings/store";
import { maskKey } from "../shared/redact";

const stores: CredentialStores = { local: chrome.storage.local, session: chrome.storage.session };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const MODE_HELP: Record<Mode, string> = {
  light: "Light: minimal edits — fixes ambiguity and wording, adds no structure.",
  balanced: "Balanced: clarifies instructions and adds format or constraints only where they help.",
  deep: "Deep: thorough restructuring with steps and success criteria when the task justifies it.",
};

let settings: Settings;

function status(id: string, text: string, tone: "ok" | "warn" | "err" | "" = ""): void {
  const el = $(id);
  el.textContent = text;
  el.className = tone ? `status ${tone}` : id === "save-status" ? "foot" : "status";
}

async function persist(message = "Saved."): Promise<void> {
  await saveSettings(chrome.storage.local, settings);
  status("save-status", message);
}

function providerSettings(id: string) {
  settings.providers[id] ??= emptyProviderSettings();
  return settings.providers[id]!;
}

function renderSeg<T extends string>(containerId: string, options: Array<{ id: T; label: string; disabled?: boolean; title?: string }>, selected: T, onSelect: (id: T) => void): void {
  const box = $(containerId);
  box.replaceChildren();
  for (const opt of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(opt.id === selected));
    b.textContent = opt.label;
    b.disabled = !!opt.disabled;
    if (opt.title) b.title = opt.title;
    b.addEventListener("click", () => onSelect(opt.id));
    box.append(b);
  }
}

function renderModels(available?: Set<string>): void {
  const adapter = getAdapter(settings.activeProvider);
  const select = $<HTMLSelectElement>("model");
  select.replaceChildren();
  if (!adapter) return;
  const current = providerSettings(adapter.id).model ?? adapter.defaultModel;
  for (const m of adapter.models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    const missing = available && !available.has(m.id);
    opt.textContent = `${m.label} — ${m.id}${missing ? " (not available to your key)" : ""}`;
    opt.title = m.note;
    opt.disabled = !!missing;
    opt.selected = m.id === current;
    select.append(opt);
  }
}

async function renderKeyState(): Promise<void> {
  const adapter = getAdapter(settings.activeProvider);
  const key = adapter ? await getApiKey(stores, adapter.id) : null;
  $("key-mask").textContent = key ? maskKey(key) : "none";
  $<HTMLButtonElement>("remove-key").disabled = !key;
  const ready = !!key && !!adapter && hasValidConsent(settings, adapter.id);
  $("welcome").hidden = ready;
}

function renderConsent(): void {
  const adapter = getAdapter(settings.activeProvider);
  if (!adapter) return;
  const p = providerSettings(adapter.id);
  const ok = hasValidConsent(settings, adapter.id);
  $<HTMLInputElement>("consent").checked = ok;
  $("consent-status").textContent = ok
    ? `Accepted ${new Date(p.consentAcceptedAt!).toLocaleDateString()}.`
    : "Required before the first enhancement.";
}

function render(): void {
  renderSeg(
    "providers",
    [
      ...listAdapters().map((a) => ({ id: a.id, label: a.displayName })),
      ...PLANNED_PROVIDERS.map((p) => ({ id: p.id, label: `${p.displayName} (not available yet)`, disabled: true, title: p.reason })),
    ],
    settings.activeProvider,
    () => undefined, // only one available provider in the MVP
  );
  renderSeg(
    "modes",
    MODES.map((m) => ({ id: m, label: m[0]!.toUpperCase() + m.slice(1) })),
    settings.mode,
    (m) => {
      settings.mode = m;
      render();
      void persist();
    },
  );
  $("mode-help").textContent = MODE_HELP[settings.mode];
  $<HTMLInputElement>("remember").checked = settings.rememberKeys;
  $<HTMLInputElement>("allow-insert-anyway").checked = settings.allowInsertAnyway;
  renderModels();
  renderConsent();
  void renderKeyState();
}

async function onSaveKey(): Promise<void> {
  const adapter = getAdapter(settings.activeProvider);
  const input = $<HTMLInputElement>("api-key");
  const key = input.value.trim();
  if (!adapter || !key) {
    status("test-status", "Enter a key first.", "warn");
    return;
  }
  // Must run inside the click handler (user gesture). Narrow, optional host permission (plan §15.1).
  const granted = await chrome.permissions.request({ origins: [adapter.hostPermission] });
  if (!granted) {
    status("test-status", `Permission to contact ${adapter.displayName} was declined. The key was not saved.`, "err");
    return;
  }
  await setApiKey(stores, adapter.id, key, settings.rememberKeys);
  input.value = "";
  status("test-status", key.startsWith("gsk_") ? "Key saved." : "Key saved. Note: Groq keys usually start with gsk_.", key.startsWith("gsk_") ? "ok" : "warn");
  await renderKeyState();
}

async function onRemoveKey(): Promise<void> {
  const adapter = getAdapter(settings.activeProvider);
  if (!adapter) return;
  await removeApiKey(stores, adapter.id);
  status("test-status", "Key removed.", "ok");
  await renderKeyState();
}

async function onTest(): Promise<void> {
  const adapter = getAdapter(settings.activeProvider);
  if (!adapter) return;
  const key = await getApiKey(stores, adapter.id);
  if (!key) {
    status("test-status", "Save a key first.", "warn");
    return;
  }
  const btn = $<HTMLButtonElement>("test");
  btn.disabled = true;
  status("test-status", "Testing…");
  const started = performance.now();
  try {
    const ids = await adapter.listModels({ apiKey: key, signal: new AbortController().signal });
    const ms = Math.round(performance.now() - started);
    const available = new Set(ids);
    renderModels(available);
    const usable = adapter.models.filter((m) => available.has(m.id)).length;
    status(
      "test-status",
      usable > 0 ? `✓ Connected · ${ms} ms · ${usable}/${adapter.models.length} supported models available` : "Connected, but none of the supported models are available to this key.",
      usable > 0 ? "ok" : "warn",
    );
  } catch (err) {
    const e = describeError(ProviderError.from(err), adapter.displayName);
    status("test-status", `${e.title}. ${e.detail.replace(" Your text was not changed.", "")}`, "err");
  } finally {
    btn.disabled = false;
  }
}

async function init(): Promise<void> {
  settings = await loadSettings(chrome.storage.local);
  render();

  $("save-key").addEventListener("click", () => void onSaveKey());
  $<HTMLInputElement>("api-key").addEventListener("keydown", (e) => {
    if (e.key === "Enter") void onSaveKey();
  });
  $("remove-key").addEventListener("click", () => void onRemoveKey());
  $("test").addEventListener("click", () => void onTest());
  $<HTMLSelectElement>("model").addEventListener("change", (e) => {
    providerSettings(settings.activeProvider).model = (e.target as HTMLSelectElement).value;
    void persist("Model saved.");
  });
  $<HTMLInputElement>("remember").addEventListener("change", async (e) => {
    settings.rememberKeys = (e.target as HTMLInputElement).checked;
    for (const a of listAdapters()) await moveApiKey(stores, a.id, settings.rememberKeys);
    await persist(settings.rememberKeys ? "Key will be remembered." : "Key will be forgotten when the browser closes.");
  });
  $<HTMLInputElement>("allow-insert-anyway").addEventListener("change", (e) => {
    settings.allowInsertAnyway = (e.target as HTMLInputElement).checked;
    void persist();
  });
  $<HTMLInputElement>("consent").addEventListener("change", (e) => {
    const p = providerSettings(settings.activeProvider);
    if ((e.target as HTMLInputElement).checked) {
      p.consentAcceptedAt = new Date().toISOString();
      p.consentTextVersion = CONSENT_TEXT_VERSION;
    } else {
      p.consentAcceptedAt = null;
      p.consentTextVersion = 0;
    }
    renderConsent();
    void renderKeyState();
    void persist(p.consentAcceptedAt ? "Consent saved." : "Consent withdrawn. Enhancement is disabled until you accept again.");
  });
}

void init();
