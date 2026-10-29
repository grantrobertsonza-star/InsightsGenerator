// D3 tracker dashboard (Grant's previews, 28 October 2026), real browser on the disposable stack. Two waves of the
// BMW pack as SPSS (fixtures/tracker-packs/bmw_car), uploaded one after the other and labelled Wave 1 and Wave 2:
//   1. Analytics on wave 2 lists the Tracker dashboard; it opens with the change against Wave 1, weighted by the
//      file's weight, and compares the suggested five brands.
//   2. No brand is chosen yet, so the headline tiles ask for one. Customise dashboard: BMW, Apply changes. "Saved"
//      shows only after the save; the tiles show BMW's figures, equal to the pack's reference to one decimal.
//   3. After a reload the choice is still there (kept for the project).
//   4. At 760 wide the tiles and the comparison still fit the screen.
// Every standard tile is shown (Grant, 29 October 2026): BMW has no trial or frequent-usage question, so those two
// tiles are blank with "Choose a question"; on its Customer satisfaction tab only NPS (the main brand's
// recommendation question) shows and the other four tiles are blank. A blank tile can be
// hidden and shown again.
// A second test: the banking CSM pack's wave 1 (fixtures/csm) opens on Customer satisfaction with the pack's
// reference figures; "Likely to stay" set to none becomes a blank tile, and choosing the question again from that
// tile brings the figure back.
import { expect, test } from "@playwright/test";
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
const REF = JSON.parse(readFileSync(path.join(pack, "reference_funnel_w1_w2.json"), "utf8")).results;
const ref = (wave, metric) => REF.find((r) => r.wave === wave && r.weighting === "weighted" && r.metric === metric && r.brand === "BMW").expected;

test.use({ viewport: { width: 1500, height: 1000 } });

test("tracker dashboard: change against the previous wave, choices applied and kept", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-dash-"));
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `tracker-dashboard-${Date.now()}` });
    await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
    for (const w of [1, 2]) {
      const file = path.join(dir, `bmw_w${w}.sav`);
      copyFileSync(path.join(pack, `wave${w}_labels_only_compressed.sav`), file);
      await addFiles(page, [file], "Raw data");
      await expect(page.getByTestId("add-files-error")).toHaveCount(0);
    }
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    for (const w of [1, 2]) {
      const setup = await openSource(page, `bmw_w${w}.sav`, "Setup");
      const wave = setup.getByLabel(`Wave: bmw_w${w}.sav`);
      await expect(wave).toBeEnabled({ timeout: 2 * 60_000 });
      await wave.fill(`Wave ${w}`);
      await wave.blur();
      await expect(setup.getByLabel(`Fieldwork month: bmw_w${w}.sav`)).toBeVisible({ timeout: 30_000 });
      await page.waitForLoadState("networkidle");
    }
    // Both wave labels are saved before the dashboard is opened: read back after a reload.
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    for (const w of [1, 2]) {
      const again = await openSource(page, `bmw_w${w}.sav`, "Setup");
      await expect(again.getByLabel(`Wave: bmw_w${w}.sav`)).toHaveValue(`Wave ${w}`, { timeout: 60_000 });
    }

    // 1. Open the dashboard on wave 2.
    const section = () => page.getByTestId("analytics-section").filter({ visible: true });
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Analytics/ }).first().click();
    await section().getByTestId("analytics-file-select").selectOption({ label: "Wave 2: bmw_w2.sav" });
    await section().getByRole("list", { name: "Analyses" }).getByRole("button", { name: /^Tracker dashboard/ }).click({ timeout: 60_000 });
    const dash = page.getByRole("dialog", { name: "Tracker dashboard" });
    await expect(dash.getByTestId("tracker-compare")).toBeVisible({ timeout: 3 * 60_000 });
    await expect(dash.getByTestId("tracker-basis")).toContainText("Weighted by weight");
    await expect(dash.getByTestId("tracker-basis")).toContainText("Change is against Wave 1 (bmw_w1.sav)");
    await expect(dash.getByTestId("tracker-compare-row")).toHaveCount(5);
    await expect(page.getByText("Choose your brand under Customise dashboard")).toBeVisible();
    await expect(dash.getByTestId("tracker-kpi")).toHaveCount(7);
    await expect(dash.locator('[data-testid="tracker-kpi"][data-blank="true"]')).toHaveCount(2);
    await dash.getByRole("tab", { name: "Customer satisfaction" }).click();
    // BMW asks the main brand's likelihood to recommend (0 to 10), so NPS shows; the other four CSM tiles are blank.
    await expect(dash.locator('[data-testid="tracker-csm-tile"][data-blank="true"]')).toHaveCount(4);
    await expect(dash.getByTestId("tracker-csm-tile").filter({ hasText: "Net Promoter Score" })).toContainText("95% interval");
    await dash.getByRole("tab", { name: "Brand" }).click();
    // A blank tile can be hidden for a report (Grant, 29 October 2026), and shown again.
    await dash.getByRole("button", { name: "Hide the Trial tile" }).click();
    await expect(dash.getByTestId("tracker-hidden")).toContainText("1 empty tile is hidden", { timeout: 2 * 60_000 });
    await expect(dash.getByTestId("tracker-kpi")).toHaveCount(6);
    await dash.getByRole("button", { name: "Show hidden tiles" }).click();
    await expect(dash.getByTestId("tracker-kpi")).toHaveCount(7, { timeout: 2 * 60_000 });
    await expect(dash.getByTestId("tracker-hidden")).toHaveCount(0);

    // 2. Choose BMW and apply.
    await dash.getByRole("button", { name: "Customise dashboard" }).click();
    const custom = dash.getByTestId("tracker-customise");
    await custom.getByLabel("Which brand is yours?").selectOption({ label: "BMW" });
    // An unapplied edit clears the "Saved" note left by hiding and showing a tile.
    await expect(dash.getByText(/^Saved for this/)).toHaveCount(0);
    await custom.getByRole("button", { name: "Apply changes" }).click();
    await expect(dash.getByText("Saved for this project.")).toBeVisible({ timeout: 2 * 60_000 });
    const tiles = dash.getByTestId("tracker-kpi");
    await expect(tiles.first()).toBeVisible({ timeout: 2 * 60_000 });
    const aware = tiles.filter({ hasText: "Awareness" });
    await expect(aware).toContainText(`${ref(2, "aware").toFixed(1)}%`);
    const change = ref(2, "aware") - ref(1, "aware");
    await expect(aware).toContainText(`${Math.abs(change).toFixed(1)} pts`);
    await expect(dash.getByTestId("tracker-compare-row").first()).toContainText("BMW");
    if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, "tracker-desktop.png") });

    // 3. Kept after a reload.
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Analytics/ }).first().click();
    await section().getByTestId("analytics-file-select").selectOption({ label: "Wave 2: bmw_w2.sav" });
    await section().getByRole("list", { name: "Analyses" }).getByRole("button", { name: /^Tracker dashboard/ }).click({ timeout: 60_000 });
    await expect(dash.getByTestId("tracker-kpi").filter({ hasText: "Awareness" })).toContainText(`${ref(2, "aware").toFixed(1)}%`, { timeout: 3 * 60_000 });

    // 4. Narrow: nothing wider than the screen.
    await page.setViewportSize({ width: 760, height: 1000 });
    await expect(dash.getByTestId("tracker-kpis")).toBeVisible();
    const overflow = await dash.getByTestId("tracker-kpis").evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth);
    expect(overflow).toBe(true);
    if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, "tracker-narrow.png") });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CSM tiles: the pack's figures, a blank tile when a role is set to none, filled again from the tile", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const csm = path.resolve("fixtures/csm");
  const CREF = JSON.parse(readFileSync(path.join(csm, "reference_relationship_w1_w2.json"), "utf8")).results;
  const cref = (variable, statistic) => CREF.find((r) => r.wave === 1 && r.company === 0 && r.variable === variable && r.statistic === statistic).expected;
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-csm-"));
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `tracker-csm-${Date.now()}` });
    const file = path.join(dir, "bank_w1.sav");
    copyFileSync(path.join(csm, "banking_relationship_w1_labels.sav"), file);
    await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
    await addFiles(page, [file], "Raw data");
    await expect(page.getByTestId("add-files-error")).toHaveCount(0);

    const section = () => page.getByTestId("analytics-section").filter({ visible: true });
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Analytics/ }).first().click();
    await section().getByTestId("analytics-file-select").selectOption({ label: "bank_w1.sav" });
    await section().getByRole("list", { name: "Analyses" }).getByRole("button", { name: /^Tracker dashboard/ }).click({ timeout: 60_000 });
    const dash = page.getByRole("dialog", { name: "Tracker dashboard" });
    const tiles = dash.getByTestId("tracker-csm-tile");
    await expect(tiles.first()).toBeVisible({ timeout: 3 * 60_000 });
    await expect(dash.getByRole("tab", { name: "Customer satisfaction" })).toHaveAttribute("aria-selected", "true");
    await expect(tiles.filter({ hasText: "Overall satisfaction" })).toContainText(`${cref("company_csat5", "t2b").toFixed(1)}%`);
    await expect(tiles.filter({ hasText: "Likely to stay" })).toContainText(`${cref("continue5", "t2b").toFixed(1)}%`);
    await expect(tiles.filter({ hasText: "Likely to switch" })).toContainText(`${cref("switch_0to10", "risk").toFixed(1)}%`);
    await expect(dash.getByTestId("tracker-drivers").getByRole("listitem")).toHaveCount(6, { timeout: 60_000 });
    if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, "tracker-csm.png") });

    // "Likely to stay" set to none: a blank tile, not 0.
    await dash.getByRole("button", { name: "Customise dashboard" }).click();
    await dash.getByLabel("Question for Likely to stay").selectOption({ label: "None in this file" });
    await dash.getByRole("button", { name: "Apply changes" }).click();
    await expect(dash.getByText("Saved for this project.")).toBeVisible({ timeout: 2 * 60_000 });
    const stay = tiles.filter({ hasText: "Likely to stay" });
    await expect(stay).toHaveAttribute("data-blank", "true", { timeout: 2 * 60_000 });
    await expect(stay).not.toContainText("%");
    if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, "tracker-csm-blank.png") });

    // Filled again from the tile.
    await stay.getByRole("button", { name: "Choose a question" }).click();
    await dash.getByLabel("Question for Likely to stay").selectOption("continue5");
    await dash.getByRole("button", { name: "Apply changes" }).click();
    await expect(tiles.filter({ hasText: "Likely to stay" })).toContainText(`${cref("continue5", "t2b").toFixed(1)}%`, { timeout: 2 * 60_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
