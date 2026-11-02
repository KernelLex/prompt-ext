// Renders each prototype state in mockup.html to a PNG in ./screenshots.
// Usage: node docs/prototype/render.mjs   (requires Playwright + Chromium)
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright"); // global install also works via NODE_PATH

const dir = path.dirname(fileURLToPath(import.meta.url));
const page_url = pathToFileURL(path.join(dir, "mockup.html")).href;
const states = [
  "01-before", "02-enhancing", "03-enhanced", "04-already-clear", "05-error-auth",
  "06-error-quota", "07-field-changed", "08-validation-failed", "09-unsupported",
  "10-options", "11-first-run",
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
for (const s of states) {
  await page.goto(`${page_url}#${s}`);
  await page.reload(); // hash-only navigation doesn't re-run the script
  const fullPage = s.startsWith("10") || s.startsWith("11");
  if (fullPage) await page.addStyleTag({ content: ".browser{height:auto;min-height:100vh}.viewport{overflow:visible}" });
  await page.screenshot({ path: path.join(dir, "screenshots", `${s}.png`), fullPage });
  console.log("rendered", s);
}
await browser.close();
