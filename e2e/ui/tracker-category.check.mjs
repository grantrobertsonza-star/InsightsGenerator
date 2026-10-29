// The brand tracking dashboard's "Category overview" page (Grant's design, page 08, 29 October 2026), real browser on
// the disposable stack. BMW wave 1 as SPSS with labels only (fixtures/tracker-packs/bmw_car):
//   1. Category overview is a button in the menu (every page is a button since batch M4).
//   2. "Brand repertoire": recognised, considered and acquired, each the mean per respondent equal to the independent
//      reference (src/lib/__tests__/helpers/category_reference.py, weighted) to one decimal.
//   3. "How decisions are made": three answers, each share equal to the reference; "Most recent acquisition channel":
//      seven answers (Other included) among the 234 who answered, each equal to the reference.
//   4. At 760 wide the menu is replaced by page tabs (six, wrapping) and the page still fits.
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
const refRun = spawnSync(python, ["-I", path.resolve("src/lib/__tests__/helpers/category_reference.py"), "shares", savFile], { encoding: "utf8", maxBuffer: 1 << 24 });
if (refRun.status !== 0) throw new Error(`The reference values could not be computed: ${refRun.stderr}`);
const REF = JSON.parse(refRun.stdout);
const pct = (v) => `${v.toFixed(1)}%`;

test.use({ viewport: { width: 1500, height: 1000 } });

test("tracker dashboard Category overview: repertoires, decision style and acquisition channel equal the reference", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-category-"));
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    // "BMW" in the project name pre-fills the client's brand (prefilledFocalBrand).
    const run = await ui.createRun({ name: `BMW tracker-category-${Date.now()}` });
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

    // 1. Every page is a button; open Category overview.
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
    await expect(menu.getByRole("button")).toHaveCount(6);
    await menu.getByRole("button", { name: /Category overview/ }).click();
    await expect(menu.getByRole("button", { name: /Category overview/ })).toHaveAttribute("aria-current", "page");
    await expect(dash.getByRole("heading", { name: "Category overview" })).toBeVisible();
    await expect(dash.getByTestId("tracker-chips")).toContainText("Weighting On");

    // 2. Brand repertoire.
    const repertoire = dash.getByTestId("tracker-category-repertoire");
    await expect(repertoire).toBeVisible({ timeout: 3 * 60_000 });
    await expect(repertoire).toContainText("mean per respondent, tracked brands only (Other excluded)");
    for (const [stage, key] of [["awareness", "aware"], ["consideration", "consider"], ["acquisition", "bought12"]]) {
      const row = repertoire.locator(`[data-testid="tracker-category-repertoire-row"][data-stage="${stage}"]`);
      await expect(row.getByTestId("tracker-category-repertoire-mean")).toHaveText(REF.weighted.repertoire[key][0].toFixed(1));
    }

    // 3. Decision style and acquisition channel.
    const decision = dash.getByTestId("tracker-category-decision");
    await expect(decision.getByTestId("tracker-category-decision-row")).toHaveCount(3);
    for (const code of ["1", "2", "3"]) {
      await expect(decision.locator(`[data-testid="tracker-category-decision-row"][data-code="${code}"]`).getByTestId("tracker-category-decision-share")).toHaveText(pct(REF.weighted.decision_style[code]));
    }
    const channel = dash.getByTestId("tracker-category-channel");
    await expect(channel).toContainText(`n=${REF.weighted.acquisition_channel_base}`);
    await expect(channel.getByTestId("tracker-category-channel-row")).toHaveCount(7);
    for (const code of ["1", "2", "3", "4", "5", "6", "7"]) {
      await expect(channel.locator(`[data-testid="tracker-category-channel-row"][data-code="${code}"]`).getByTestId("tracker-category-channel-share")).toHaveText(pct(REF.weighted.acquisition_channel[code]));
    }
    await expect(channel.locator('[data-testid="tracker-category-channel-row"][data-code="7"]')).toContainText("Other");
    await page.screenshot({ path: testInfo.outputPath("tracker-category.png"), fullPage: true });

    // 4. Narrow screen: page tabs instead of the menu; the page fits.
    await page.setViewportSize({ width: 760, height: 1000 });
    const tabs = dash.getByRole("group", { name: "Brand tracking pages" });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("button")).toHaveCount(6);
    await tabs.getByRole("button", { name: "Category overview" }).click();
    await expect(repertoire).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath("tracker-category-760.png"), fullPage: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
