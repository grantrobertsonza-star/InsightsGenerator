// Import screen, Grant 2026-10-19: "I imported the questionnaire and it says it was imported but I
// don't see it in the list", and the right-hand pane showed project totals rather than anything about
// the selected file. Real browser on the disposable stack (model replay).
//   1. A questionnaire linked to a raw data file is listed on that file's card ("Linked"), and the
//      file count includes it, so nothing imported is missing from the list.
//   2. Selecting a brief or report shows what that file is for, with "Review research quality",
//      which opens that module with the document preselected.
//   3. Project totals are one line, not the body of the pane.
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
  const run = await ui.createRun({ name: `import-detail-${Date.now()}` });
  await ui.upload(run, path.join(FIXTURE, "golden-survey-documented.xlsx"), "table");
  await ui.upload(run, path.join(FIXTURE, "client-brief.docx"), "report");

  // The questionnaire, through the Questionnaire or guide control.
  const form = page.locator("form", { has: page.locator('input[name="instrumentFiles"]') });
  await form.locator('input[name="instrumentFiles"]').setInputFiles(path.join(FIXTURE, "questionnaire.docx"));
  await form.getByRole("button", { name: "Upload", exact: true }).click();
  const linked = page.getByTestId("linked-instrument").filter({ hasText: "questionnaire.docx" });
  await expect(linked).toBeVisible({ timeout: 3 * 60_000 });
  // Listed on the data file's card, and counted: three files imported, three in the count.
  await expect(page.getByRole("heading", { name: "Your files (3)" })).toBeVisible();
  const dataCard = page.locator("div", { has: page.getByText("golden-survey-documented.xlsx", { exact: true }) }).filter({ has: linked }).last();
  await expect(dataCard).toBeVisible();

  // The brief: what it is for, and the way to its quality review.
  await page.getByText("client-brief.docx", { exact: true }).first().click();
  const purpose = page.getByTestId("file-purpose");
  await expect(purpose).toBeVisible();
  await expect(purpose).toContainText(/brief|Report/);
  // Totals name every kind, questionnaires included.
  await expect(page.getByTestId("project-totals")).toContainText("1 questionnaire(s) or guide(s)");
  await expect(page.getByText(/findings so far$/)).toHaveCount(0);
  await purpose.getByRole("button", { name: "Review research quality" }).click();
  const section = page.getByTestId("research-quality");
  await expect(section).toBeVisible({ timeout: 60_000 });
  // Only the brief is preselected (each document card also has role boxes, so count cards, not ticks).
  const pickedCards = section.locator("[data-document-id]").filter({ has: page.locator("input[type=checkbox]:checked") });
  await expect(pickedCards).toHaveCount(1, { timeout: 60_000 });
  await expect(pickedCards).toContainText("client-brief.docx");
});
