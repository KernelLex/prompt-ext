// Renders the report diagrams (HTML/SVG) to PNG with Playwright's Chromium.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const dir = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
for (const [name, w, h] of [["architecture", 1200, 760], ["pipeline", 1200, 230]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(pathToFileURL(path.join(dir, `${name}.html`)).href);
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}
await browser.close();
console.log("diagrams rendered");
