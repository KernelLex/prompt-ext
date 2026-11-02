import { MODES, type Mode } from "../engine/types";

/** Bump when the disclosure text changes materially; users are asked to consent again. */
export const CONSENT_TEXT_VERSION = 1;

export interface ProviderSettings {
  model: string | null;
  consentAcceptedAt: string | null;
  consentTextVersion: number;
}

export interface Settings {
  schemaVersion: 1;
  activeProvider: string;
  mode: Mode;
  providers: Record<string, ProviderSettings>;
  /** false → keys live in chrome.storage.session and vanish when the browser closes. */
  rememberKeys: boolean;
  /** D3: off by default. Even when on, only offered for overridable validation failures. */
  allowInsertAnyway: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  activeProvider: "groq",
  mode: "balanced",
  providers: {},
  rememberKeys: true,
  allowInsertAnyway: false,
};

export function emptyProviderSettings(): ProviderSettings {
  return { model: null, consentAcceptedAt: null, consentTextVersion: 0 };
}

/** Validates/migrates whatever is in storage into a well-formed Settings object. Never throws. */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== "object" || raw === null) return structuredClone(DEFAULT_SETTINGS);
  const r = raw as Record<string, unknown>;
  const providers: Record<string, ProviderSettings> = {};
  if (typeof r.providers === "object" && r.providers !== null) {
    for (const [id, value] of Object.entries(r.providers as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const v = value as Record<string, unknown>;
      providers[id] = {
        model: typeof v.model === "string" ? v.model : null,
        consentAcceptedAt: typeof v.consentAcceptedAt === "string" ? v.consentAcceptedAt : null,
        consentTextVersion: typeof v.consentTextVersion === "number" ? v.consentTextVersion : 0,
      };
    }
  }
  return {
    schemaVersion: 1,
    activeProvider: typeof r.activeProvider === "string" ? r.activeProvider : DEFAULT_SETTINGS.activeProvider,
    mode: MODES.includes(r.mode as Mode) ? (r.mode as Mode) : DEFAULT_SETTINGS.mode,
    providers,
    rememberKeys: typeof r.rememberKeys === "boolean" ? r.rememberKeys : DEFAULT_SETTINGS.rememberKeys,
    allowInsertAnyway: typeof r.allowInsertAnyway === "boolean" ? r.allowInsertAnyway : DEFAULT_SETTINGS.allowInsertAnyway,
  };
}

export function hasValidConsent(settings: Settings, providerId: string): boolean {
  const p = settings.providers[providerId];
  return !!p?.consentAcceptedAt && p.consentTextVersion >= CONSENT_TEXT_VERSION;
}
