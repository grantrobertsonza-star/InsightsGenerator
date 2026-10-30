// Indicator data (batch 54; Grant, 28 October 2026: "how would I then plot each country on an
// indicator over time from the table?"). Real browser on the disposable stack.
//   1. A World Bank Data360 SDMX download (the DHS slice in fixtures/indicator-data) is suggested as
//      Indicator data from its first lines, and goes in as that type.
//   2. Its Indicator data tab: choose the breakdown and two areas; a line chart with a line per area,
//      the unit and the source under it, and a table whose values are the file's (ZAF 2016 = 89.8,
//      COG 2011 = 84.4 for "three years preceding the survey"); a year with no value is not shown as 0.
//   3. A newer choice replaces the older one; the CSV download holds what is shown.
//   4. A reload keeps nothing that was not saved: the view starts again with no area chosen.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openAddFiles } from "./helpers/addFiles.mjs";
import { openSourceTab, selectSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FILE = path.resolve("fixtures/indicator-data/DHS_SD.csv");

test.use({ viewport: { width: 1600, height: 1000 } });

test("a Data360 download is added as Indicator data and charted by area over time", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  await ui.createRun({ name: `indicator-data-${Date.now()}` });
  await page.getByRole("button", { name: /^Import data/ }).first().click();

  // 1. Suggested from its first lines (the name alone would say Raw data), then uploaded.
  const panel = await openAddFiles(page);
  await panel.getByTestId("add-files-input").setInputFiles(FILE);
  const row = panel.getByTestId("add-files-row");
  await expect(row).toHaveCount(1);
  await expect(panel.getByLabel("Type of DHS_SD.csv")).toHaveValue("indicator");
  await expect(row.getByTestId("add-files-suggested")).toBeVisible();
  await expect(row).toContainText("Published statistics by country or region and year");
  await panel.getByRole("button", { name: /^Upload/ }).click();
  const source = page.getByTestId("source-row").filter({ has: page.getByRole("button", { name: "Select DHS_SD.csv", exact: true }) });
  await expect(source).toContainText("Indicator data", { timeout: 3 * 60_000 });

  // 2. The Indicator data tab.
  await selectSource(page, "DHS_SD.csv");
  await expect(page.getByTestId("file-purpose-text")).toContainText("read as series over time rather than as respondents");
  const view = await openSourceTab(page, "Indicator data");
  await expect(view.getByTestId("indicator-summary")).toContainText("Data360 / SDMX long: 3 series, 4 areas, 23 values", { timeout: 60_000 });
  await expect(view.getByLabel("Indicator")).toContainText("RH_ANCC_W_IRN");
  await view.getByLabel("Breakdown COMP_BREAKDOWN_1").selectOption("ANCC_IRN_03");
  await expect(view.getByText("Choose one or more areas")).toBeVisible();
  await view.getByRole("checkbox", { name: "South Africa (ZAF)" }).check();
  await view.getByRole("checkbox", { name: "Congo, Rep. (COG)" }).check();

  const chart = view.getByTestId("indicator-chart");
  await expect(chart.locator("svg").first()).toBeVisible({ timeout: 60_000 });
  // One line per area (Plot draws a path per series), dots for every value.
  await expect(chart.locator("svg g[aria-label='line'] path")).toHaveCount(2);
  await expect(chart.getByTestId("indicator-chart-unit")).toContainText("Unit: Percentage of women in the same subgroup (PT_W_SUB)");
  await expect(chart.getByTestId("indicator-chart-source")).toContainText("Source: Survey Based Indicators (DHS_SD), file DHS_SD.csv");

  const table = view.getByTestId("indicator-table");
  await expect(table.locator("thead th")).toHaveText(["Period", "South Africa (ZAF)", "Congo, Rep. (COG)"]);
  const cell = (period, column) => table.locator("tbody tr").filter({ has: page.getByRole("rowheader", { name: period, exact: true }) }).locator("td").nth(column);
  await expect(cell("2016", 0)).toHaveText("89.8");
  await expect(cell("2011", 1)).toHaveText("84.4");
  // A year with a value for one area only: the other area says it has none, never 0.
  await expect(cell("2016", 1)).toHaveText("No value");
  await expect(table.getByText(/^0$/)).toHaveCount(0);

  // 3. A newer choice wins: change the breakdown quickly twice; the table shows the last one's values.
  await view.getByLabel("Breakdown COMP_BREAKDOWN_1").selectOption("ANCC_IRN_05");
  await view.getByLabel("Breakdown COMP_BREAKDOWN_1").selectOption("ANCC_IRN_03");
  await expect(cell("2016", 0)).toHaveText("89.8");
  await view.getByLabel("Breakdown COMP_BREAKDOWN_1").selectOption("ANCC_IRN_05");
  await expect(cell("2016", 0)).toHaveText("90");
  const [download] = await Promise.all([page.waitForEvent("download"), view.getByTestId("indicator-download").click()]);
  const csv = readFileSync(await download.path(), "utf8");
  expect(csv.split("\r\n")[0]).toContain("area_code,area,indicator_code,indicator");
  expect(csv).toContain("ANCC_IRN_05");
  expect(csv).toMatch(/ZAF,South Africa \(ZAF\),RH_ANCC_W_IRN,.*,2016,90\.0,90,PT_W_SUB/);
  await page.screenshot({ path: testInfo.outputPath("indicator-data.png"), fullPage: true });

  // 4. Nothing about the choice is saved: after a reload no area is chosen.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Import data/ }).first().click();
  await selectSource(page, "DHS_SD.csv");
  const again = await openSourceTab(page, "Indicator data");
  await expect(again.getByText("Choose one or more areas")).toBeVisible({ timeout: 60_000 });
  await expect(again.getByRole("checkbox", { checked: true })).toHaveCount(0);
});
