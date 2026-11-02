import { defineConfig } from "vitest/config";

// Live evaluation against the real Groq API. Opt-in: skipped unless GROQ_API_KEY is set (plan D7).
export default defineConfig({
  define: { __TEST__: "false", __GROQ_BASE_URL__: JSON.stringify("https://api.groq.com/openai/v1") },
  test: {
    include: ["eval/**/*.eval.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
