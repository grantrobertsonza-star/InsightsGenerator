// Page 05 of the brand tracking dashboard, "Audience & media" (Grant's design, 29 October 2026), real browser on the
// disposable stack. BMW wave 1 as SPSS with labels only (fixtures/tracker-packs/bmw_car), BMW pre-filled as the
// client's brand from the project name:
//   1. Audience & media is a button in the menu; opening it shows the page with the same chips row.
//   2. BMW has 13 recent acquirers: the "VERY SMALL BASE" banner says the figures are a descriptive illustration only,
//      with no significance, targeting or market inference.
//   3. "Age profile": four age groups, each with the acquirers' and the category's share equal to the independent
//      reference (src/lib/__tests__/helpers/audience_reference.py, weighted) to one decimal.
//   4. "Media use": twelve media, ordered by the category's share, each pair equal to the reference; the subtitle says
//      media habits, not advertising effectiveness.
//   5. At 760 wide the menu is replaced by page tabs and the page still fits.
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
const refRun = spawnSync(python, ["-I", path.resolve("src/lib/__tests__/helpers/audience_reference.py"), "shares", savFile], { encoding: "utf8", maxBuffer: 1 << 24 });
if (refRun.status !== 0) throw new Error(`The reference values could not be computed: ${refRun.stderr}`);
const REF = JSON.parse(refRun.stdout);
const pct = (v) => `${v.toFixed(1)}%`;

test.use({ viewport: { width: 1500, height: 1000 } });

test("tracker dashboard page 05: age profile and media use of BMW recent acquirers equal the reference, very small base flagged", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-audience-"));
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    // "BMW" in the project name pre-fills the client's brand (prefilledFocalBrand).
    const run = await ui.createRun({ name: `BMW tracker-audience-${Date.now()}` });
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

    // 1. Page 05 is a button in the menu.
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
    await menu.getByRole("button", { name: /Audience & media/ }).click();
    await expect(menu.getByRole("button", { name: /Audience & media/ })).toHaveAttribute("aria-current", "page");
    await expect(dash.getByRole("heading", { name: "Audience & media" })).toBeVisible();
    await expect(dash.getByTestId("tracker-chips")).toContainText("Brand BMW");

    // 2. The very small base banner.
    const banner = dash.getByTestId("tracker-audience-small-base");
    await expect(banner).toBeVisible({ timeout: 3 * 60_000 });
    expect(REF.acquirers_n).toBe(13);
    await expect(banner).toHaveText("VERY SMALL BASE: BMW recent acquirers n=13. Descriptive illustration only. No significance, targeting or market inference.");

    // 3. Age profile.
    const age = dash.getByTestId("tracker-audience-age");
    await expect(age).toContainText('BMW recent acquirers ("Past 12 month household acquisition", n=13) vs all eligible category respondents (n=1,000)');
    const ageRows = age.getByTestId("tracker-audience-age-row");
    await expect(ageRows).toHaveCount(4);
    for (const [i, code] of ["1", "2", "3", "4"].entries()) {
      const row = ageRows.nth(i);
      await expect(row).toHaveAttribute("data-key", code);
      await expect(row.getByTestId("tracker-audience-age-row-acquirers")).toHaveText(pct(REF.weighted.acquirers.age[code][0]));
      await expect(row.getByTestId("tracker-audience-age-row-category")).toHaveText(pct(REF.weighted.category.age[code][0]));
    }

    // 4. Media use, ordered by the category's share.
    const media = dash.getByTestId("tracker-audience-media");
    await expect(media).toContainText("Multiple response; media habits, not advertising effectiveness.");
    const mediaRows = media.getByTestId("tracker-audience-media-row");
    await expect(mediaRows).toHaveCount(12);
    const order = Object.entries(REF.weighted.category.media).sort((x, y) => y[1][0] - x[1][0]);
    for (const [i, [variable, [share]]] of order.entries()) {
      const row = mediaRows.nth(i);
      await expect(row).toHaveAttribute("data-key", variable);
      await expect(row.getByTestId("tracker-audience-media-row-category")).toHaveText(pct(share));
      await expect(row.getByTestId("tracker-audience-media-row-acquirers")).toHaveText(pct(REF.weighted.acquirers.media[variable][0]));
    }
    await page.screenshot({ path: testInfo.outputPath("tracker-audience.png"), fullPage: true });

    // 5. Narrow screen: page tabs instead of the menu; the page fits.
    await page.setViewportSize({ width: 760, height: 1000 });
    const tabs = dash.getByRole("group", { name: "Brand tracking pages" });
    await expect(tabs).toBeVisible();
    await tabs.getByRole("button", { name: "Audience & media" }).click();
    await expect(age).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath("tracker-audience-760.png"), fullPage: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
