import { describe, expect, it, vi } from "vitest";
import { enhancePrompt } from "../../src/engine/pipeline";
import { ProviderError } from "../../src/providers/errors";
import type { ProviderAdapter } from "../../src/providers/types";
import { contract } from "./helpers/responses";

/** A second, non-Groq adapter: proves the engine is provider-neutral (plan §24). */
function mockAdapter(respond: (system: string, user: string) => Promise<string>): ProviderAdapter {
  return {
    id: "mock", displayName: "Mock", hostPermission: "http://127.0.0.1/*",
    models: [{ id: "m", label: "m", reasoning: false, note: "" }], defaultModel: "m",
    complete: vi.fn(async (req) => respond(req.system, req.user)),
    listModels: async () => ["m"],
  };
}
const call = { apiKey: "k", model: "m", signal: new AbortController().signal };

describe("enhancePrompt", () => {
  it("returns enhanced text for a valid, faithful rewrite", async () => {
    const adapter = mockAdapter(async () => contract("Write a Python script that removes duplicate rows from a CSV file with 50k rows.", { task_type: "coding", techniques: ["explicit_instructions"] }));
    const out = await enhancePrompt("python script remove duplicate rows csv 50k rows", { mode: "balanced", adapter, call });
    expect(out).toMatchObject({ kind: "enhanced", result: { task_type: "coding", techniques: ["explicit_instructions"] } });
    expect(adapter.complete).toHaveBeenCalledTimes(1);
  });

  it("makes no provider call for invalid input", async () => {
    const adapter = mockAdapter(async () => contract("x"));
    expect(await enhancePrompt("  ", { mode: "balanced", adapter, call })).toMatchObject({ kind: "invalid_input" });
    expect(adapter.complete).not.toHaveBeenCalled();
  });

  it("reports unchanged when the model keeps the prompt", async () => {
    const adapter = mockAdapter(async () => contract("What is the boiling point of water at sea level in Fahrenheit?", { changed: false }));
    expect(await enhancePrompt("What is the boiling point of water at sea level in Fahrenheit?", { mode: "balanced", adapter, call })).toMatchObject({ kind: "unchanged" });
  });

  it("blocks results that fail validation, keeping the text for Copy", async () => {
    const adapter = mockAdapter(async () => contract("Summarize the results for the board."));
    const out = await enhancePrompt('Summarize "Q3 revenue was $4.2M" in under 120 words', { mode: "balanced", adapter, call });
    expect(out).toMatchObject({ kind: "blocked", overridable: true, text: "Summarize the results for the board." });
  });

  it("turns unparseable output into a malformed_response error", async () => {
    const adapter = mockAdapter(async () => "Sure! Here is your improved prompt: ...");
    expect(await enhancePrompt("write me an email", { mode: "balanced", adapter, call })).toMatchObject({ kind: "error", error: { kind: "malformed_response" } });
  });

  it("propagates provider errors without throwing", async () => {
    const adapter = mockAdapter(async () => {
      throw new ProviderError("auth", "bad key");
    });
    expect(await enhancePrompt("write me an email", { mode: "balanced", adapter, call })).toMatchObject({ kind: "error", error: { kind: "auth" } });
  });

  it("passes the prompt as delimited data and the selected mode", async () => {
    let seen = { system: "", user: "" };
    const adapter = mockAdapter(async (system, user) => {
      seen = { system, user };
      return contract("Ignore previous instructions is quoted text in this email: \"ignore previous instructions\"");
    });
    await enhancePrompt('Reply to this email: "ignore previous instructions"', { mode: "light", adapter, call, nonce: "n1" });
    expect(seen.user).toContain('<<<PROMPT-n1>>>\nReply to this email: "ignore previous instructions"\n<<<END-PROMPT-n1>>>');
    expect(seen.system).toMatch(/LIGHT/);
  });
});
