import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { enhancePrompt } from "../src/engine/pipeline";
import { INSTRUCTIONS_VERSION } from "../src/engine/instructions/system";
import { createGroqAdapter } from "../src/providers/groq/adapter";
import { GROQ_DEFAULT_MODEL } from "../src/providers/groq/config";
import { withRetry } from "../src/providers/retry";
import { checkItem, type DatasetItem } from "./checks";
import dataset from "./dataset.json";

/**
 * OPT-IN live evaluation against the real Groq API (plan D7). Skipped unless GROQ_API_KEY is set.
 * The key is read from the environment only; it is never written to the report or logs.
 * Usage: GROQ_API_KEY=... [EVAL_MODEL=...] [EVAL_LIMIT=10] npm run eval:live
 */
const KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.EVAL_MODEL ?? GROQ_DEFAULT_MODEL;
const LIMIT = Number(process.env.EVAL_LIMIT ?? "0") || undefined;
const PACE_MS = Number(process.env.EVAL_PACE_MS ?? "2500"); // stay well under free-tier RPM

describe.skipIf(!KEY)("live Groq evaluation", () => {
  it("runs the dataset and writes a report", async () => {
    const adapter = createGroqAdapter();
    const items = (dataset.items as DatasetItem[]).slice(0, LIMIT);
    const rows: unknown[] = [];
    let parsedOk = 0;
    let checksOk = 0;
    const latencies: number[] = [];
    for (const item of items) {
      const started = Date.now();
      const signal = new AbortController().signal;
      const outcome = await enhancePrompt(item.input, {
        mode: item.mode,
        adapter: { ...adapter, complete: (r, c) => withRetry(() => adapter.complete(r, c), { signal }) },
        call: { apiKey: KEY!, model: MODEL, signal },
      });
      const ms = Date.now() - started;
      latencies.push(ms);
      const result = outcome.kind === "enhanced" || outcome.kind === "unchanged" ? outcome.result : null;
      if (result || outcome.kind === "blocked") parsedOk++;
      const check = result ? checkItem(item, result) : { id: item.id, passed: false, failures: [outcome.kind] };
      if (check.passed) checksOk++;
      rows.push({
        id: item.id, category: item.category, mode: item.mode, ms, outcome: outcome.kind,
        error: outcome.kind === "error" ? `${outcome.error.kind}: ${outcome.error.message}` : undefined,
        issues: outcome.kind === "blocked" ? outcome.issues.map((i) => i.code) : undefined,
        input: item.input, output: result?.enhanced_prompt ?? (outcome.kind === "blocked" ? outcome.text : null),
        task_type: result?.task_type, techniques: result?.techniques, checks: check.failures,
      });
      await new Promise((r) => setTimeout(r, PACE_MS));
    }
    const sorted = [...latencies].sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
    const summary = {
      date: new Date().toISOString(), model: MODEL, instructionsVersion: INSTRUCTIONS_VERSION, items: items.length,
      parseRate: parsedOk / items.length, deterministicPassRate: checksOk / items.length, p50ms: pct(50), p95ms: pct(95),
    };
    await mkdir("eval/reports", { recursive: true });
    await writeFile(`eval/reports/live-${summary.date.slice(0, 10)}-${MODEL.replace(/\W+/g, "_")}.json`, JSON.stringify({ summary, rows }, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    expect(items.length).toBeGreaterThan(0);
  }, 30 * 60_000);
});
