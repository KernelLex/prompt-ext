import { describe, expect, it } from "vitest";
import { hintTaskType } from "../../src/engine/classify-hint";
import { MAX_INPUT_CHARS, validateInput } from "../../src/engine/input-validation";

describe("validateInput", () => {
  it("rejects empty, whitespace, and too-short text", () => {
    expect(validateInput("")).toMatchObject({ ok: false, reason: "empty" });
    expect(validateInput("   \n ")).toMatchObject({ ok: false, reason: "empty" });
    expect(validateInput("a b")).toMatchObject({ ok: false, reason: "too_short" });
  });
  it("rejects text over the size cap", () => {
    expect(validateInput("x".repeat(MAX_INPUT_CHARS + 1))).toMatchObject({ ok: false, reason: "too_long" });
    expect(validateInput("x".repeat(MAX_INPUT_CHARS))).toMatchObject({ ok: true });
  });
  it("flags possible secrets without blocking", () => {
    expect(validateInput("use key gsk_abcdefghijklmnopqrstuvwxyz123456 to call it")).toEqual({ ok: true, possibleSecret: true });
    expect(validateInput("-----BEGIN RSA PRIVATE KEY-----\nabc")).toEqual({ ok: true, possibleSecret: true });
    expect(validateInput("explain how API keys work")).toEqual({ ok: true, possibleSecret: false });
  });
});

describe("hintTaskType", () => {
  it.each([
    ["write a python script that removes duplicate rows from a csv", "coding"],
    ["Fix this bug:\n```js\nconst a = 1\n```", "coding"],
    ["Find recent studies and sources on intermittent fasting", "research"],
    ["Analyze the pros and cons of remote work for a startup", "analysis"],
    ["Plan a 5 day itinerary for Lisbon", "planning"],
    ["Write a short poem about autumn", "creative"],
    ["Draft an email to my manager asking for Friday off", "writing"],
    ["What is the boiling point of water at sea level?", "factual"],
    ["hello there", "other"],
  ])("%s → %s", (text, expected) => {
    expect(hintTaskType(text)).toBe(expected);
  });
});
