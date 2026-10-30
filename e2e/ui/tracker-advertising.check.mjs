// Page 04 of the brand tracking dashboard, "Advertising & WOM" (Grant's design, 29 October 2026), real browser on the
// disposable stack. BMW wave 1 as SPSS with labels only (fixtures/tracker-packs/bmw_car):
//   1. Advertising & WOM is a button in the menu; opening it shows the page with the same chips row.
//   2. "Advertising recall": ten brands ranked by the share answering yes, BMW highlighted, each yes share and not
//      sure share equal to the independent reference (src/lib/__tests__/helpers/advertising_reference.py, weighted)
//      to one decimal; the footnote says recall is self-reported, not verified exposure or media effectiveness.
//   3. "Word of mouth": the six exclusive groups in the legend; one stacked bar per brand, BMW first; BMW's groups
//      equal to the reference to one decimal.
//   4. At 760 wide the menu is replaced by page tabs and the page still fits.
// Written 29 October 2026; not yet run.
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
const refRun = spawnSync(python, ["-I", path.resolve("src/lib/__tests__/helpers/advertising_reference.py"), "shares", savFile], { encoding: "utf8", maxBuffer: 1 << 24 });
if (refRun.status !== 0) throw new Error(`The reference values could not be computed: ${refRun.stderr}`);
const REF = JSON.parse(refRun.stdout);
const BRANDS = ["Toyota", "Volkswagen", "Ford", "Hyundai", "Kia", "Nissan", "Suzuki", "BMW", "Mercedes-Benz", "Haval"];
const key = (i) => `b${String(i + 1).padStart(2, "0")}`;
const pct = (v) => `${v.toFixed(1)}%`;

test.use({ viewport: { width: 1500, height: 1000 } });

test("tracker dashboard page 04: advertising recall and word of mouth equal the reference", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-advertising-"));
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    // "BMW" in the project name pre-fills the client's brand (prefilledFocalBrand).
    const run = await ui.createRun({ name: `BMW tracker-advertising-${Date.now()}` });
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

    // 1. Page 04 is a button in the menu.
    const section = () => page.getByTestId("analytics-section").filter({ visible: true });
    // The wave label's save can still be on its way when the page is opened (blur does not wait for it); the page shows
    // it once saved, so the page is opened again until the labelled file is there.
    await expect(async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Analytics/ }).first().click();
      await section().getByTestId("analytics-file-select").selectOption({ label: "Wave 1: bmw_w1.sav" }, { timeout: 10_000 });
    }).toPass({ timeout: 2 * 60_000 });
    await section().getByTestId("tracker-dashboards").getByRole("button", { name: /^Brand tracking dashboard/ }).click({ timeout: 60_000 });
    const dash = page.getByRole("dialog", { name: "Brand tracking dashboard" });
    await expect(dash.getByTestId("tracker-compare")).toBeVisible({ timeout: 3 * 60_000 });
    const menu = dash.getByRole("navigation", { name: "Brand tracking sections" });
    await expect(menu.getByRole("button", { name: /Brand overview/ })).toHaveAttribute("aria-current", "page");
    await menu.getByRole("button", { name: /Advertising & WOM/ }).click();
    await expect(menu.getByRole("button", { name: /Advertising & WOM/ })).toHaveAttribute("aria-current", "page");
    await expect(dash.getByRole("heading", { name: "Advertising & WOM" })).toBeVisible();
    await expect(dash.getByTestId("tracker-chips")).toContainText("Weighting On");
    await expect(dash.getByTestId("tracker-chips")).toContainText("Brand BMW");

    // 2. Advertising recall: ten brands ranked by yes, BMW highlighted, each yes and not sure share as the reference.
    const recall = dash.getByTestId("tracker-ad-recall");
    await expect(recall).toBeVisible({ timeout: 3 * 60_000 });
    await expect(recall).toContainText("Prompted recall among those asked about each brand; BMW n=831");
    const rows = recall.getByTestId("tracker-ad-recall-row");
    await expect(rows).toHaveCount(10);
    const ranked = BRANDS.map((name, i) => ({ name, i, r: REF.weighted.recall[key(i)] })).sort((a, b) => b.r[0] - a.r[0]);
    for (let r = 0; r < 10; r += 1) {
      const row = rows.nth(r);
      await expect(row).toHaveAttribute("data-code", String(ranked[r].i + 1));
      await expect(row.getByTestId("tracker-ad-recall-yes")).toHaveText(pct(ranked[r].r[0]));
      await expect(row.getByTestId("tracker-ad-recall-not-sure")).toHaveText(`not sure ${pct(ranked[r].r[1])}`);
    }
    await expect(recall.getByTestId("tracker-ad-recall-note")).toContainText("Self-reported recall is not verified ad exposure or an estimate of media effectiveness.");
    await expect(recall.getByTestId("tracker-ad-recall-note")).toContainText("Not sure answers stay in the base");

    // 3. Word of mouth: six groups in the legend; one stacked bar per brand, BMW first; BMW's groups as the reference.
    const wom = dash.getByTestId("tracker-wom");
    await expect(wom).toContainText("Exclusive groups; all eligible respondents; n=1,000");
    await expect(wom.getByTestId("tracker-wom-legend").locator("li")).toHaveText(["Mainly positive", "Mainly negative", "Mixed", "Neutral", "Not heard", "Unaware"]);
    await expect(wom.getByTestId("tracker-wom-row")).toHaveCount(10);
    await expect(wom.getByTestId("tracker-wom-row").first()).toHaveAttribute("data-code", "8");
    const g = REF.weighted.wom.b08;
    await expect(wom.getByTestId("tracker-wom-focal")).toHaveText(`BMW: Mainly positive ${pct(g["1"])} | Mainly negative ${pct(g["2"])} | Mixed ${pct(g["3"])} | Neutral ${pct(g["4"])} | Not heard ${pct(g["5"])} | Unaware ${pct(g.unaware)}`);
    await expect(wom.getByTestId("tracker-wom-row").first().getByTestId("tracker-wom-segment")).toHaveCount(6);
    await page.screenshot({ path: testInfo.outputPath("tracker-advertising.png"), fullPage: true });

    // 4. Narrow screen: page tabs instead of the menu; the page fits.
    await page.setViewportSize({ width: 760, height: 1000 });
    const tabs = dash.getByRole("group", { name: "Brand tracking pages" });
    await expect(tabs).toBeVisible();
    await tabs.getByRole("button", { name: "Advertising & WOM" }).click();
    await expect(recall).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath("tracker-advertising-760.png"), fullPage: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
