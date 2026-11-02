import { expect, FIXTURE_ORIGIN, submissions, test, toast } from "./fixtures";

test("smoke: textarea enhance → insert, never submit", async ({ page, ext }) => {
  await page.goto(`${FIXTURE_ORIGIN}/textarea.html`);
  await page.locator("#field").click();
  await page.keyboard.type("write a python script that cleans up my csv file");
  await ext.trigger();
  await expect(page.locator("#field")).toHaveValue(/^Please complete the following request clearly and concisely\.\n\nwrite a python script/);
  await expect(toast(page)).toContainText("Prompt enhanced — not sent");
  expect(await submissions(page)).toBe(0);
  expect(ext.completionRequests).toHaveLength(1);
});
