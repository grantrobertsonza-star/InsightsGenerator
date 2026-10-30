// The Conversion view of the brand dashboard's funnel card (page 01, Grant, 30 October 2026), real browser on the
// disposable stack. BMW pack wave 1 as SPSS (fixtures/tracker-packs/bmw_car):
//   1. The funnel card opens on "Funnel" (the comparison rows); "Conversion" shows three ranked charts (Awareness to
//      Consideration, Consideration to Shortlist, Shortlist to First choice) for every brand, with "Usage to Frequent
//      usage" skipped for want of a frequent usage question.
//   2. After choosing BMW, its bar is marked and its value in each step equals the independent pandas reference
//      (src/lib/__tests__/helpers/conversion_reference.py, weighted) to one decimal; its headline gives its rank among
//      ten brands; a bar's base is in its accessible name; the table lists all 30 figures.
//   3. "Funnel" again shows the comparison rows without recalculating.
// Screenshots at 1440 x 900 when SHOT_DIR is set.
import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addFiles } from "./helpers/addFiles.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

const wave1 = path.resolve("fixtures/tracker-packs/bmw_car/wave1_labels_only_compressed.sav");
const refRun = spawnSync("python3", ["-I", path.resolve("src/lib/__tests__/helpers/conversion_reference.py"), "conversions", wave1], { encoding: "utf8", maxBuffer: 1 << 24 });
if (refRun.status !== 0) throw new Error(refRun.stderr);
const REF = JSON.parse(refRun.stdout).weighted;

test.use({ viewport: { width: 1440, height: 900 } });

test("tracker conversion: ranked charts per step, BMW equal to the reference, back to the funnel", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-conv-"));
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `tracker-conversion-${Date.now()}` });
    const file = path.join(dir, "bmw_w1.sav");
    copyFileSync(wave1, file);
    await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
    await addFiles(page, [file], "Raw data");
    await expect(page.getByTestId("add-files-error")).toHaveCount(0);

    const section = () => page.getByTestId("analytics-section").filter({ visible: true });
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Analytics/ }).first().click();
    await section().getByTestId("analytics-file-select").selectOption({ label: "bmw_w1.sav" });
    await section().getByTestId("tracker-dashboards").getByRole("button", { name: /^Brand tracking dashboard/ }).click({ timeout: 60_000 });
    const dash = page.getByRole("dialog", { name: "Brand tracking dashboard" });
    const card = dash.getByTestId("tracker-compare");
    await expect(card).toBeVisible({ timeout: 3 * 60_000 });

    // Choose BMW as the client's brand.
    await dash.getByRole("button", { name: "Customise dashboard" }).click();
    await dash.getByTestId("tracker-customise").getByLabel("Which brand is yours?").selectOption({ label: "BMW" });
    await dash.getByTestId("tracker-customise").getByRole("button", { name: "Apply changes" }).click();
    await expect(dash.getByText("Saved for this project.")).toBeVisible({ timeout: 2 * 60_000 });
    await expect(card.getByTestId("tracker-compare-row").first()).toContainText("BMW", { timeout: 2 * 60_000 });

    // 1. Funnel by default; Conversion on request.
    const view = card.getByTestId("tracker-funnel-view");
    await expect(view.getByRole("button", { name: "Funnel" })).toHaveAttribute("aria-pressed", "true");
    if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, "funnel-1440x900.png") });
    await view.getByRole("button", { name: "Conversion" }).click();
    await expect(view.getByRole("button", { name: "Conversion" })).toHaveAttribute("aria-pressed", "true");
    const steps = card.getByTestId("tracker-conversion-step");
    await expect(steps).toHaveCount(3, { timeout: 4 * 60_000 });
    await expect(card.getByTestId("tracker-compare-row").first()).toBeHidden();
    await expect(steps.nth(0)).toContainText("Awareness to Consideration");
    await expect(steps.nth(2)).toContainText("Shortlist to First choice");
    await expect(card.getByTestId("tracker-conversion-skipped")).toContainText("Usage to Frequent usage: no frequent usage question was found in this file.");

    // 2. BMW's figure in each step equals the reference; its headline ranks it among ten.
    const keys = ["aware>consider", "consider>shortlist", "shortlist>firstchoice"];
    for (let i = 0; i < 3; i++) {
      await expect(steps.nth(i).getByTestId("tracker-conversion-bar")).toHaveCount(10);
      const bmw = steps.nth(i).locator('[data-testid="tracker-conversion-bar"][data-focal="true"]');
      await expect(bmw).toHaveAttribute("data-code", "8");
      await expect(bmw.getByTestId("tracker-conversion-value")).toHaveText(`${REF[keys[i]].b08.conversion.toFixed(1)}%`);
      await expect(bmw).toHaveAttribute("aria-label", new RegExp(`base n=${REF[keys[i]].b08.base}\\b`));
      await expect(steps.nth(i).getByTestId("tracker-conversion-headline")).toHaveText(new RegExp(`^BMW converts ${Math.round(REF[keys[i]].b08.conversion)}% of \\w[\\w-]* respondents to [a-z ]+, \\d+(st|nd|rd|th) of 10 brands\\.$`));
      // Ranked: values in the chart never rise from top to bottom.
      const values = (await steps.nth(i).getByTestId("tracker-conversion-value").allTextContents()).map((t) => Number.parseFloat(t));
      expect(values.every((v, j) => j === 0 || v <= values[j - 1])).toBe(true);
    }
    await expect(card.getByTestId("tracker-conversion-basis")).toContainText("Weighted by weight");
    await expect(card.getByTestId("tracker-conversion-nonnested")).toHaveCount(0);
    if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, "conversion-1440x900.png") });
    await card.getByTestId("tracker-funnel-view").evaluate((el) => el.scrollIntoView({ block: "start" }));
    if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, "conversion-charts-1440x900.png") });
    await card.getByTestId("tracker-conversion-step").first().scrollIntoViewIfNeeded();
    if (process.env.SHOT_DIR) await card.screenshot({ path: path.join(process.env.SHOT_DIR, "conversion-card.png") });
    await card.getByTestId("tracker-conversion-table").locator("summary").click();
    await expect(card.getByTestId("tracker-conversion-table").locator("tbody tr")).toHaveCount(30);
    await steps.nth(0).locator('[data-testid="tracker-conversion-bar"][data-focal="true"]').focus();
    if (process.env.SHOT_DIR) await card.screenshot({ path: path.join(process.env.SHOT_DIR, "conversion-table.png") });

    // 3. Back to the funnel.
    await view.getByRole("button", { name: "Funnel" }).click();
    await expect(card.getByTestId("tracker-compare-row").first()).toBeVisible();
    await expect(steps.first()).toBeHidden();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
