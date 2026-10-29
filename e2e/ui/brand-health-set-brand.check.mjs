// Brand Health with a brand set as the brand source (Grant, 29 October 2026, the BMW car tracker), in a real
// browser on the disposable stack. Wave 1 of the BMW pack as SPSS (fixtures/tracker-packs/bmw_car):
//   1. Brand variable offers the multiple-response set owner_b01..owner_b10 (labelled "Current household ownership" in
//      the SPSS file; one member per brand); choosing it states the
//      overlap next to the selector, and Our brand lists the set's ten brands, BMW among them.
//   2. With loyalty mapped to the main brand's recommendation question, the dashboard states the overlap at the top
//      and on the loyalty card (a question split by brand groups), lists the tests across brand groups as not shown,
//      and marks BMW as ours.
//   3. After a reload the mapping comes back with the set and BMW, and the overlap note is shown again.
//   4. Changing the brand source to the plain variable main_brand removes the overlap note and clears our brand.
// Modelled on analytics-landing.check.mjs (opening the tool) and tracker-dashboard.check.mjs (adding the pack).
import { expect, test } from "@playwright/test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addFiles } from "./helpers/addFiles.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

const pack = path.resolve("fixtures/tracker-packs/bmw_car");
const BRANDS = ["Toyota", "Volkswagen", "Ford", "Hyundai", "Kia", "Nissan", "Suzuki", "BMW", "Mercedes-Benz", "Haval"];
const OVERLAP = /a respondent in more than one brand's group is counted in each, so groups overlap and do not sum to the total/;

test.use({ viewport: { width: 1500, height: 1000 } });

test("Brand Health: a multiple-response set as the brand source, overlap stated, kept after a reload", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "brand-set-"));
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `brand-health-set-${Date.now()}` });
    await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
    const file = path.join(dir, "bmw_w1.sav");
    copyFileSync(path.join(pack, "wave1_labels_only_compressed.sav"), file);
    await addFiles(page, [file], "Raw data");
    await expect(page.getByTestId("add-files-error")).toHaveCount(0);

    const openPanel = async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Analytics/ }).first().click();
      const section = page.getByTestId("analytics-section").filter({ visible: true });
      await section.getByRole("list", { name: "Analyses" }).getByRole("button", { name: /^Brand Health Analytics/ }).click({ timeout: 2 * 60_000 });
      const panel = page.getByRole("dialog", { name: "Brand Health Analytics" });
      await expect(panel.getByLabel("Brand variable")).toBeVisible({ timeout: 2 * 60_000 });
      return panel;
    };

    // 1. The set is offered as a brand source; choosing it states the overlap and lists its brands.
    let panel = await openPanel();
    const brandSource = panel.getByLabel("Brand variable");
    const setOption = brandSource.locator("option", { hasText: /^Current household ownership \(10 brands\)/ });
    await expect(setOption).toHaveCount(1, { timeout: 2 * 60_000 });
    const setValue = await setOption.getAttribute("value");
    expect(setValue).toMatch(/^set:/);
    await brandSource.selectOption(setValue);
    await expect(panel.getByTestId("brand-health-overlap-note")).toContainText("(Current household ownership)", { timeout: 60_000 });
    await expect(panel.getByTestId("brand-health-overlap-note")).toContainText(OVERLAP);
    const ourBrand = panel.getByLabel("Our brand");
    for (const brand of BRANDS) await expect(ourBrand.locator("option", { hasText: new RegExp(`^${brand}$`) })).toHaveCount(1);
    await ourBrand.selectOption({ label: "BMW" });
    // The member variable is our brand's identity, not its label.
    await expect(ourBrand).toHaveValue("owner_b08");

    // 2. Loyalty split by the overlapping brand groups.
    const loyalty = panel.getByLabel("Loyalty / NPS");
    const npsValue = await loyalty.locator("option", { hasText: /Recommendation likelihood of main brand/ }).getAttribute("value");
    await loyalty.selectOption(npsValue);
    await panel.getByRole("button", { name: "Build dashboard" }).click();
    await expect(panel.getByTestId("brand-health-dashboard-overlap")).toContainText(OVERLAP, { timeout: 5 * 60_000 });
    const loyaltyCard = panel.locator("div.rounded-xl", { hasText: "Loyalty · Net Promoter Score" });
    await expect(loyaltyCard.getByTestId("brand-health-card-overlap")).toContainText(OVERLAP);
    await expect(loyaltyCard).toContainText("BMW (ours)");
    await expect(panel.getByTestId("brand-health-withheld")).toContainText("Tests across brand groups");
    // The build saves the mapping (started with the dashboard): wait for the save to finish, without an error, before
    // reloading. "Saved" shows only for a moment, so the reload below is what proves it was kept.
    await expect(panel.getByRole("button", { name: "Saving..." })).toHaveCount(0, { timeout: 60_000 });
    await expect(panel.getByTestId("brand-health-save-error")).toHaveCount(0);
    if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, "brand-health-set-brand.png"), fullPage: true });

    // 3. Kept after a reload.
    await page.reload({ waitUntil: "networkidle" });
    panel = await openPanel();
    await expect(panel.getByLabel("Brand variable")).toHaveValue(setValue, { timeout: 60_000 });
    await expect(panel.getByLabel("Our brand")).toHaveValue("owner_b08", { timeout: 60_000 });
    await expect(panel.getByTestId("brand-health-overlap-note")).toContainText(OVERLAP);

    // 4. A plain brand variable: no overlap, our brand cleared.
    const plain = await panel.getByLabel("Brand variable").locator("option", { hasText: /Brand of most used household vehicle/ }).getAttribute("value");
    await panel.getByLabel("Brand variable").selectOption(plain);
    await expect(panel.getByTestId("brand-health-overlap-note")).toHaveCount(0);
    await expect(panel.getByLabel("Our brand")).toHaveValue("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
