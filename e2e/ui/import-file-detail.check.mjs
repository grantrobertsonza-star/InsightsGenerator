// Import screen, Grant 2026-10-19: "I imported the questionnaire and it says it was imported but I
// don't see it in the list", and the right-hand pane showed project totals rather than anything about
// the selected file. Real browser on the disposable stack (model replay).
//   1. A questionnaire linked to a raw data file is named on that file's row ("1 linked document"),
//      and has its own row too, so nothing imported is missing from the list.
//   2. Selecting a brief shows what that file is for, with "Review research quality",
//      which opens that module with the document highlighted.
//   3. Project totals are one line, not the body of the pane.
//   4. "Open" on a file opens it in a new tab through a short-lived link (here the data file downloads).
//   5. Selecting each kind of file (data, questionnaire, brief) shows its own purpose, and logs no
//      React "unique key" warning. Grant saw that warning on 2026-10-19 for the questionnaire's purpose
//      box (`next dev`, Turbopack), which had no key. It did not reproduce here on the webpack dev
//      stack with the old code, so this guard is unproven against that fault; React prints the
//      warning only in development, so it passes trivially against a production build.
//   6. A data file's pane names its linked questionnaire on one line (Grant, 2026-10-19: the full
//      questionnaire card there duplicated its own); the first read still starts from that line.
//   7. What the file is for and its next step (Open Crosstabs and Open Analytics, Open Coding) sit in the selected
//      source's header, above its tabs (Grant's Sources layout, 2026-10-20).
//   8. A brief shows its size: pages, words, and how much of it a quality review reads.
//   9. The project title lines up with the section heading (Grant, 2026-10-19).
import { expect, test } from "@playwright/test";
import { addFiles } from "./helpers/addFiles.mjs";
import { openSourceTab, selectSource } from "./helpers/sources.mjs";
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

  // The questionnaire, added as a Questionnaire (one of three types since 2026-10-20).
  await addFiles(page, path.join(FIXTURE, "questionnaire.docx"), "Questionnaire");
  const dataRow = page.getByTestId("source-row").filter({ has: page.getByRole("button", { name: "Select golden-survey-documented.xlsx", exact: true }) });
  await expect(dataRow.getByTestId("linked-instrument")).toContainText("Linked: questionnaire.docx", { timeout: 3 * 60_000 });
  // Named on the data file's row, and with its own row too: three files imported, three listed.
  await expect(page.getByTestId("source-row")).toHaveCount(3);
  const questionnaireRow = page.getByTestId("source-row").filter({ has: page.getByRole("button", { name: "Select questionnaire.docx", exact: true }) });
  await expect(questionnaireRow.getByTestId("linked-instrument")).toContainText("Linked to golden-survey-documented.xlsx");
  // The Sources pane's own header holds the count and Roll up (Grant, 2026-10-22); no second count
  // line. Rolled up, the list goes and its header stays; shown again, the rows come back.
  const sourcesPane = page.locator("section", { has: page.getByRole("heading", { name: "Sources", exact: true, level: 3 }) }).filter({ has: page.getByTestId("source-list-toggle") }).first();
  await expect(sourcesPane.getByRole("heading", { name: "Sources", exact: true, level: 3 })).toBeVisible();
  await expect(sourcesPane.getByText("(3)", { exact: true })).toBeVisible();
  await expect(sourcesPane.getByText(/^\d+ sources?$/i)).toHaveCount(0);
  const rollUp = sourcesPane.getByTestId("source-list-toggle");
  await expect(rollUp).toHaveText("Roll up");
  await rollUp.click();
  await expect(rollUp).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("source-row").filter({ visible: true })).toHaveCount(0);
  await rollUp.click();
  await expect(page.getByTestId("source-row").filter({ visible: true })).toHaveCount(3);

  // 9. The project title and the section heading share one left edge (1600 px wide viewport).
  const titleBox = await page.locator("h1").first().boundingBox();
  const headingBox = await page.getByRole("heading", { name: "Sources", exact: true, level: 2 }).boundingBox();
  expect(Math.abs(titleBox.x - headingBox.x)).toBeLessThanOrEqual(1);

  // View original: the data file downloads under its own name through a short-lived link the server
  // signed after checking the file belongs to this project, and no window or tab opens (Grant,
  // 2026-10-22: it used to open an empty browser window while downloading).
  await selectSource(page, "golden-survey-documented.xlsx");
  let popups = 0;
  page.context().on("page", () => popups++);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.getByTestId("selected-source").getByRole("button", { name: "Download golden-survey-documented.xlsx" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/golden-survey-documented\.xlsx|^[^/]+$/);
  expect(download.url()).toMatch(/\/object\/sign\//);
  expect(popups).toBe(0);
  await expect(page.getByTestId("selected-source")).toBeVisible();
  await expect(page.getByText(/could not be opened|not in this project/)).toHaveCount(0);

  // The questionnaire and the data file each describe themselves in the pane.
  await selectSource(page, "questionnaire.docx");
  await expect(page.getByTestId("file-purpose-text")).toContainText(/^Questionnaire\. /);
  await selectSource(page, "golden-survey-documented.xlsx");
  await expect(page.getByTestId("file-purpose-text")).toContainText(/Case-level data/);
  // 6. The data file's Questionnaire links tab names its questionnaire on one line, not a second copy
  //    of its card; the first read still starts from here, and "Show" selects the questionnaire.
  const links = await openSourceTab(page, "Questionnaire links");
  const line = links.getByTestId("attached-instrument");
  await expect(line).toHaveCount(1);
  await expect(line).toContainText("Questionnaire: questionnaire.docx");
  // The read finishes from here: items read, or the reason it could not (with model replay this
  // fixture reads as "No question items were found"), shown on the line rather than lost.
  await expect(async () => {
    const read = /items read/.test(await line.innerText());
    const reason = (await line.locator(".text-danger").count()) > 0;
    expect(read || reason).toBe(true);
  }).toPass({ timeout: 3 * 60_000 });
  await expect(links.getByRole("button", { name: /Match to variables|Match again/ })).toHaveCount(0);
  // 7. What the file is for, with Open Crosstabs and Open Analytics, sits in the header above the tabs.
  const header = page.getByTestId("selected-source");
  await expect(header.getByTestId("file-purpose").getByRole("button", { name: "Open Crosstabs" })).toBeVisible();
  await expect(header.getByTestId("file-purpose").getByRole("button", { name: "Open Analytics" })).toBeVisible();
  expect((await header.boundingBox()).y).toBeLessThan((await page.getByRole("tablist", { name: "Parts of the selected source" }).boundingBox()).y);
  await line.getByRole("button", { name: "Show" }).click();
  await expect(page.getByTestId("file-purpose-text")).toContainText(/^Questionnaire\. /);

  // The brief: what it is for, and the way to its quality review.
  await selectSource(page, "client-brief.docx");
  const purpose = page.getByTestId("file-purpose");
  await expect(page.getByTestId("file-purpose-text")).toContainText(/brief or proposal/);
  // 8. Its size: pages (or why not known), words read, and that a quality review reads all of it.
  const size = (await openSourceTab(page, "Document details")).getByTestId("document-indicators");
  await expect(size.getByTestId("indicator-words")).toContainText(/^\d[\d,]* \(as read from the file\)$/, { timeout: 60_000 });
  await expect(size.getByTestId("indicator-pages")).toContainText(/^(\d[\d,]*|Not known: .+)$/);
  await expect(size.getByTestId("indicator-coverage")).toContainText("A quality review reads all of it");
  // Totals name every kind, questionnaires included.
  await expect(page.getByTestId("project-totals")).toContainText("1 questionnaire(s) or guide(s)");
  await expect(page.getByText(/findings so far$/)).toHaveCount(0);
  await purpose.getByRole("button", { name: "Review research quality" }).click();
  const section = page.getByTestId("research-quality");
  await expect(section).toBeVisible({ timeout: 60_000 });
  // The brief is the document highlighted in the quality review's list.
  await expect(section.locator('[data-document-id][data-highlight="true"]')).toContainText("client-brief.docx", { timeout: 60_000 });
  await expect(section.locator('[data-document-id][data-highlight="true"]')).toHaveCount(1);
  // ...and the one shown, in the document picker.
  await expect(section.getByLabel("Document", { exact: true }).locator("option:checked")).toContainText("client-brief.docx");
  expect(keyWarnings, "React key warnings while selecting files").toEqual([]);
});
