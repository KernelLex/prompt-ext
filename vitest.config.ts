import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __TEST__: "false", __GROQ_BASE_URL__: JSON.stringify("https://api.groq.com/openai/v1") },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
