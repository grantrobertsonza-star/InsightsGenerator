// Page 03 of the brand tracking dashboard, "Brand associations" (Grant's design, 29 October 2026), real browser on
// the disposable stack. BMW wave 1 as SPSS with labels only (fixtures/tracker-packs/bmw_car):
//   1. The dashboard opens on Brand overview (page 01 stays the default); Moments & needs and Brand associations are
//      clickable in the menu (since batch M4 every page is a button).
//   2. Brand associations: the same chips row; the "Association profile" card says the associations are pick-any,
//      each brand on its own awareness base and not agreement scores; ten attribute rows in the grid's order; the
//      client's brand's value at the right of each row equal to the independent reference
//      (src/lib/__tests__/helpers/association_reference.py, weighted) to one decimal; one dot per plotted brand;
//      a legend naming each plotted brand; the footnote gives every plotted brand's aware base (reference counts)
//      and says the positioning model appears only after a supported analysis.
//   3. Compare: removing a brand removes its dots and its legend entry.
//   4. At 760 wide the menu is replaced by page tabs (all six pages since batch M4) and the page still fits.
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
const refRun = spawnSync(python, ["-I", path.resolve("src/lib/__tests__/helpers/association_reference.py"), "shares", savFile], { encoding: "utf8", maxBuffer: 1 << 24 });
if (refRun.status !== 0) throw new Error(`The reference values could not be computed: ${refRun.stderr}`);
const REF = JSON.parse(refRun.stdout);
const ATTRIBUTES = ["Reliable", "Affordable to run", "Good value for money", "Safe", "Comfortable", "Enjoyable to drive", "Advanced technology", "Premium quality", "Environmentally responsible", "Good dealer and aftersales support"];
const BRANDS = ["Toyota", "Volkswagen", "Ford", "Hyundai", "Kia", "Nissan", "Suzuki", "BMW", "Mercedes-Benz", "Haval"];
const key = (i) => `b${String(i + 1).padStart(2, "0")}`;
const pct = (v) => `${v.toFixed(1)}%`;

test.use({ viewport: { width: 1500, height: 1000 } });

test("tracker dashboard page 03: association profile equals the reference, each brand on its aware base", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-associations-"));
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    // "BMW" in the project name pre-fills the client's brand (prefilledFocalBrand).
    const run = await ui.createRun({ name: `BMW tracker-associations-${Date.now()}` });
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

    // 1. Page 01 is the default; pages 02 and 03 are buttons; the later pages are not.
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
    await expect(menu.getByRole("button", { name: /Moments & needs/ })).toBeVisible();
    // Every page is built since batch M4: all six are buttons.
    await expect(menu.getByRole("button")).toHaveCount(6);

    // 2. Brand associations.
    await menu.getByRole("button", { name: /Brand associations/ }).click();
    await expect(menu.getByRole("button", { name: /Brand associations/ })).toHaveAttribute("aria-current", "page");
    await expect(dash.getByRole("heading", { name: "Brand associations" })).toBeVisible();
    await expect(dash.getByText("Compare what aware respondents associate with each brand.")).toBeVisible();
    await expect(dash.getByTestId("tracker-chips")).toContainText("Weighting On");
    const profile = dash.getByTestId("tracker-associations-profile");
    await expect(profile).toBeVisible({ timeout: 3 * 60_000 });
    await expect(profile).toContainText("Pick-any associations. Each brand uses its own awareness base; these are not agreement scores.");
    await expect(dash.getByTestId("tracker-chips")).toContainText("Brand BMW");
    const rows = profile.getByTestId("tracker-association-row");
    await expect(rows).toHaveCount(10);
    // Plotted: BMW (the client's brand) and the five suggested brands.
    const legend = profile.getByTestId("tracker-associations-legend");
    await expect(legend.locator("li").first()).toHaveText("BMW");
    const plotted = await legend.locator("li").allTextContents();
    expect(plotted.length).toBeGreaterThanOrEqual(2);
    for (let r = 0; r < 10; r += 1) {
      const row = rows.nth(r);
      await expect(row.locator("span").first()).toHaveText(ATTRIBUTES[r]);
      const variable = `attr_a${String(r + 1).padStart(2, "0")}_b08`;
      await expect(row.getByTestId("tracker-association-focal")).toHaveText(pct(REF.weighted[variable][0]));
      await expect(row.getByTestId("tracker-association-dot")).toHaveCount(plotted.length);
    }
    const bases = profile.getByTestId("tracker-associations-bases");
    for (const name of plotted) await expect(bases).toContainText(`${name} ${REF.aware_n[key(BRANDS.indexOf(name))].toLocaleString("en-US")}`);
    await expect(bases).toContainText("Positioning model appears only when a supported analysis has completed.");
    await page.screenshot({ path: testInfo.outputPath("tracker-associations.png"), fullPage: true });

    // 3. Compare: a brand taken off loses its dots and its legend entry.
    const removed = plotted[1];
    await dash.getByTestId("tracker-chips").getByRole("button", { name: /Compare/ }).click();
    await profile.getByRole("group", { name: "Brands compared" }).getByRole("button", { name: removed, exact: true }).click();
    await expect(legend.locator("li")).toHaveCount(plotted.length - 1);
    await expect(rows.first().getByTestId("tracker-association-dot")).toHaveCount(plotted.length - 1);
    await expect(rows.first().locator(`[data-testid="tracker-association-dot"][data-code="${BRANDS.indexOf(removed) + 1}"]`)).toHaveCount(0);

    // 4. Narrow screen: page tabs instead of the menu; the page fits.
    await page.setViewportSize({ width: 760, height: 1000 });
    const tabs = dash.getByRole("group", { name: "Brand tracking pages" });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("button")).toHaveCount(6);
    await tabs.getByRole("button", { name: "Brand associations" }).click();
    await expect(profile).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath("tracker-associations-760.png"), fullPage: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
