import { test as base, chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import * as esbuild from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer, startMockProvider, type MockState, type Scenario } from "./servers";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const FIXTURE_ORIGIN = "http://127.0.0.1:4598";
const MOCK_PORT = 4599;
export const TEST_KEY = "test-key-not-a-real-credential";

async function buildFixtureBundles(): Promise<void> {
  const dir = path.join(ROOT, "tests/fixtures");
  await esbuild.build({
    entryPoints: { react: path.join(dir, "src/react.tsx"), prosemirror: path.join(dir, "src/prosemirror.ts") },
    outdir: path.join(dir, "build"),
    bundle: true,
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  });
}

interface Fixtures {
  page: Page;
  ext: Ext;
}
interface WorkerFixtures {
  env: { context: BrowserContext; sw: Worker; mock: MockState; extensionId: string };
}

export class Ext {
  constructor(private readonly sw: Worker, readonly mock: MockState, readonly id: string) {}

  scenario(s: Scenario, delayMs = 0): void {
    this.mock.scenario = s;
    this.mock.delayMs = delayMs;
  }

  get completionRequests() {
    return this.mock.requests.filter((r) => r.path.endsWith("/chat/completions"));
  }

  /** Same code path as the toolbar button / shortcut (test-build hook, see plan §25 I4). */
  async trigger(force = false): Promise<void> {
    await this.sw.evaluate(async (force) => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      await (globalThis as any).__peTest.runEnhancement(tab!.id, { force });
    }, force);
  }

  triggerNoWait(): Promise<void> {
    return this.trigger();
  }

  async restore(): Promise<void> {
    await this.sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      await (globalThis as any).__peTest.runRestore(tab!.id);
    });
  }

  async configure(opts: { consent?: boolean; key?: boolean; mode?: string; allowInsertAnyway?: boolean } = {}): Promise<void> {
    const { consent = true, key = true, mode = "balanced", allowInsertAnyway = false } = opts;
    await this.sw.evaluate(
      async ({ consent, key, mode, allowInsertAnyway, testKey }) => {
        await chrome.storage.local.clear();
        await chrome.storage.session.clear();
        await chrome.storage.local.set({
          settings: {
            schemaVersion: 1, activeProvider: "groq", mode, rememberKeys: true, allowInsertAnyway,
            providers: { groq: { model: "openai/gpt-oss-120b", consentAcceptedAt: consent ? new Date().toISOString() : null, consentTextVersion: consent ? 1 : 0 } },
          },
          ...(key ? { "cred:groq": testKey } : {}),
        });
      },
      { consent, key, mode, allowInsertAnyway, testKey: TEST_KEY },
    );
  }
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  env: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await buildFixtureBundles();
      const fixtures = await startFixtureServer(4598, path.join(ROOT, "tests/fixtures"));
      const provider = await startMockProvider(MOCK_PORT);
      const userDataDir = await mkdtemp(path.join(os.tmpdir(), "pe-e2e-"));
      const extPath = path.join(ROOT, "dist-test");
      const context = await chromium.launchPersistentContext(userDataDir, {
        channel: "chromium", // full Chromium (new headless) — required for extensions
        headless: true,
        args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
        viewport: { width: 1100, height: 760 },
      });
      let [sw] = context.serviceWorkers();
      sw ??= await context.waitForEvent("serviceworker");
      const extensionId = new URL(sw.url()).host;
      // Close the welcome/options tab opened on install so tests start clean.
      for (const p of context.pages()) if (p.url().startsWith("chrome-extension://")) await p.close();
      await use({ context, sw, mock: provider.state, extensionId });
      await context.close();
      await provider.close();
      await fixtures.close();
      await rm(userDataDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  page: async ({ env }, use) => {
    const page = await env.context.newPage();
    await page.bringToFront();
    await use(page);
    await page.close();
  },
  ext: async ({ env }, use) => {
    env.mock.requests.length = 0;
    env.mock.scenario = "ok";
    env.mock.delayMs = 0;
    const ext = new Ext(env.sw, env.mock, env.extensionId);
    await ext.configure();
    await use(ext);
  },
});

export const expect = test.expect;

/** Locator for the extension toast (open shadow root in test builds only). */
export const toast = (page: Page) => page.locator("prompt-enhancer-toast .toast");
export const toastButton = (page: Page, action: string) => page.locator(`prompt-enhancer-toast button[data-action="${action}"]`);

export async function submissions(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__submitted + (window as any).__enterPressed + (window as any).__sendClicked);
}
