import { chromium, expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("production build (dist/) loads in Chromium with no errors and minimal permissions", async () => {
  const ext = path.join(ROOT, "dist");
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "pe-prod-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    viewport: { width: 1100, height: 760 },
  });
  try {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const id = new URL(sw.url()).host;
    const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.name).toBe("Prompt Enhancer");
    expect(manifest.permissions?.sort()).toEqual(["activeTab", "scripting", "storage"]);
    expect(manifest.host_permissions ?? []).toEqual([]);
    expect(await sw.evaluate(() => typeof (globalThis as any).__peTest)).toBe("undefined"); // no test hook
    const commands = await sw.evaluate(() => chrome.commands.getAll());
    expect(commands.map((c) => c.name).sort()).toEqual(["_execute_action", "enhance-prompt", "restore-original"].filter((n) => commands.some((c) => c.name === n)).sort());
    expect(commands.find((c) => c.name === "enhance-prompt")?.shortcut).toBe("Alt+Shift+E");

    // Install opens the welcome/options page.
    const optionsPage = context.pages().find((p) => p.url().includes("options.html")) ?? (await context.waitForEvent("page"));
    await expect(optionsPage.locator("#welcome")).toBeVisible();

    if (process.env.SCREENSHOTS) {
      const out = path.join(ROOT, "report/assets/screenshots");
      const page = await context.newPage();
      await page.goto("chrome://extensions");
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(out, "20-chrome-extensions-loaded.png") });
      await page.goto(`chrome://extensions/?id=${id}`);
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(out, "21-chrome-extension-details.png") });
    }
    expect(JSON.parse(await readFile(path.join(ext, "manifest.json"), "utf8")).version).toBe("0.1.0");
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
