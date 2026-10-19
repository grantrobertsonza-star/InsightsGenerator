// Import screen, Grant 2026-10-19: "I imported the questionnaire and it says it was imported but I
// don't see it in the list", and the right-hand pane showed project totals rather than anything about
// the selected file. Real browser on the disposable stack (model replay).
//   1. A questionnaire linked to a raw data file is listed on that file's card ("Linked"), and the
//      file count includes it, so nothing imported is missing from the list.
//   2. Selecting a brief shows what that file is for, with "Review research quality",
//      which opens that module with the document highlighted.
//   3. Project totals are one line, not the body of the pane.
//   4. "Open" on a file opens it in a new tab through a short-lived link (here the data file downloads).
//   5. Selecting each kind of file (data, questionnaire, brief) shows its own purpose, and logs no
//      React "unique key" warning. Grant saw that warning on 2026-10-19 for the questionnaire's purpose
//      box (`next dev`, Turbopack), which had no key. It did not reproduce here on the webpack dev
//      stack with the old code, so this guard is unproven against that fault; React prints the
//      warning only in development, so it passes trivially against a production build.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FIXTURE = path.resolve("fixtures/golden-thread-1");

test.use({ viewport: { width: 1600, height: 1000 } });

test("a linked questionnaire stays visible in the list, and the pane describes the selected file", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const keyWarnings = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /unique "key" prop/.test(m.text())) keyWarnings.push(m.text().slice(0, 300));
  });
  const run = await ui.createRun({ name: `import-detail-${Date.now()}` });
  await ui.upload(run, path.join(FIXTURE, "golden-survey-documented.xlsx"), "table");
  await ui.upload(run, path.join(FIXTURE, "client-brief.docx"), "brief");

  // The questionnaire, through the Questionnaire or guide control.
  const form = page.locator("form", { has: page.locator('input[name="instrumentFiles"]') });
  await form.locator('input[name="instrumentFiles"]').setInputFiles(path.join(FIXTURE, "questionnaire.docx"));
  await form.getByRole("button", { name: "Upload", exact: true }).click();
  const linked = page.getByTestId("linked-instrument").filter({ hasText: "questionnaire.docx" });
  await expect(linked).toBeVisible({ timeout: 3 * 60_000 });
  // Named on the data file's card, and with its own card too: three files imported, three listed.
  await expect(page.getByRole("heading", { name: "Your files (3)" })).toBeVisible();
  await expect(page.getByText(/^Linked to golden-survey-documented\.xlsx; /)).toBeVisible();
  const dataCard = page.locator("div", { has: page.getByText("golden-survey-documented.xlsx", { exact: true }) }).filter({ has: linked }).last();
  await expect(dataCard).toBeVisible();

  // Opening a file: the data file downloads under its own name, in a new tab, through a short-lived
  // link the server signed after checking the file belongs to this project.
  const [tab] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Open golden-survey-documented.xlsx" }).first().click()]);
  const download = await tab.waitForEvent("download", { timeout: 60_000 });
  expect(download.suggestedFilename()).toMatch(/golden-survey-documented\.xlsx|^[^/]+$/);
  expect(download.url()).toMatch(/\/object\/sign\//);
  await tab.close().catch(() => {});
  await expect(page.getByText(/could not be opened|not in this project/)).toHaveCount(0);

  // The questionnaire and the data file each describe themselves in the pane.
  await page.getByText("questionnaire.docx", { exact: true }).first().click();
  await expect(page.getByTestId("file-purpose")).toContainText(/Questionnaire or guide/);
  await page.getByText("golden-survey-documented.xlsx", { exact: true }).first().click();
  await expect(page.getByTestId("file-purpose")).toContainText(/Case-level data/);

  // The brief: what it is for, and the way to its quality review.
  await page.getByText("client-brief.docx", { exact: true }).first().click();
  const purpose = page.getByTestId("file-purpose");
  await expect(purpose).toBeVisible();
  await expect(purpose).toContainText(/brief or proposal/);
  // Totals name every kind, questionnaires included.
  await expect(page.getByTestId("project-totals")).toContainText("1 questionnaire(s) or guide(s)");
  await expect(page.getByText(/findings so far$/)).toHaveCount(0);
  await purpose.getByRole("button", { name: "Review research quality" }).click();
  const section = page.getByTestId("research-quality");
  await expect(section).toBeVisible({ timeout: 60_000 });
  // The brief is the document highlighted in the quality review's list.
  await expect(section.locator('[data-document-id][data-highlight="true"]')).toContainText("client-brief.docx", { timeout: 60_000 });
  await expect(section.locator('[data-document-id][data-highlight="true"]')).toHaveCount(1);
  expect(keyWarnings, "React key warnings while selecting files").toEqual([]);
});
