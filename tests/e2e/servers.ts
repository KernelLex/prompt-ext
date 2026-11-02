import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

/**
 * Local test servers. The mock provider imitates the subset of Groq's OpenAI-compatible API the
 * extension uses. Its responses are canned test data — NOT real model output.
 */
export type Scenario =
  | "ok" | "demo" | "unchanged" | "answer" | "drop_details" | "malformed" | "auth" | "quota" | "rate_limit" | "server_error" | "slow";

export interface MockState {
  scenario: Scenario;
  delayMs: number;
  requests: Array<{ path: string; auth: string | undefined; body: unknown }>;
}

export const DEMO_ENHANCED = `Write a Python script that cleans a CSV file with about 50k rows.

Requirements:
1. Remove duplicate rows.
2. Fix the dates by converting every date column to one consistent format.
3. Save the cleaned data to a new CSV file and leave the original file unchanged.

Before writing the code, ask me concise clarifying questions about anything critical you can't infer, such as which columns contain dates and what counts as a duplicate.

Return the complete script with brief comments and a short note on how to run it.`;

function extractPrompt(user: string): string {
  const m = /<<<PROMPT-([0-9a-f]+)>>>\n([\s\S]*)\n<<<END-PROMPT-\1>>>/.exec(user);
  return m?.[2] ?? "";
}

function completion(content: string) {
  return { id: "mock", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] };
}

export function startMockProvider(port: number): Promise<{ state: MockState; close: () => Promise<void> }> {
  const state: MockState = { scenario: "ok", delayMs: 0, requests: [] };
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/openai/v1/models" && req.method === "GET") {
      state.requests.push({ path: req.url, auth: req.headers.authorization, body: null });
      return send(200, { data: [{ id: "openai/gpt-oss-120b" }, { id: "llama-3.3-70b-versatile" }] });
    }
    if (req.url !== "/openai/v1/chat/completions" || req.method !== "POST") return send(404, { error: { message: "not found" } });

    const body = JSON.parse(raw) as { messages: Array<{ role: string; content: string }> };
    state.requests.push({ path: req.url, auth: req.headers.authorization, body });
    const prompt = extractPrompt(body.messages.find((m) => m.role === "user")?.content ?? "");
    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));

    const ok = (enhanced: string, extra: Record<string, unknown> = {}) =>
      send(200, completion(JSON.stringify({ enhanced_prompt: enhanced, changed: true, task_type: "other", techniques: ["explicit_instructions"], missing_info: [], notes: "Made the request explicit.", ...extra })));

    switch (state.scenario) {
      case "ok":
      case "slow":
        return ok(`Please complete the following request clearly and concisely.\n\n${prompt}`);
      case "demo":
        return ok(DEMO_ENHANCED, { task_type: "coding", techniques: ["explicit_instructions", "output_format", "context_enrichment"], notes: "Listed the requirements, defined the output, and asked for clarification instead of guessing." });
      case "unchanged":
        return ok(prompt, { changed: false, task_type: "factual", techniques: [] });
      case "answer":
        return ok("Sure! Here is the answer you asked for: 42.");
      case "drop_details":
        return ok("Summarize the quarterly results for the board.");
      case "malformed":
        return send(200, completion("I improved your prompt: make it better"));
      case "auth":
        return send(401, { error: { message: "Invalid API Key", type: "invalid_request_error", code: "invalid_api_key" } });
      case "quota":
        return send(429, { error: { message: "Rate limit reached on requests per day (RPD): Limit 1000, Used 1000", type: "requests", code: "rate_limit_exceeded" } }, { "retry-after": "3600" });
      case "rate_limit":
        return send(429, { error: { message: "Rate limit reached on tokens per minute (TPM)", type: "tokens", code: "rate_limit_exceeded" } }, { "retry-after": "1" });
      case "server_error":
        return send(503, { error: { message: "Service unavailable" } });
    }
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve({ state, close: () => new Promise((r) => server.close(() => r())) })),
  );
}

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

/** Serves tests/fixtures on all interfaces so http://localhost is a different origin than http://127.0.0.1. */
export function startFixtureServer(port: number, dir: string): Promise<{ close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]!).replace(/^\/+/, "");
    const file = path.join(dir, rel);
    if (!file.startsWith(dir)) return void res.writeHead(403).end();
    try {
      const data = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ close: () => new Promise((r) => server.close(() => r())) })));
}
