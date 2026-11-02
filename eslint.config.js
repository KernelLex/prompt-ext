import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "dist-test/", "node_modules/", "test-results/", "playwright-report/", "docs/prototype/", "tests/fixtures/build/", "report/build/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      // Keys and prompts must never reach the console in production code. Use shared/debug.ts.
      "no-console": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-properties": [
        "error",
        { property: "innerHTML", message: "Never write HTML from data. Build DOM nodes or use textContent." },
        { property: "outerHTML", message: "Never write HTML from data." },
      ],
    },
  },
  {
    files: ["scripts/**/*.mjs", "report/**/*.mjs", "tests/**/*.{ts,tsx,mjs}", "eval/**/*.ts"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly" } },
  },
  {
    // Test code drives the browser through untyped globals (window.__pmText, chrome APIs in evaluate()).
    files: ["tests/**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: ["tests/fixtures/**/*.js"],
    languageOptions: { globals: { window: "readonly", document: "readonly" } },
  },
);
