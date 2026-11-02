import { afterEach, describe, expect, it, vi } from "vitest";
import { blockedUntil, DEFAULT_BLOCK_MS, resetCircuit, tripCircuit } from "../../src/providers/circuit";
import { describeError, ProviderError, type ProviderErrorKind } from "../../src/providers/errors";
import { createGroqAdapter, parseRetryHint } from "../../src/providers/groq/adapter";
import { GROQ_DEFAULT_MODEL, GROQ_MODELS } from "../../src/providers/groq/config";
import { withRetry } from "../../src/providers/retry";
import { FakeStorage } from "./helpers/fake-storage";
import { groqErr, groqOk } from "./helpers/responses";

const KEY = "gsk_TESTKEY0000000000000000000000000000";
const req = { system: "SYS", user: "USER", maxOutputTokens: 500, temperature: 0.2 };
const ctx = (model = "llama-3.3-70b-versatile") => ({ apiKey: KEY, model, signal: new AbortController().signal });

afterEach(() => vi.unstubAllGlobals());

function stubFetch(...responses: Array<Response | Error>) {
  const fn = vi.fn();
  for (const r of responses) fn.mockImplementationOnce(async () => (r instanceof Error ? Promise.reject(r) : r));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("Groq adapter — request", () => {
  it("sends key only in the Authorization header, JSON mode, bounded tokens", async () => {
    const fetchMock = stubFetch(groqOk('{"enhanced_prompt":"x"}'));
    const adapter = createGroqAdapter("https://api.groq.com/openai/v1");
    await adapter.complete(req, ctx());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(url).not.toContain(KEY);
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(init.credentials).toBe("omit");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: "llama-3.3-70b-versatile", response_format: { type: "json_object" }, max_completion_tokens: 500, stream: false });
    expect(body.messages).toEqual([{ role: "system", content: "SYS" }, { role: "user", content: "USER" }]);
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("adds reasoning headroom and low effort for reasoning models", async () => {
    const fetchMock = stubFetch(groqOk('{"enhanced_prompt":"x"}'));
    await createGroqAdapter().complete(req, ctx("openai/gpt-oss-120b"));
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.reasoning_effort).toBe("low");
    expect(body.max_completion_tokens).toBeGreaterThan(500);
  });

  it("default model is in the allowlist", () => {
    expect(GROQ_MODELS.map((m) => m.id)).toContain(GROQ_DEFAULT_MODEL);
  });

  it("listModels returns ids", async () => {
    stubFetch(new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }, { nope: 1 }] }), { status: 200 }));
    expect(await createGroqAdapter().listModels({ apiKey: KEY, signal: new AbortController().signal })).toEqual(["a", "b"]);
  });
});

describe("Groq adapter — error mapping", () => {
  const cases: Array<[string, Response | Error, ProviderErrorKind]> = [
    ["401", groqErr(401, "Invalid API Key"), "auth"],
    ["403", groqErr(403, "Forbidden"), "forbidden"],
    ["404", groqErr(404, "The model `x` does not exist"), "model_unavailable"],
    ["400 decommissioned", groqErr(400, "The model `x` has been decommissioned"), "model_unavailable"],
    ["400 json_validate_failed", groqErr(400, "Failed to generate JSON", {}, "json_validate_failed"), "malformed_response"],
    ["400 other", groqErr(400, "bad param"), "invalid_request"],
    ["413", groqErr(413, "too large"), "invalid_request"],
    ["429 per-minute", groqErr(429, "Rate limit reached on tokens per minute (TPM)", { "retry-after": "2" }), "rate_limited"],
    ["429 per-day", groqErr(429, "Rate limit reached on requests per day (RPD): Limit 1000", { "retry-after": "3600" }), "quota_exhausted"],
    ["500", groqErr(500, "internal"), "server"],
    ["503", groqErr(503, "over capacity"), "server"],
    ["network", new TypeError("Failed to fetch"), "network"],
    ["truncated", groqOk('{"enhanced_prompt":"x', "length"), "malformed_response"],
    ["empty content", groqOk(""), "malformed_response"],
    ["non-json body", new Response("<html>gateway</html>", { status: 200 }), "malformed_response"],
  ];
  it.each(cases)("%s", async (_name, response, kind) => {
    stubFetch(response);
    await expect(createGroqAdapter().complete(req, ctx())).rejects.toMatchObject({ kind });
  });

  it("maps a timeout and a user cancel distinctly", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      await new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));
    }));
    const c = new AbortController();
    const p = createGroqAdapter().complete(req, { apiKey: KEY, model: "m", signal: c.signal });
    c.abort(new DOMException("x", "AbortError"));
    await expect(p).rejects.toMatchObject({ kind: "cancelled" });
    expect(ProviderError.from(new DOMException("t", "TimeoutError")).kind).toBe("timeout");
  });

  it("never leaks the key in error messages", async () => {
    stubFetch(groqErr(401, `Invalid API Key provided: ${KEY}`));
    const err = (await createGroqAdapter().complete(req, ctx()).catch((e) => e)) as ProviderError;
    expect(err.message).not.toContain(KEY);
    expect(err.message).toContain("[redacted]");
    expect(JSON.stringify(describeError(err, "Groq"))).not.toContain(KEY);
  });

  it("parses retry hints", () => {
    expect(parseRetryHint(new Headers({ "retry-after": "7" }))).toBe(7000);
    expect(parseRetryHint(new Headers({ "x-ratelimit-reset-requests": "2m59.56s" }))).toBe(179560);
    expect(parseRetryHint(new Headers({ "x-ratelimit-reset-tokens": "120ms" }))).toBe(120);
    expect(parseRetryHint(new Headers())).toBeUndefined();
  });
});

describe("withRetry", () => {
  const signal = new AbortController().signal;
  const sleep = vi.fn(async () => undefined);

  it("retries a transient error exactly once", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new ProviderError("server", "x")).mockResolvedValueOnce("ok");
    expect(await withRetry(fn, { signal, sleep })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("gives up after one retry (no loops)", async () => {
    const fn = vi.fn().mockRejectedValue(new ProviderError("network", "x"));
    await expect(withRetry(fn, { signal, sleep })).rejects.toMatchObject({ kind: "network" });
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it.each(["auth", "quota_exhausted", "invalid_request", "model_unavailable", "malformed_response", "cancelled"] as const)(
    "never retries %s",
    async (kind) => {
      const fn = vi.fn().mockRejectedValue(new ProviderError(kind, "x"));
      await expect(withRetry(fn, { signal, sleep })).rejects.toMatchObject({ kind });
      expect(fn).toHaveBeenCalledTimes(1);
    },
  );
  it("does not wait on long rate-limit hints", async () => {
    const fn = vi.fn().mockRejectedValue(new ProviderError("rate_limited", "x", { retryAfterMs: 60_000 }));
    await expect(withRetry(fn, { signal, sleep })).rejects.toMatchObject({ kind: "rate_limited" });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("circuit breaker", () => {
  it("blocks after quota exhaustion until reset, then clears", async () => {
    const store = new FakeStorage();
    const now = 1_000_000;
    expect(await blockedUntil(store, "groq", now)).toBeNull();
    await tripCircuit(store, "groq", undefined, now);
    expect(await blockedUntil(store, "groq", now + 1)).toBe(now + DEFAULT_BLOCK_MS);
    expect(await blockedUntil(store, "groq", now + DEFAULT_BLOCK_MS + 1)).toBeNull();
    await tripCircuit(store, "groq", 5000, now);
    await resetCircuit(store, "groq");
    expect(await blockedUntil(store, "groq", now)).toBeNull();
  });
});

describe("describeError", () => {
  it("always reassures that the text was not changed and offers sensible actions", () => {
    for (const kind of ["auth", "quota_exhausted", "rate_limited", "server", "timeout", "network", "malformed_response", "model_unavailable"] as const) {
      const d = describeError(new ProviderError(kind, "detail"), "Groq");
      expect(d.detail, kind).toMatch(/not changed/);
      expect(d.actions.length, kind).toBeGreaterThan(0);
    }
    expect(describeError(new ProviderError("auth", ""), "Groq").actions).toContain("settings");
    expect(describeError(new ProviderError("quota_exhausted", ""), "Groq").actions).toContain("force_retry");
  });
});
