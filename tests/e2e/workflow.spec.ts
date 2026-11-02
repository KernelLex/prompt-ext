import type { Page } from "@playwright/test";
import { expect, FIXTURE_ORIGIN, submissions, test, toast, toastButton, TEST_KEY, type Ext } from "./fixtures";

const ORIGINAL = "write a python script that cleans up my csv file, remove duplicates, it has 50000 rows";
const PREFIX = "Please complete the following request clearly and concisely.";

async function open(page: Page, fixture: string, selector = "#field") {
  await page.goto(`${FIXTURE_ORIGIN}/${fixture}`);
  await page.locator(selector).click();
}

async function typeOriginal(page: Page, text = ORIGINAL) {
  await page.keyboard.type(text);
}

async function fieldText(page: Page, fixture: string): Promise<string> {
  switch (fixture) {
    case "shadow.html":
      return page.locator("#host").evaluate((h) => (h.shadowRoot!.querySelector("textarea") as HTMLTextAreaElement).value);
    case "contenteditable.html":
      return page.locator("#field").evaluate((el) => (el as HTMLElement).innerText);
    case "prosemirror.html":
      return page.evaluate(() => (window as any).__pmText());
    case "react.html":
      return (await page.locator("#state").textContent()) ?? ""; // React's own state, not just the DOM
    default:
      return page.locator("#field").inputValue();
  }
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

test.describe("editor compatibility (D5 fixtures)", () => {
  // `strategy` is the insertion strategy expected to succeed on the FIRST attempt — asserting it
  // ensures a silent fallback can't hide a broken primary path.
  const editors: Array<{ fixture: string; selector: string; strategy: string }> = [
    { fixture: "textarea.html", selector: "#field", strategy: "exec-insert-text" },
    { fixture: "input.html", selector: "#field", strategy: "exec-insert-text" },
    { fixture: "react.html", selector: "#field", strategy: "exec-insert-text" },
    { fixture: "contenteditable.html", selector: "#field", strategy: "exec-insert-text" },
    { fixture: "shadow.html", selector: "#host", strategy: "exec-insert-text" },
    { fixture: "prosemirror.html", selector: ".ProseMirror", strategy: "synthetic-paste" },
  ];
  for (const { fixture, selector, strategy } of editors) {
    test(`${fixture}: enhance replaces the text, Undo restores it, nothing is submitted`, async ({ page, ext }) => {
      await open(page, fixture, selector);
      if (fixture === "shadow.html") await page.locator("#host").evaluate((h) => (h.shadowRoot!.querySelector("textarea") as HTMLTextAreaElement).focus());
      await typeOriginal(page);
      expect(norm(await fieldText(page, fixture))).toBe(ORIGINAL);

      await ext.trigger();
      await expect.poll(async () => norm(await fieldText(page, fixture))).toBe(norm(`${PREFIX}\n\n${ORIGINAL}`));
      await expect(toast(page)).toContainText("Prompt enhanced — not sent");
      expect(await page.evaluate(() => document.documentElement.dataset.peStrategy)).toBe(strategy);

      await toastButton(page, "undo").click();
      await expect.poll(async () => norm(await fieldText(page, fixture))).toBe(ORIGINAL);
      await expect(toast(page)).toContainText("Original prompt restored");

      expect(await submissions(page)).toBe(0);
      expect(ext.completionRequests).toHaveLength(1);
    });
  }

  test("textarea: multi-line result keeps its line breaks", async ({ page, ext }) => {
    await open(page, "textarea.html");
    await typeOriginal(page);
    await ext.trigger();
    await expect(page.locator("#field")).toHaveValue(`${PREFIX}\n\n${ORIGINAL}`);
  });

  test("input: multi-line result is collapsed to one line", async ({ page, ext }) => {
    await open(page, "input.html");
    await typeOriginal(page);
    await ext.trigger();
    await expect(page.locator("#field")).toHaveValue(`${PREFIX} ${ORIGINAL}`);
  });

  test("textarea: native Ctrl+Z also undoes the enhancement", async ({ page, ext }) => {
    await open(page, "textarea.html");
    await typeOriginal(page);
    await ext.trigger();
    await expect(page.locator("#field")).toHaveValue(new RegExp(`^${PREFIX}`));
    await page.locator("#field").focus();
    await page.keyboard.press("Control+z");
    await expect(page.locator("#field")).toHaveValue(ORIGINAL);
  });

  test("restore command restores the original after the toast is gone", async ({ page, ext }) => {
    await open(page, "textarea.html");
    await typeOriginal(page);
    await ext.trigger();
    await expect(page.locator("#field")).toHaveValue(new RegExp(`^${PREFIX}`));
    await ext.restore();
    await expect(page.locator("#field")).toHaveValue(ORIGINAL);
  });

  test("restore asks before overwriting text edited after enhancement", async ({ page, ext }) => {
    await open(page, "textarea.html");
    await typeOriginal(page);
    await ext.trigger();
    await page.locator("#field").press("End");
    await page.keyboard.type(" EDITED");
    await ext.restore();
    await expect(toast(page)).toContainText("Text changed since enhancement");
    await expect(page.locator("#field")).toHaveValue(/EDITED$/);
    await toastButton(page, "replace_anyway").click();
    await expect(page.locator("#field")).toHaveValue(ORIGINAL);
  });
});

test.describe("unsupported fields send nothing", () => {
  test("password field", async ({ page, ext }) => {
    await open(page, "password.html");
    await page.keyboard.type("hunter2 secret password");
    await ext.trigger();
    await expect(toast(page)).toContainText("This field isn't supported");
    expect(ext.completionRequests).toHaveLength(0);
    await expect(page.locator("#field")).toHaveValue("hunter2 secret password");
  });

  test("no field focused", async ({ page, ext }) => {
    await page.goto(`${FIXTURE_ORIGIN}/textarea.html`);
    await ext.trigger();
    await expect(toast(page)).toContainText("No text box selected");
    expect(ext.completionRequests).toHaveLength(0);
  });

  test("closed shadow root is unreachable", async ({ page, ext }) => {
    await page.goto(`${FIXTURE_ORIGIN}/closed-shadow.html`);
    await page.evaluate(() => {
      (window as any).__typeClosed("hidden prompt text here");
      (window as any).__focusClosed();
    });
    await ext.trigger();
    expect(ext.completionRequests).toHaveLength(0);
    await expect(toast(page)).toBeVisible();
  });

  test("cross-origin iframe is not touched", async ({ page, ext }) => {
    await page.goto(`${FIXTURE_ORIGIN}/iframe.html`);
    const frame = page.frameLocator("#frame");
    await frame.locator("#field").click();
    await page.keyboard.type("prompt inside a cross-origin frame");
    await ext.trigger();
    await expect(toast(page)).toContainText("This field isn't supported");
    expect(ext.completionRequests).toHaveLength(0);
    await expect(frame.locator("#field")).toHaveValue("prompt inside a cross-origin frame");
  });
});

test.describe("provider failures never change the original", () => {
  async function runFailure(page: Page, ext: Ext, scenario: Parameters<Ext["scenario"]>[0]) {
    ext.scenario(scenario);
    await open(page, "textarea.html");
    await typeOriginal(page);
    await ext.trigger();
    await expect(page.locator("#field")).toHaveValue(ORIGINAL);
    expect(await submissions(page)).toBe(0);
  }

  test("invalid key (401) → clear message with settings action, no retry", async ({ page, ext }) => {
    await runFailure(page, ext, "auth");
    await expect(toast(page)).toContainText("Groq rejected your API key");
    await expect(toastButton(page, "settings")).toBeVisible();
    expect(ext.completionRequests).toHaveLength(1);
  });

  test("daily quota (429 RPD) → circuit breaker stops further requests until overridden", async ({ page, ext }) => {
    await runFailure(page, ext, "quota");
    await expect(toast(page)).toContainText("Groq quota reached");
    expect(ext.completionRequests).toHaveLength(1);
    await ext.trigger();
    await expect(toast(page)).toContainText("Paused until about");
    expect(ext.completionRequests).toHaveLength(1); // blocked locally
    ext.scenario("ok");
    await ext.trigger(true); // explicit "Try anyway"
    await expect(page.locator("#field")).toHaveValue(new RegExp(`^${PREFIX}`));
    expect(ext.completionRequests).toHaveLength(2);
  });

  test("transient rate limit → exactly one bounded retry", async ({ page, ext }) => {
    await runFailure(page, ext, "rate_limit");
    await expect(toast(page)).toContainText("rate limiting");
    expect(ext.completionRequests).toHaveLength(2);
  });

  test("server error (503) → one retry then a clear error", async ({ page, ext }) => {
    await runFailure(page, ext, "server_error");
    await expect(toast(page)).toContainText("server error");
    expect(ext.completionRequests).toHaveLength(2);
  });

  test("malformed response → not inserted, not retried", async ({ page, ext }) => {
    await runFailure(page, ext, "malformed");
    await expect(toast(page)).toContainText("Unusable response");
    expect(ext.completionRequests).toHaveLength(1);
  });

  test("answer instead of rewrite → blocked; Insert anyway never offered even when enabled", async ({ page, ext }) => {
    await ext.configure({ allowInsertAnyway: true });
    await runFailure(page, ext, "answer");
    await expect(toast(page)).toContainText("Result didn't pass checks");
    await expect(toastButton(page, "copy")).toBeVisible();
    await expect(toastButton(page, "insert_anyway")).toHaveCount(0);
  });

  test("dropped details → blocked with Copy only (Insert anyway off by default)", async ({ page, ext }) => {
    ext.scenario("drop_details");
    await open(page, "textarea.html");
    await page.keyboard.type('Summarize "Q3 revenue was $4.2M" in under 120 words');
    await ext.trigger();
    await expect(toast(page)).toContainText("dropped or changed details");
    await expect(toastButton(page, "copy")).toBeVisible();
    await expect(toastButton(page, "insert_anyway")).toHaveCount(0);
    await expect(page.locator("#field")).toHaveValue('Summarize "Q3 revenue was $4.2M" in under 120 words');
  });

  test("dropped details with Insert anyway enabled → inserted only after explicit click, then undoable", async ({ page, ext }) => {
    await ext.configure({ allowInsertAnyway: true });
    ext.scenario("drop_details");
    await open(page, "textarea.html");
    const original = 'Summarize "Q3 revenue was $4.2M" in under 120 words';
    await page.keyboard.type(original);
    await ext.trigger();
    await expect(page.locator("#field")).toHaveValue(original);
    await toastButton(page, "insert_anyway").click();
    await expect(page.locator("#field")).toHaveValue("Summarize the quarterly results for the board.");
    await toastButton(page, "undo").click();
    await expect(page.locator("#field")).toHaveValue(original);
  });

  test("already-clear prompt → unchanged", async ({ page, ext }) => {
    ext.scenario("unchanged");
    await open(page, "textarea.html");
    await page.keyboard.type("What is the boiling point of water at sea level in Fahrenheit?");
    await ext.trigger();
    await expect(toast(page)).toContainText("Already clear — no changes");
    await expect(page.locator("#field")).toHaveValue("What is the boiling point of water at sea level in Fahrenheit?");
  });
});

test.describe("request control", () => {
  test("double trigger sends exactly one request", async ({ page, ext }) => {
    ext.scenario("slow", 1500);
    await open(page, "textarea.html");
    await typeOriginal(page);
    await Promise.all([ext.trigger(), ext.trigger()]);
    expect(ext.completionRequests).toHaveLength(1);
    await expect(page.locator("#field")).toHaveValue(new RegExp(`^${PREFIX}`));
  });

  test("cancel aborts and keeps the original", async ({ page, ext }) => {
    ext.scenario("slow", 4000);
    await open(page, "textarea.html");
    await typeOriginal(page);
    const run = ext.triggerNoWait();
    await expect(toast(page)).toContainText("Enhancing prompt…");
    await toastButton(page, "cancel").click();
    await run;
    await expect(toast(page)).toContainText("Cancelled");
    await expect(page.locator("#field")).toHaveValue(ORIGINAL);
  });

  test("Esc cancels while enhancing", async ({ page, ext }) => {
    ext.scenario("slow", 4000);
    await open(page, "textarea.html");
    await typeOriginal(page);
    const run = ext.triggerNoWait();
    await expect(toast(page)).toContainText("Enhancing prompt…");
    await page.keyboard.press("Escape");
    await run;
    await expect(page.locator("#field")).toHaveValue(ORIGINAL);
  });

  test("typing during the request prevents overwrite; Replace anyway is explicit", async ({ page, ext }) => {
    ext.scenario("slow", 1500);
    await open(page, "textarea.html");
    await typeOriginal(page);
    const run = ext.triggerNoWait();
    await expect(toast(page)).toContainText("Enhancing prompt…");
    await page.locator("#field").press("End");
    await page.keyboard.type(" and more");
    await run;
    await expect(toast(page)).toContainText("You edited the text while it was enhancing");
    await expect(page.locator("#field")).toHaveValue(`${ORIGINAL} and more`);
    await toastButton(page, "replace_anyway").click();
    await expect(page.locator("#field")).toHaveValue(new RegExp(`^${PREFIX}`));
  });

  test("possible secret → asks first; declining sends nothing", async ({ page, ext }) => {
    await open(page, "textarea.html");
    await page.keyboard.type("debug my call using key gsk_abcdefghijklmnopqrstuvwxyz0123456789 please");
    const run = ext.triggerNoWait();
    await expect(toast(page)).toContainText("may contain a secret");
    await toastButton(page, "dismiss").click();
    await run;
    expect(ext.completionRequests).toHaveLength(0);
  });

  test("no key configured → opens settings, sends nothing", async ({ page, ext, env }) => {
    await ext.configure({ key: false });
    await open(page, "textarea.html");
    await typeOriginal(page);
    const optionsPage = env.context.waitForEvent("page");
    await ext.trigger();
    expect((await optionsPage).url()).toContain("options.html");
    expect(ext.completionRequests).toHaveLength(0);
    await (await optionsPage).close();
  });

  test("no consent → opens settings, sends nothing", async ({ page, ext, env }) => {
    await ext.configure({ consent: false });
    await open(page, "textarea.html");
    await typeOriginal(page);
    const optionsPage = env.context.waitForEvent("page");
    await ext.trigger();
    expect((await optionsPage).url()).toContain("options.html");
    expect(ext.completionRequests).toHaveLength(0);
    await (await optionsPage).close();
  });

  test("request contains only the prompt and instructions; key only in the header", async ({ page, ext }) => {
    await open(page, "textarea.html");
    await typeOriginal(page);
    await ext.trigger();
    const req = ext.completionRequests[0]!;
    expect(req.auth).toBe(`Bearer ${TEST_KEY}`);
    const bodyText = JSON.stringify(req.body);
    expect(bodyText).not.toContain(TEST_KEY);
    expect(bodyText).not.toContain("127.0.0.1:4598"); // page URL never sent
    expect(bodyText).not.toContain("Fixture: textarea"); // page title never sent
    const user = (req.body as any).messages[1].content as string;
    expect(user).toMatch(/<<<PROMPT-[0-9a-f]{16}>>>\nwrite a python script/);
  });
});

test.describe("options page", () => {
  test("shows Groq, disables Gemini, tests the connection, saves settings", async ({ page, ext }) => {
    await ext.configure({ key: true, consent: true });
    await page.goto(`chrome-extension://${ext.id}/options.html`);
    await expect(page.getByRole("radio", { name: "Groq" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("radio", { name: /Google Gemini \(not available yet\)/ })).toBeDisabled();
    await expect(page.locator("#key-mask")).toHaveText(/^test.+tial$/);
    await expect(page.locator("#key-mask")).not.toHaveText(TEST_KEY);
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.locator("#test-status")).toContainText("Connected");
    await page.getByRole("radio", { name: "Deep" }).click();
    await expect(page.locator("#save-status")).toContainText("Saved");
    const mode = await page.evaluate(async () => ((await chrome.storage.local.get("settings")) as any).settings.mode);
    expect(mode).toBe("deep");
    expect(await page.locator("#allow-insert-anyway").isChecked()).toBe(false);
  });

  test("save and remove a key", async ({ page, ext }) => {
    await ext.configure({ key: false, consent: false });
    await page.goto(`chrome-extension://${ext.id}/options.html`);
    await expect(page.locator("#welcome")).toBeVisible();
    await page.locator("#api-key").fill("gsk_e2e_dummy_value_123");
    await page.getByRole("button", { name: "Save key" }).click();
    await expect(page.locator("#test-status")).toContainText("Key saved");
    await expect(page.locator("#key-mask")).toHaveText("gsk_••••••••••••_123");
    await expect(page.locator("#api-key")).toHaveValue("");
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.locator("#key-mask")).toHaveText("none");
  });
});
