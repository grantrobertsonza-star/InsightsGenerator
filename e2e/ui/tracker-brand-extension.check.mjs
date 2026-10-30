// r6brandext: the brand dashboard extension's pages (Grant's guide of 30 October 2026), real browser on the disposable
// stack, a production build where the stack serves one (E2E_NEXT_START).
//   1. Banking wave 1 as the labelled workbook (fixtures/packs-2026-10-30/brand/banks): the extension's pages sit in their
//      own group under the dashboard's menu ("Extension"); the dashboard's own six pages are unchanged.
//   2. Needs, difference & price: the Variables selector on the left lists the five constructs as Found; a construct's
//      details show its question, source fields, answers, universe and denominator; the selector collapses and opens
//      again. FNB's top-two-box and cannot-judge share equal the pack's reference (weighted, one decimal); switching to
//      Unweighted gives the unweighted reference; Price justification says it is not pricing power.
//   3. Ideal vs actual choice: the gap rate, FNB's ideal and actual shares on the same paired base, the statuses beside
//      the chart, the reasons (ten, plus the two exclusive answers apart) equal the reference; reasons by ideal brand.
//   4. At 760 wide the extension's pages are tabs in their own group; the page fits.
//   5. The original BMW pack: every construct Not measured, with no figure.
// Screenshots at 1440x900 are written to docs/screenshots/r6brandext/ when R6_SCREENSHOTS=1.
import { expect, test } from "@playwright/test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addFiles } from "./helpers/addFiles.mjs";
import { openSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

const bank = path.resolve("fixtures/packs-2026-10-30/brand/banks");
const REF = JSON.parse(readFileSync(path.join(bank, "test-reference", "reference_results.json"), "utf8")).results.filter((r) => r.chart === "Measurement extension" && r.wave === 1);
const ref = (metric, brand, weighting = "weighted") => REF.find((r) => r.metric === metric && r.brand === brand && r.weighting === weighting).expected;
const pct = (v) => `${v.toFixed(1)}%`;
const SHOTS = process.env.R6_SCREENSHOTS === "1" ? path.resolve("docs/screenshots/r6brandext") : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (page, testInfo, name) => page.screenshot({ path: SHOTS ? path.join(SHOTS, name) : testInfo.outputPath(name), fullPage: false });

test.use({ viewport: { width: 1440, height: 900 } });

async function openDashboard(page, testInfo, { projectName, file, wave }) {
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: projectName });
  await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
  await addFiles(page, [file], "Raw data");
  await expect(page.getByTestId("add-files-error")).toHaveCount(0);
  await page.getByRole("button", { name: /^Import data/ }).first().click();
  const base = path.basename(file);
  const setup = await openSource(page, base, "Setup");
  const waveInput = setup.getByLabel(`Wave: ${base}`);
  await expect(waveInput).toBeEnabled({ timeout: 4 * 60_000 });
  await waveInput.fill(wave);
  await waveInput.blur();
  await expect(setup.getByLabel(`Fieldwork month: ${base}`)).toBeVisible({ timeout: 60_000 });
  await page.waitForLoadState("networkidle");
  const section = () => page.getByTestId("analytics-section").filter({ visible: true });
  await expect(async () => {
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Analytics/ }).first().click();
    await section().getByTestId("analytics-file-select").selectOption({ label: `${wave}: ${base}` }, { timeout: 10_000 });
  }).toPass({ timeout: 3 * 60_000 });
  await section().getByTestId("tracker-dashboards").getByRole("button", { name: /^Brand tracking dashboard/ }).click({ timeout: 60_000 });
  const dash = page.getByRole("dialog", { name: "Brand tracking dashboard" });
  await expect(dash.getByTestId("tracker-compare")).toBeVisible({ timeout: 5 * 60_000 });
  return dash;
}

test("brand extension: ratings, ideal versus actual and the Variables selector equal the pack's reference", async ({ page }, testInfo) => {
  test.setTimeout(20 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "brand-extension-"));
  try {
    const file = path.join(dir, "Bank_Brand_Tracker_Wave_1.xlsx");
    copyFileSync(path.join(bank, "Bank_Brand_Tracker_Wave_1.xlsx"), file);
    // "FNB" in the project name pre-fills the client's brand.
    const dash = await openDashboard(page, testInfo, { projectName: `FNB banking extension ${Date.now()}`, file, wave: "Wave 1" });

    // 1. The extension's own group; the dashboard's own pages unchanged.
    const menu = dash.getByRole("navigation", { name: "Brand tracking sections" });
    await expect(menu.getByRole("button")).toHaveCount(6);
    const ext = dash.getByRole("navigation", { name: "Brand extension sections" });
    await expect(ext.getByRole("button")).toHaveCount(2);

    // 2. Needs, difference & price.
    await ext.getByRole("button", { name: /Needs, difference & price/ }).click();
    await expect(ext.getByRole("button", { name: /Needs, difference & price/ })).toHaveAttribute("aria-current", "page");
    const page1 = dash.getByTestId("brand-extension-page");
    await expect(page1.getByRole("heading", { name: "Needs, difference & price" })).toBeVisible();
    const selector = page1.getByTestId("ext-variables");
    await expect(selector).toHaveAttribute("data-open", "true", { timeout: 5 * 60_000 });
    const constructs = selector.getByTestId("ext-construct");
    await expect(constructs).toHaveCount(5);
    for (let i = 0; i < 5; i += 1) await expect(constructs.nth(i)).toHaveAttribute("data-status", "found");
    const fnb = page1.locator('[data-testid="ext-rating-row"][data-code="8"]');
    await expect(fnb.getByTestId("ext-top2")).toContainText(pct(ref("needsfit_top2", "FNB")));
    await expect(fnb.getByTestId("ext-cannot-judge")).toHaveText(pct(ref("needsfit_dk", "FNB")));
    await expect(page1.getByTestId("ext-context")).toContainText("Weighted by weight");
    await shot(page, testInfo, "01-ratings-needs-fit-1440.png");

    // Details of a construct: question, fields, answers, universe and denominator.
    await constructs.nth(2).getByRole("button").first().click();
    const details = constructs.nth(2).getByTestId("ext-construct-details");
    await expect(details).toContainText("pricejustify_b01");
    await expect(details).toContainText("9 Not familiar enough with its prices to judge");
    await expect(details).toContainText("Universe: Respondents aware of each brand");
    await expect(details).toContainText("Denominator:");
    await page1.getByTestId("ext-construct-tab").filter({ hasText: "Price justification" }).click();
    await expect(page1.getByTestId("ext-rating-card")).toContainText("not pricing power");
    await expect(fnb.getByTestId("ext-top2")).toContainText(pct(ref("pricejustify_top2", "FNB")));
    await shot(page, testInfo, "02-ratings-price-details-1440.png");

    // Collapse and open the selector without losing the page.
    await selector.getByTestId("ext-variables-toggle").click();
    await expect(page1.getByTestId("ext-variables")).toHaveAttribute("data-open", "false");
    await expect(page1.getByTestId("ext-rating-card")).toBeVisible();
    await shot(page, testInfo, "03-ratings-variables-collapsed-1440.png");
    await page1.getByTestId("ext-variables-toggle").click();
    await expect(page1.getByTestId("ext-variables")).toHaveAttribute("data-open", "true");

    // Unweighted: every base and figure changes together.
    await page1.getByRole("group", { name: "Weighting" }).getByRole("button", { name: "Unweighted" }).click();
    await expect(page1.getByTestId("ext-context")).toContainText("Unweighted.", { timeout: 3 * 60_000 });
    await expect(fnb.getByTestId("ext-top2")).toContainText(pct(ref("pricejustify_top2", "FNB", "unweighted")));
    await page1.getByRole("group", { name: "Weighting" }).getByRole("button", { name: "Weighted", exact: true }).click();
    await expect(page1.getByTestId("ext-context")).toContainText("Weighted by weight", { timeout: 3 * 60_000 });

    // 3. Ideal vs actual choice.
    await ext.getByRole("button", { name: /Ideal vs actual choice/ }).click();
    const page2 = dash.getByTestId("brand-extension-page");
    await expect(page2).toHaveAttribute("data-page", "choice");
    await expect(page2.getByTestId("ext-gap-rate")).toHaveText(pct(ref("choice_gap_rate", "All")), { timeout: 5 * 60_000 });
    const fnbShare = page2.locator('[data-testid="ext-share-row"][data-key="brand:8"]');
    await expect(fnbShare).toContainText(`${pct(ref("choice_ideal_share", "FNB"))} / ${pct(ref("choice_actual_share", "FNB"))}`);
    await expect(page2.getByTestId("ext-choice-statuses")).toContainText("No particular ideal brand");
    await expect(page2.getByTestId("ext-choice-statuses")).toContainText("Cannot recall");
    const reasons = page2.getByTestId("ext-reasons-overall");
    await expect(reasons.getByTestId("ext-reason-row")).toHaveCount(10);
    await expect(reasons.locator('[data-variable="choice_barrier_r01"]')).toContainText(pct(ref("choice_barrier_r01_rate", "All")));
    await expect(reasons.getByTestId("ext-reason-exclusive")).toHaveCount(2);
    await expect(reasons.locator('[data-testid="ext-reason-exclusive"][data-variable="choice_barrier_none"]')).toContainText(pct(ref("choice_barrier_none_rate", "All")));
    await page2.getByTestId("ext-reasons-brand").selectOption({ label: "FNB" });
    await expect(page2.getByTestId("ext-reasons-brand-list")).toContainText("Eligible (different brands)");
    await shot(page, testInfo, "04-choice-1440.png");
    await page2.getByTestId("ext-reasons").scrollIntoViewIfNeeded();
    await shot(page, testInfo, "05-choice-reasons-1440.png");

    // 4. Narrow screen: the extension's pages are tabs in their own group; the page fits.
    await page.setViewportSize({ width: 760, height: 1000 });
    const tabs = dash.getByRole("group", { name: "Brand extension pages" });
    await expect(tabs.getByRole("button")).toHaveCount(2);
    await expect(dash.getByRole("group", { name: "Brand tracking pages" }).getByRole("button")).toHaveCount(6);
    await tabs.getByRole("button", { name: "Needs, difference & price" }).click();
    await expect(dash.getByTestId("ext-rating-card")).toBeVisible({ timeout: 3 * 60_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: SHOTS ? path.join(SHOTS, "06-ratings-760.png") : testInfo.outputPath("06-ratings-760.png"), fullPage: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("brand extension: the original BMW pack shows Not measured for every construct", async ({ page }, testInfo) => {
  test.setTimeout(15 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "brand-extension-bmw-"));
  try {
    const file = path.join(dir, "bmw_w1.sav");
    copyFileSync(path.resolve("fixtures/tracker-packs/bmw_car/wave1_labels_only_compressed.sav"), file);
    const dash = await openDashboard(page, testInfo, { projectName: `BMW extension ${Date.now()}`, file, wave: "Wave 1" });
    await dash.getByRole("navigation", { name: "Brand extension sections" }).getByRole("button", { name: /Needs, difference & price/ }).click();
    const p = dash.getByTestId("brand-extension-page");
    const constructs = p.getByTestId("ext-construct");
    await expect(constructs).toHaveCount(5, { timeout: 5 * 60_000 });
    for (let i = 0; i < 5; i += 1) await expect(constructs.nth(i)).toHaveAttribute("data-status", "not_measured");
    await expect(p.getByTestId("ext-rating-unavailable")).toContainText("Not measured");
    await expect(p.getByTestId("ext-rating-row")).toHaveCount(0);
    await shot(page, testInfo, "07-bmw-not-measured-1440.png");
    await dash.getByRole("navigation", { name: "Brand extension sections" }).getByRole("button", { name: /Ideal vs actual choice/ }).click();
    await expect(dash.getByTestId("ext-choice-unavailable")).toContainText("Not measured", { timeout: 5 * 60_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
