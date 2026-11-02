// Builds the extension into dist/ (production) or dist-test/ (--test: local mock provider + test hook).
// Usage: node scripts/build.mjs [--test] [--watch]
import * as esbuild from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isTest = process.argv.includes("--test");
const watch = process.argv.includes("--watch");
const outdir = path.join(root, isTest ? "dist-test" : "dist");

export const PROD_GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const TEST_MOCK_ORIGIN = process.env.MOCK_PROVIDER_ORIGIN ?? "http://127.0.0.1:4599";

const define = {
  __TEST__: JSON.stringify(isTest),
  __GROQ_BASE_URL__: JSON.stringify(isTest ? `${TEST_MOCK_ORIGIN}/openai/v1` : PROD_GROQ_BASE_URL),
};

const common = {
  bundle: true,
  target: "chrome116",
  define,
  minifySyntax: true, // folds `if (__TEST__)` so test-only code is removed from production builds
  legalComments: "none",
  logLevel: "warning",
  sourcemap: isTest ? "inline" : false,
};

async function copyStatic() {
  await mkdir(path.join(outdir, "icons"), { recursive: true });
  await cp(path.join(root, "static/icons"), path.join(outdir, "icons"), { recursive: true });
  await cp(path.join(root, "src/options/options.html"), path.join(outdir, "options.html"));
  await cp(path.join(root, "src/options/options.css"), path.join(outdir, "options.css"));
  const manifest = JSON.parse(await readFile(path.join(root, "static/manifest.json"), "utf8"));
  if (isTest) {
    // Test-only: lets Playwright inject into local fixture pages without a toolbar gesture, and
    // lets the service worker reach the local mock provider. Never present in production builds.
    manifest.name += " (TEST BUILD)";
    manifest.host_permissions = ["http://127.0.0.1/*"];
    manifest.optional_host_permissions = ["http://127.0.0.1/*"];
  }
  await writeFile(path.join(outdir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const builds = [
  { entryPoints: [path.join(root, "src/background/index.ts")], outfile: path.join(outdir, "background.js"), format: "esm" },
  { entryPoints: [path.join(root, "src/content/index.ts")], outfile: path.join(outdir, "content.js"), format: "iife" },
  { entryPoints: [path.join(root, "src/options/options.ts")], outfile: path.join(outdir, "options.js"), format: "iife" },
];

if (watch) {
  for (const b of builds) await (await esbuild.context({ ...common, ...b })).watch();
  await copyStatic();
  console.log(`Watching… output in ${path.relative(root, outdir)}/`);
} else {
  await Promise.all(builds.map((b) => esbuild.build({ ...common, ...b })));
  await copyStatic();
  console.log(`Built ${isTest ? "TEST" : "production"} extension → ${path.relative(root, outdir)}/`);
}
