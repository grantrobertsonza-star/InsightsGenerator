// The Import screen's Add files dialog and Sources layout (Grant, 2026-10-19 and 2026-10-20, from
// his mock-up and his Sources prototype). Real browser on the disposable stack (model replay).
//   1. A new project says to use Add files; the dialog opens from the button and closes again.
//   2. Every file arrives with a suggested type, marked Suggested until changed (Grant, 2026-10-21):
//      a spreadsheet with no hint as Raw data, "Crosstabs" as Tables, "Proposal" as Proposal. Upload
//      need not wait on a choice; a type that does not fit is still refused with the reason.
//   3. The batch goes in as three sources, each listed under its own type, and a file chosen while it
//      uploads stays in the dialog for the next upload.
//   4. The list on the left, the selected source on the right with its type's tabs; a draggable,
//      remembered divider and a collapsible list; Add files to the right of the heading.
//   5. Search, type and state filters narrow the list and say when nothing matches.
//   6. Programme and wave linking in its own block below, closed until opened.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openAddFiles } from "./helpers/addFiles.mjs";
import { openSourceTab, selectSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FIXTURE = path.resolve("fixtures/golden-thread-1");

test.use({ viewport: { width: 1600, height: 1000 } });

test("one Add files dialog takes a mixed batch, a type per file, into the Sources list and its tabbed detail", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  await ui.createRun({ name: `add-files-${Date.now()}` });
  await page.getByRole("button", { name: /^Import data/ }).first().click();

  // 1. A new project points to Add files; the dialog opens and closes, and Escape closes it too.
  const toggle = page.getByRole("button", { name: "Add files", exact: true });
  await expect(page.getByText("Nothing here yet. Use Add files")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await openAddFiles(page);
  await page.getByRole("dialog", { name: "Add files" }).getByRole("button", { name: "Close Add files" }).click();
  await expect(page.getByTestId("add-files")).toHaveCount(0);
  await openAddFiles(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("add-files")).toHaveCount(0);
  const panel = await openAddFiles(page);

  // 2. Suggested types from the file name; changing one clears its mark.
  const rows = panel.getByTestId("add-files-row");
  const upload = panel.getByRole("button", { name: /^Upload/ });
  const suggestedIn = (name) => rows.filter({ hasText: name }).getByTestId("add-files-suggested");
  await panel.getByTestId("add-files-input").setInputFiles([
    { name: "Wave 2 Crosstabs.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("x") },
    { name: "Proposal.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("x") },
  ]);
  await expect(rows).toHaveCount(2);
  await expect(panel.getByLabel("Type of Wave 2 Crosstabs.xlsx")).toHaveValue("tables");
  await expect(panel.getByLabel("Type of Proposal.docx")).toHaveValue("proposal");
  await expect(suggestedIn("Wave 2 Crosstabs.xlsx")).toBeVisible();
  await expect(suggestedIn("Proposal.docx")).toBeVisible();
  await expect(upload).toBeEnabled();
  await panel.getByLabel("Type of Proposal.docx").selectOption({ label: "Brief" });
  await expect(suggestedIn("Proposal.docx")).toHaveCount(0);
  await expect(suggestedIn("Wave 2 Crosstabs.xlsx")).toBeVisible();
  await panel.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(rows).toHaveCount(0);

  // A mixed batch, one type each.
  await panel.getByTestId("add-files-input").setInputFiles([
    path.join(FIXTURE, "golden-survey-documented.xlsx"),
    path.join(FIXTURE, "client-brief.docx"),
    path.join(FIXTURE, "report.docx"),
  ]);
  await expect(rows).toHaveCount(3);
  await expect(upload).toHaveText(/Upload 3 files/);
  // A spreadsheet with no hint arrives as Raw data, marked; the brief and report from their names.
  await expect(panel.getByLabel("Type of golden-survey-documented.xlsx")).toHaveValue("raw");
  await expect(suggestedIn("golden-survey-documented.xlsx")).toBeVisible();
  await expect(panel.getByLabel("Type of client-brief.docx")).toHaveValue("brief");
  await expect(panel.getByLabel("Type of report.docx")).toHaveValue("report");
  await expect(upload).toBeEnabled();
  // A type that does not fit is refused with the reason, and holds Upload back.
  await panel.getByLabel("Type of golden-survey-documented.xlsx").selectOption({ label: "Brief" });
  await expect(rows.nth(0)).toContainText("Brief takes .pdf, .docx, .txt files, not .xlsx.");
  await expect(suggestedIn("golden-survey-documented.xlsx")).toHaveCount(0);
  await expect(upload).toBeDisabled();
  await panel.getByLabel("Type of golden-survey-documented.xlsx").selectOption({ label: "Raw data" });
  await expect(upload).toBeEnabled();
  await upload.click();
  // A file chosen while that upload runs stays for the next one, and keeps the dialog open.
  await panel.getByTestId("add-files-input").setInputFiles(path.join(FIXTURE, "questionnaire.docx"));

  // 3. Three sources, three types.
  const sources = page.getByTestId("source-row");
  await expect(sources).toHaveCount(3, { timeout: 3 * 60_000 });
  await expect(page.getByRole("status").filter({ hasText: /^Added 3 files/ })).toBeVisible();
  const source = (name) => sources.filter({ has: page.getByRole("button", { name: `Select ${name}`, exact: true }) });
  await expect(source("golden-survey-documented.xlsx")).toContainText("Raw data");
  await expect(source("report.docx")).toContainText("Report");
  // Named by the role chosen at upload (Grant, 2026-10-20: split Brief and Proposal).
  await expect(source("client-brief.docx")).toContainText("Brief");
  await expect(source("client-brief.docx")).not.toContainText("Brief or proposal");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("questionnaire.docx");
  await panel.getByRole("button", { name: "Close Add files" }).click();
  await selectSource(page, "client-brief.docx");
  await expect(page.getByTestId("file-purpose-text")).toContainText(/brief or proposal/);
  await expect(page.getByRole("tab")).toHaveText(["Preview", "Document details"]);

  // 4. The list on the left, the selected source on the right, with its type's tabs.
  await selectSource(page, "golden-survey-documented.xlsx");
  await expect(source("golden-survey-documented.xlsx")).toHaveAttribute("data-selected", "true");
  await expect(source("client-brief.docx")).toHaveAttribute("data-selected", "false");
  // Each file keeps its own colour bar, as the earlier cards had (Grant, 2026-10-20).
  const bar = (name) => source(name).evaluate((el) => getComputedStyle(el).borderLeftColor);
  const bars = [await bar("golden-survey-documented.xlsx"), await bar("client-brief.docx"), await bar("report.docx")];
  expect(new Set(bars).size).toBe(3);
  const selected = page.getByTestId("selected-source");
  // The file's name is in this header only, not repeated at the top of its Variables tab.
  const variables = await openSourceTab(page, "Variables");
  await expect(variables.getByText("golden-survey-documented.xlsx", { exact: true })).toHaveCount(0);
  await expect(selected).toContainText("golden-survey-documented.xlsx");
  await expect(selected.getByTestId("source-processing")).toHaveText(/^Processing: (Read|Reading)$/);
  await expect(page.getByRole("tab")).toHaveText(["Preview", "Setup", "Variables", "Data quality", "Weights and missing codes", "Questionnaire links"], { timeout: 3 * 60_000 });
  await expect(selected.getByTestId("source-acceptance")).toHaveText("Setup: Accepted", { timeout: 60_000 });
  await expect(source("golden-survey-documented.xlsx").getByTestId("source-row-acceptance")).toHaveText("Accepted");
  await openSourceTab(page, "Setup");
  await expect(page.getByLabel("What a case is: golden-survey-documented.xlsx")).toBeVisible();
  const [list, detail] = [await page.getByTestId("source-list").boundingBox(), await selected.boundingBox()];
  expect(detail.x).toBeGreaterThan(list.x + 200);
  expect(Math.abs(detail.y - list.y)).toBeLessThan(120);
  // Add files sits to the right of the heading.
  const heading = await page.getByRole("heading", { name: "Sources", exact: true, level: 2 }).boundingBox();
  expect((await toggle.boundingBox()).x).toBeGreaterThan(heading.x + 400);
  // The divider resizes the list like the other screens, and the width is remembered.
  const handle = page.getByRole("separator", { name: "Resize left panel" });
  await expect(handle).toBeVisible();
  const pane = page.getByTestId("three-pane-left").filter({ visible: true });
  const before = Math.round((await pane.boundingBox()).width);
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => Math.round((await pane.boundingBox()).width)).toBe(before + 16);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Import data/ }).first().click();
  await expect.poll(async () => Math.round((await page.getByTestId("three-pane-left").filter({ visible: true }).boundingBox()).width)).toBe(before + 16);
  // The list collapses to a narrow rail and comes back.
  await page.getByRole("button", { name: "Collapse left panel" }).click();
  await expect(page.getByTestId("source-list")).toBeHidden();
  await page.getByRole("button", { name: "Expand left panel" }).click();
  await expect(page.getByTestId("source-list")).toBeVisible();

  // 5. Filters narrow the list; nothing matching says so, and Clear filters brings everything back.
  await page.getByLabel("Search sources").fill("brief");
  await expect(sources.filter({ visible: true })).toHaveCount(1);
  await page.getByLabel("Search sources").fill("");
  await page.getByLabel("Filter by type").selectOption({ label: "Brief" });
  await expect(sources.filter({ visible: true })).toHaveText([/client-brief\.docx/]);
  await page.getByLabel("Filter by type").selectOption({ label: "Report" });
  await expect(sources.filter({ visible: true })).toHaveText([/report\.docx/]);
  // Groups (Grant, 2026-10-20): the data file is quantitative; nothing here is qualitative.
  await page.getByLabel("Filter by type").selectOption({ label: "All quantitative files" });
  await expect(sources.filter({ visible: true })).toHaveText([/golden-survey-documented\.xlsx/]);
  await page.getByLabel("Filter by type").selectOption({ label: "All qualitative files" });
  await expect(sources.filter({ visible: true })).toHaveCount(0);
  await page.getByLabel("Filter by type").selectOption({ label: "All types" });
  // Sorting: by name, then back to newest first.
  const order = async () => (await sources.evaluateAll((els) => els.map((e) => e.querySelector("button")?.getAttribute("aria-label")?.replace(/^Select /, ""))));
  await page.getByLabel("Sort sources").selectOption({ label: "Name" });
  expect(await order()).toEqual(["client-brief.docx", "golden-survey-documented.xlsx", "report.docx"]);
  await page.getByLabel("Sort sources").selectOption({ label: "Newest first" });
  await page.getByLabel("Filter by state").selectOption({ label: "Needs review" });
  await expect(sources.filter({ visible: true })).toHaveCount(0);
  await expect(page.getByTestId("source-filter-note")).toContainText("No sources match");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(sources.filter({ visible: true })).toHaveCount(3);

  // 6. The programme block below.
  const programme = page.getByTestId("programme-and-wave");
  await expect(programme).not.toHaveAttribute("open", "");
  expect((await programme.boundingBox()).y).toBeGreaterThan(list.y);
  await programme.locator("summary").click();
  await expect(programme.getByRole("button", { name: "Link" })).toBeVisible();
});
