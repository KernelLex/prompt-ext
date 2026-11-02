import { describe, expect, it } from "vitest";
import { getApiKey, moveApiKey, removeApiKey, setApiKey } from "../../src/settings/credentials";
import { CONSENT_TEXT_VERSION, DEFAULT_SETTINGS, hasValidConsent, parseSettings } from "../../src/settings/schema";
import { loadSettings, saveSettings } from "../../src/settings/store";
import { looksLikeSecret, maskKey, redact } from "../../src/shared/redact";
import { normalizeForCompare, toSingleLine } from "../../src/shared/text";
import { FakeStorage } from "./helpers/fake-storage";

describe("settings", () => {
  it("defaults: Groq, Balanced, remember keys, Insert anyway off", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ activeProvider: "groq", mode: "balanced", rememberKeys: true, allowInsertAnyway: false });
  });
  it("repairs malformed stored data", () => {
    expect(parseSettings({ mode: "extreme", rememberKeys: "yes", providers: { groq: { model: 3 } } })).toMatchObject({
      mode: "balanced", rememberKeys: true, providers: { groq: { model: null, consentAcceptedAt: null } },
    });
  });
  it("round-trips through storage", async () => {
    const local = new FakeStorage();
    await saveSettings(local, { ...DEFAULT_SETTINGS, mode: "deep" });
    expect((await loadSettings(local)).mode).toBe("deep");
  });
  it("requires consent at the current disclosure version", () => {
    const s = parseSettings({ providers: { groq: { consentAcceptedAt: "2026-11-02T00:00:00Z", consentTextVersion: CONSENT_TEXT_VERSION } } });
    expect(hasValidConsent(s, "groq")).toBe(true);
    expect(hasValidConsent(parseSettings({ providers: { groq: { consentAcceptedAt: "x", consentTextVersion: 0 } } }), "groq")).toBe(false);
    expect(hasValidConsent(s, "gemini")).toBe(false);
  });
});

describe("credentials", () => {
  const stores = () => ({ local: new FakeStorage(), session: new FakeStorage() });
  it("stores in exactly one place depending on preference", async () => {
    const s = stores();
    await setApiKey(s, "groq", " gsk_abc ", true);
    expect(s.local.data.get("cred:groq")).toBe("gsk_abc");
    expect(s.session.data.size).toBe(0);
    await moveApiKey(s, "groq", false);
    expect(s.local.data.size).toBe(0);
    expect(await getApiKey(s, "groq")).toBe("gsk_abc");
    await removeApiKey(s, "groq");
    expect(await getApiKey(s, "groq")).toBeNull();
  });
  it("never stores keys inside the settings object", async () => {
    const s = stores();
    await setApiKey(s, "groq", "gsk_abc", true);
    expect(JSON.stringify(await loadSettings(s.local))).not.toContain("gsk_abc");
  });
  it("rejects empty keys", async () => {
    await expect(setApiKey(stores(), "groq", "  ", true)).rejects.toThrow();
  });
});

describe("redaction and text helpers", () => {
  it("redacts key-like strings", () => {
    const out = redact("bad key gsk_ABCDEFGHIJKLMNOP1234 and AIzaSyA1234567890abcdefghijk and Bearer abc.def.ghi and ?key=secret123");
    expect(out).not.toMatch(/gsk_ABC|AIzaSy|abc\.def|secret123/);
  });
  it("masks keys", () => {
    expect(maskKey("gsk_1234567890abcdef")).toBe("gsk_••••••••••••cdef");
    expect(maskKey("short")).toBe("••••");
  });
  it("detects secrets", () => {
    expect(looksLikeSecret("AKIAABCDEFGHIJKLMNOP")).toBe(true);
    expect(looksLikeSecret("my password is weak")).toBe(false);
  });
  it("normalizes text for comparison", () => {
    expect(normalizeForCompare(" a b\n\n c​ ")).toBe("a b c");
    expect(toSingleLine("a\n\nb\n c")).toBe("a b c");
  });
});
