import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, FIXTURE_ORIGIN, test, toast, toastButton } from "./fixtures";

/**
 * Captures GENUINE screenshots of the test build running in Chromium for the project report.
 * Provider responses come from the local mock server (canned data, not real Groq output) because
 * the development environment cannot reach api.groq.com. Run with: SCREENSHOTS=1 npx playwright test screens
 */
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../report/assets/screenshots");
const ROUGH = "write a python script that cleans up my csv file, remove duplicates and fix the dates, it has like 50k rows";

test.describe("report screenshots", () => {
  test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture report screenshots");

  test("core journey", async ({ page, ext }) => {
    const shot = (name: string) => page.screenshot({ path: path.join(OUT, name) });
    await page.goto(`${FIXTURE_ORIGIN}/demo-chat.html`);
    await page.locator("#field").click();
    await page.keyboard.type(ROUGH);
    await shot("01-before.png");

    ext.scenario("demo", 2500);
    const run = ext.triggerNoWait();
    await expect(toast(page)).toContainText("Enhancing prompt…");
    await shot("02-enhancing.png");
    await run;
    await expect(toast(page)).toContainText("Prompt enhanced — not sent");
    await shot("03-enhanced.png");

    await toastButton(page, "undo").click();
    await expect(toast(page)).toContainText("Original prompt restored");
    await expect(page.locator("#field")).toHaveValue(ROUGH);
    await shot("04-undo-restored.png");
  });

  test("states", async ({ page, ext }) => {
    const shot = (name: string) => page.screenshot({ path: path.join(OUT, name) });
    const reset = async (text: string) => {
      await page.goto(`${FIXTURE_ORIGIN}/demo-chat.html`);
      await page.locator("#field").click();
      await page.keyboard.type(text);
    };

    ext.scenario("unchanged");
    await reset("What is the boiling point of water at sea level in Fahrenheit?");
    await ext.trigger();
    await expect(toast(page)).toContainText("Already clear");
    await shot("05-already-clear.png");

    ext.scenario("auth");
    await reset(ROUGH);
    await ext.trigger();
    await expect(toast(page)).toContainText("rejected your API key");
    await shot("06-error-invalid-key.png");

    ext.scenario("quota");
    await reset(ROUGH);
    await ext.trigger();
    await expect(toast(page)).toContainText("quota reached");
    await shot("07-error-quota.png");
    await ext.configure(); // clears the circuit breaker for the next shots

    ext.scenario("drop_details");
    await reset('Summarize "Q3 revenue was $4.2M, up 18%" in under 120 words for a board update');
    await ext.trigger();
    await expect(toast(page)).toContainText("Result didn't pass checks");
    await shot("08-validation-blocked.png");

    ext.scenario("slow", 1500);
    await reset(ROUGH);
    const run = ext.triggerNoWait();
    await expect(toast(page)).toContainText("Enhancing prompt…");
    await page.locator("#field").press("End");
    await page.keyboard.type(" and export a summary of removed rows");
    await run;
    await expect(toast(page)).toContainText("You edited the text");
    await shot("09-field-changed.png");

    await page.goto(`${FIXTURE_ORIGIN}/password.html`);
    await page.locator("#field").click();
    await page.keyboard.type("hunter2");
    await ext.trigger();
    await expect(toast(page)).toContainText("isn't supported");
    await shot("10-unsupported-password.png");
  });

  test("options page", async ({ page, ext }) => {
    await ext.configure({ key: false, consent: false });
    await page.setViewportSize({ width: 1000, height: 1300 });
    await page.goto(`chrome-extension://${ext.id}/options.html`);
    await expect(page.locator("#welcome")).toBeVisible();
    await page.screenshot({ path: path.join(OUT, "11-options-first-run.png"), fullPage: true });

    await ext.configure();
    await page.reload();
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.locator("#test-status")).toContainText("Connected");
    await page.screenshot({ path: path.join(OUT, "12-options-configured.png"), fullPage: true });
  });
});
