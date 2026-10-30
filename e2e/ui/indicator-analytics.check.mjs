// D6 Indicator Analytics (Grant's visual plan, 29 October 2026: docs/design/Unified_Indicators_Visual_Plan-2026-10-29.pdf),
// real browser on the disposable stack. Written, not yet run. Two Indicator data files: the full DHS download
// (fixtures/indicator-data/DHS_SD_WIDEF_full.csv) and the OECD reference information (metadata only). Expected figures
// are Grant's reference (fixtures/indicator-data/Chart_Data_RH_ANCC_W_IRN_reference.json), never the app's output.
//   1. Analytics shows the "Indicator Analytics" card; it opens a full-screen workspace with "Auto-generated" and
//      "Observed data only".
//   2. Overview for Kenya, two-year window: latest 90.2% (2022, DHS, 2022), +19.7 pp "2022 vs 2014, not year-on-year",
//      4 observations, four dots labelled 45.8, 71.0, 70.5 and 90.2, and the descriptive summary.
//   3. The three-year window is another series: Kenya's 2022 value is that window's (90.4), never an average.
//   4. Compare, reference period 2022: the seven countries in the reference's order and values; Mozambique's survey
//      label DHS, 2022-23 is kept.
//   5. Trends: small multiples, Kenya first.
//   6. Data & sources: the DHS file ready with 607 observations, the OECD file metadata only, "IMF: no file
//      provided", coverage 71 areas and 213 series.
//   7. Collapsing the selector widens the canvas; Kenya stays chosen.
//   8. At 760 wide the cards stack and nothing scrolls sideways.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addFiles } from "./helpers/addFiles.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

const FIX = path.resolve("fixtures/indicator-data");
const REF = JSON.parse(readFileSync(path.join(FIX, "Chart_Data_RH_ANCC_W_IRN_reference.json"), "utf8"));

test.use({ viewport: { width: 1500, height: 1000 } });

test("indicator analytics: observed trend, change, same-year comparison and sources against the reference", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `indicator-analytics-${Date.now()}` });
  await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
  await addFiles(page, [path.join(FIX, "DHS_SD_WIDEF_full.csv"), path.join(FIX, "OECD_FDI_INC_AGGR_reference.csv")], "Indicator data");
  await expect(page.getByTestId("add-files-error")).toHaveCount(0);

  // 1. The card on Analytics opens the workspace.
  await page.goto(run.url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Analytics/ }).first().click();
  const card = page.getByTestId("indicator-dashboards").filter({ visible: true }).getByRole("button", { name: /^Indicator Analytics/ });
  await card.click({ timeout: 2 * 60_000 });
  const dash = page.getByRole("dialog", { name: "Indicator Analytics" });
  await expect(dash.getByText("Auto-generated", { exact: true })).toBeVisible();
  await expect(dash.getByText("Observed data only", { exact: true })).toBeVisible();
  await dash.getByTestId("indicator-file").selectOption({ label: "DHS_SD_WIDEF_full.csv" });

  // 2. Kenya, the two-year window (the first series, suggested).
  await expect(dash.getByTestId("indicator-breakdown-COMP_BREAKDOWN_1")).toHaveValue("ANCC_IRN_02", { timeout: 2 * 60_000 });
  await dash.getByTestId("indicator-area").selectOption({ label: "Kenya (KEN)" });
  const ken = REF.kenya_observed_trend;
  await expect(dash.getByTestId("indicator-latest")).toContainText(`${ken[3].OBS_VALUE.toFixed(1)}%`, { timeout: 60_000 });
  await expect(dash.getByTestId("indicator-latest")).toContainText("2022, DHS, 2022");
  await expect(dash.getByTestId("indicator-change")).toContainText(`+${(ken[3].OBS_VALUE - ken[2].OBS_VALUE).toFixed(1)} pp`);
  await expect(dash.getByTestId("indicator-change")).toContainText("2022 vs 2014, not year-on-year");
  await expect(dash.getByTestId("indicator-count")).toContainText("4");
  for (const r of ken) await expect(dash.getByTestId("indicator-trend")).toContainText(r.OBS_VALUE.toFixed(1));
  await expect(dash.getByTestId("indicator-summary")).toContainText("For Kenya (KEN), the reported value rose from 70.5% in 2014 to 90.2% in 2022.");
  await expect(dash.getByTestId("indicator-summary")).toContainText("No annual path or statistical significance is inferred.");
  await expect(dash.getByTestId("indicator-definition")).toContainText("One (1)");
  if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, "indicator-overview.png"), fullPage: true });

  // 3. Another window is another series.
  await dash.getByTestId("indicator-breakdown-COMP_BREAKDOWN_1").selectOption("ANCC_IRN_03");
  const ken03 = readFileSync(path.join(FIX, "DHS_SD_WIDEF.csv"), "utf8").split("\n").find((l) => l.includes('"KEN"') && l.includes('"ANCC_IRN_03"') && l.includes('"DHS, 2022"'));
  expect(ken03).toContain('"90.4"');
  await expect(dash.getByTestId("indicator-latest")).toContainText("90.4%", { timeout: 60_000 });
  await dash.getByTestId("indicator-breakdown-COMP_BREAKDOWN_1").selectOption("ANCC_IRN_02");
  await expect(dash.getByTestId("indicator-latest")).toContainText("90.2%", { timeout: 60_000 });

  // 4. Compare, 2022.
  await dash.getByRole("tab", { name: "Compare" }).click();
  const compare = dash.getByTestId("indicator-compare");
  await expect(compare).toContainText("Reference period 2022", { timeout: 60_000 });
  const rows = compare.locator("ol > li");
  await expect(rows).toHaveCount(REF.common_year_2022.length);
  for (const [i, r] of REF.common_year_2022.entries()) await expect(rows.nth(i)).toHaveText(new RegExp(`^\\s*${r.labels.REF_AREA_LABEL} \\(${r.series_key.REF_AREA}\\)\\s*${r.OBS_VALUE.toFixed(1).replace(".", "\\.")}%\\s*$`));
  await expect(compare).toContainText("Mozambique (MOZ): DHS, 2022-23");
  if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, "indicator-compare.png"), fullPage: true });

  // 5. Trends.
  await dash.getByRole("tab", { name: "Trends" }).click();
  await expect(dash.getByTestId("indicator-trend-panel").first()).toContainText("Kenya (KEN)", { timeout: 60_000 });

  // 6. Data & sources.
  await dash.getByRole("tab", { name: "Data & sources" }).click();
  const sources = dash.getByTestId("indicator-sources");
  await expect(sources).toContainText("607 observations, 3 series, 71 areas");
  await expect(sources).toContainText("Metadata only: no charts");
  await expect(sources).toContainText("IMF: no file provided");
  await expect(dash.getByTestId("indicator-coverage")).toContainText("71");
  await expect(dash.getByTestId("indicator-coverage")).toContainText("213");
  await expect(dash.getByTestId("indicator-coverage")).toContainText("10.2 to 97.8");

  // 7. Collapse the selector: the canvas widens, and the choice stays.
  await dash.getByRole("tab", { name: "Overview" }).click();
  const canvas = dash.getByTestId("indicator-overview");
  const before = (await canvas.boundingBox()).width;
  await dash.getByRole("button", { name: "Hide the dashboard selector" }).click();
  await expect.poll(async () => (await canvas.boundingBox()).width).toBeGreaterThan(before);
  await expect(dash.getByTestId("indicator-area")).toHaveValue("KEN");

  // 8. Narrow: no sideways scroll.
  await page.setViewportSize({ width: 760, height: 1000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, "indicator-narrow.png"), fullPage: true });
});
