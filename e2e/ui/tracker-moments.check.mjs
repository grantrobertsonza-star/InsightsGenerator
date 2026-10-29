// Page 02 of the brand tracking dashboard, "Moments & needs" (Grant's design, 29 October 2026), real browser on the
// disposable stack. BMW wave 1 as SPSS with labels only (fixtures/tracker-packs/bmw_car):
//   1. The dashboard opens on Brand overview (page 01 stays the default); Moments & needs is clickable in the menu,
//      and since batch M4 every page of the menu is a button.
//   2. Moments & needs: the same chips row; "Category moments" lists the twelve moments, highest first, each equal
//      to the independent reference (src/lib/__tests__/helpers/moment_reference.py, weighted) to one decimal.
//   3. "Moment x brand recall": six rows, the six most relevant moments by the reference; one column per compared
//      brand; each cell equal to the reference to one decimal; the footnote says how the rows were chosen and that
//      no statistical comparison is implied.
//   4. Compare: removing a brand removes its column; Brand overview is still there when switching back.
//   5. At 760 wide the menu is replaced by page tabs and the page still fits.
// Written 29 October 2026; not yet run (another process was using the stack).
import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addFiles } from "./helpers/addFiles.mjs";
import { openSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

const pack = path.resolve("fixtures/tracker-packs/bmw_car");
const savFile = path.join(pack, "wave1_labels_only_compressed.sav");
const python = process.env.PYTHON_EXECUTABLE ?? "python3";
const refRun = spawnSync(python, ["-I", path.resolve("src/lib/__tests__/helpers/moment_reference.py"), "shares", savFile], { encoding: "utf8", maxBuffer: 1 << 24 });
if (refRun.status !== 0) throw new Error(`The reference values could not be computed: ${refRun.stderr}`);
const REF = JSON.parse(refRun.stdout).weighted;
const MOMENTS = Array.from({ length: 12 }, (_, i) => `relevant_c${String(i + 1).padStart(2, "0")}`);
const RANKED = [...MOMENTS].sort((a, b) => REF[b][0] - REF[a][0]);
const LABELS = ["Replacing an unreliable car", "Reducing fuel and running costs", "Needing more space for a growing family", "Making the daily commute easier", "Taking long-distance family trips", "Feeling safer on the road", "Marking a career or life achievement", "Enjoying the driving experience", "Choosing lower-emission transport", "Getting technology that simplifies driving", "Staying within a fixed monthly budget", "Driving on rough roads or outdoor trips"];
const BRANDS = ["Toyota", "Volkswagen", "Ford", "Hyundai", "Kia", "Nissan", "Suzuki", "BMW", "Mercedes-Benz", "Haval"];
const labelOf = (v) => LABELS[Number(v.slice(-2)) - 1];
const pct = (v) => `${v.toFixed(1)}%`;

test.use({ viewport: { width: 1500, height: 1000 } });

test("tracker dashboard page 02: category moments and moment by brand recall equal the reference", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-moments-"));
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `tracker-moments-${Date.now()}` });
    await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
    const file = path.join(dir, "bmw_w1.sav");
    copyFileSync(savFile, file);
    await addFiles(page, [file], "Raw data");
    await expect(page.getByTestId("add-files-error")).toHaveCount(0);
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    const setup = await openSource(page, "bmw_w1.sav", "Setup");
    const wave = setup.getByLabel("Wave: bmw_w1.sav");
    await expect(wave).toBeEnabled({ timeout: 2 * 60_000 });
    await wave.fill("Wave 1");
    await wave.blur();
    await expect(setup.getByLabel("Fieldwork month: bmw_w1.sav")).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState("networkidle");

    // 1. Page 01 is the default; page 02 is a button; the later pages are not.
    const section = () => page.getByTestId("analytics-section").filter({ visible: true });
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Analytics/ }).first().click();
    await section().getByTestId("analytics-file-select").selectOption({ label: "Wave 1: bmw_w1.sav" });
    await section().getByTestId("tracker-dashboards").getByRole("button", { name: /^Brand tracking dashboard/ }).click({ timeout: 60_000 });
    const dash = page.getByRole("dialog", { name: "Brand tracking dashboard" });
    await expect(dash.getByTestId("tracker-compare")).toBeVisible({ timeout: 3 * 60_000 });
    const menu = dash.getByRole("navigation", { name: "Brand tracking sections" });
    await expect(menu.getByRole("button", { name: /Brand overview/ })).toHaveAttribute("aria-current", "page");
    // Every page is built since batch M4: all six are buttons.
    await expect(menu.getByRole("button")).toHaveCount(6);

    // 2. Moments & needs.
    await menu.getByRole("button", { name: /Moments & needs/ }).click();
    await expect(menu.getByRole("button", { name: /Moments & needs/ })).toHaveAttribute("aria-current", "page");
    await expect(dash.getByRole("heading", { name: "Moments & needs" })).toBeVisible();
    await expect(dash.getByTestId("tracker-chips")).toContainText("Weighting On");
    const relevance = dash.getByTestId("tracker-moments-relevance");
    await expect(relevance).toBeVisible({ timeout: 3 * 60_000 });
    await expect(relevance).toContainText("Personal relevance, multiple response; n=1,000");
    await expect(relevance.getByTestId("tracker-moment")).toHaveCount(12);
    for (let i = 0; i < 12; i += 1) {
      const row = relevance.getByTestId("tracker-moment").nth(i);
      await expect(row).toContainText(labelOf(RANKED[i]));
      await expect(row.getByTestId("tracker-moment-share")).toHaveText(pct(REF[RANKED[i]][0]));
    }

    // 3. Moment x brand recall: the six most relevant moments, five suggested brands in the file's list order.
    const recall = dash.getByTestId("tracker-moments-recall");
    await expect(recall).toContainText("Cue-specific recall, not personal relevance. All eligible, n=1,000");
    const rows = recall.getByTestId("tracker-recall-row");
    await expect(rows).toHaveCount(6);
    const columns = BRANDS.slice(0, 5);
    for (const [c, brand] of columns.entries()) await expect(recall.locator("thead th").nth(c + 1)).toHaveText(brand);
    for (let r = 0; r < 6; r += 1) {
      const moment = RANKED[r];
      await expect(rows.nth(r).locator("th")).toHaveText(labelOf(moment));
      for (let c = 0; c < columns.length; c += 1) {
        const variable = `cep_${moment.slice(-3)}_b${String(c + 1).padStart(2, "0")}`;
        await expect(rows.nth(r).getByTestId("tracker-recall-cell").nth(c)).toHaveText(pct(REF[variable][0]));
      }
    }
    await expect(recall).toContainText("Six moments selected by highest category relevance. Darker blue = greater cue-specific brand recall; no statistical comparison implied.");
    await page.screenshot({ path: testInfo.outputPath("tracker-moments.png"), fullPage: true });

    // 4. Compare: a brand taken off is a column fewer; page 01 is still there.
    await dash.getByTestId("tracker-chips").getByRole("button", { name: /Compare/ }).click();
    await recall.getByRole("group", { name: "Brands compared" }).getByRole("button", { name: "Ford" }).click();
    await expect(rows.first().getByTestId("tracker-recall-cell")).toHaveCount(4);
    await expect(recall.locator("thead th", { hasText: "Ford" })).toHaveCount(0);
    await menu.getByRole("button", { name: /Brand overview/ }).click();
    await expect(dash.getByTestId("tracker-compare")).toBeVisible();

    // 5. Narrow screen: page tabs instead of the menu; the page fits.
    await page.setViewportSize({ width: 760, height: 1000 });
    const tabs = dash.getByRole("group", { name: "Brand tracking pages" });
    await expect(tabs).toBeVisible();
    await tabs.getByRole("button", { name: "Moments & needs" }).click();
    await expect(recall).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath("tracker-moments-760.png"), fullPage: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
