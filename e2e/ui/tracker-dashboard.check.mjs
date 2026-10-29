// D3 tracker dashboards (Grant's previews, 28 October 2026; docs/design/preview-*.png), real browser on the
// disposable stack. The brand tracking and CSM dashboards are separate tools at the top of the Analytics page (Grant,
// 29 October). Two waves of the BMW pack as SPSS (fixtures/tracker-packs/bmw_car), labelled Wave 1 and Wave 2:
//   1. Analytics on wave 2: the Brand tracking dashboard opens with the change against Wave 1, weighted by the
//      file's weight, the suggested five brands compared, and BMW across both waves.
//   2. No brand is chosen yet, so the headline tiles ask for one. Customise dashboard: BMW, Apply changes. "Saved"
//      shows only after the save; the tiles show BMW's figures, equal to the pack's reference to one decimal.
//   3. After a reload the choice is still there (kept for the project).
//   4. At 760 wide the tiles and the comparison still fit the screen.
// Every standard tile is shown (Grant, 29 October 2026): BMW has no trial or frequent-usage question, so those two
// tiles are blank with "Choose a question"; its CSM dashboard shows only NPS (the main brand's recommendation
// question) and the other four tiles are blank. A blank tile can be hidden and shown again.
// A second test: the CSM dashboard on the banking CSM pack's wave 1 (fixtures/csm) shows the pack's reference figures; "Likely to stay" set to none becomes a blank tile, and choosing the question again from that
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
    const openDashboard = async (name) => {
      await section().getByTestId("tracker-dashboards").getByRole("button", { name: new RegExp(`^${name}`) }).click({ timeout: 60_000 });
      return page.getByRole("dialog", { name });
    };
    const dash = await openDashboard("Brand tracking dashboard");
    await expect(dash.getByTestId("tracker-compare")).toBeVisible({ timeout: 3 * 60_000 });
    await expect(dash.getByTestId("tracker-basis")).toContainText("Weighted by weight");
    await expect(dash.getByTestId("tracker-basis")).toContainText("Change is against Wave 1 (bmw_w1.sav)");
    await expect(dash.getByTestId("tracker-compare-row")).toHaveCount(5);
    await expect(page.getByText("Choose your brand (the Brand chip)")).toBeVisible();
    await expect(dash.getByTestId("tracker-kpi")).toHaveCount(7);
    await expect(dash.locator('[data-testid="tracker-kpi"][data-blank="true"]')).toHaveCount(2);
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
    await expect(aware).toContainText(`${Math.abs(change).toFixed(1)} pp vs Wave 1`);
    await expect(dash.getByTestId("tracker-compare-row").first()).toContainText("BMW");
    // BMW across both waves: the awareness line labels each wave's reference value.
    await expect(dash.getByTestId("tracker-timeline")).toContainText(`${ref(1, "aware").toFixed(1)}%`);
    await expect(dash.getByTestId("tracker-timeline")).toContainText(`${ref(2, "aware").toFixed(1)}%`);
    if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, "tracker-desktop.png"), fullPage: true });
    await dash.getByRole("button", { name: /All analytics/ }).click();

    // The CSM dashboard is its own tool: BMW asks the main brand's likelihood to recommend (0 to 10), so NPS shows;
    // the other four CSM tiles are blank.
    const csmDash = await openDashboard("CSM dashboard");
    await expect(csmDash.getByTestId("tracker-csm-tile").filter({ hasText: "Net Promoter Score" })).toContainText("Valid n", { timeout: 3 * 60_000 });
    await expect(csmDash.locator('[data-testid="tracker-csm-tile"][data-blank="true"]')).toHaveCount(4);
    await csmDash.getByRole("button", { name: /All analytics/ }).click();

    // 3. Kept after a reload.
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Analytics/ }).first().click();
    await section().getByTestId("analytics-file-select").selectOption({ label: "Wave 2: bmw_w2.sav" });
    await openDashboard("Brand tracking dashboard");
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
    await section().getByTestId("tracker-dashboards").getByRole("button", { name: /^CSM dashboard/ }).click({ timeout: 60_000 });
    const dash = page.getByRole("dialog", { name: "CSM dashboard" });
    const tiles = dash.getByTestId("tracker-csm-tile");
    await expect(tiles.first()).toBeVisible({ timeout: 3 * 60_000 });
    await expect(dash.getByRole("tab", { name: "Company" })).toHaveAttribute("aria-selected", "true");
    await expect(tiles.filter({ hasText: "Overall satisfaction" })).toContainText(`${cref("company_csat5", "t2b").toFixed(1)}%`);
    await expect(tiles.filter({ hasText: "Likely to stay" })).toContainText(`${cref("continue5", "t2b").toFixed(1)}%`);
    await expect(tiles.filter({ hasText: "Likely to switch" })).toContainText(`${cref("switch_0to10", "risk").toFixed(1)}%`);
    await expect(dash.getByTestId("tracker-drivers").getByRole("listitem")).toHaveCount(6, { timeout: 60_000 });
    if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, "tracker-csm.png") });

    // "Likely to stay" set to none: a blank tile, not 0.
    await dash.getByRole("button", { name: "Customise dashboard" }).click();
    // CB1: the question is chosen by searching; the list holds "None in this file" first.
    await dash.getByRole("combobox", { name: "Question for Likely to stay" }).click();
    await dash.getByRole("option", { name: "None in this file" }).click();
    await dash.getByRole("button", { name: "Apply changes" }).click();
    await expect(dash.getByText("Saved for this project.")).toBeVisible({ timeout: 2 * 60_000 });
    const stay = tiles.filter({ hasText: "Likely to stay" });
    await expect(stay).toHaveAttribute("data-blank", "true", { timeout: 2 * 60_000 });
    await expect(stay).not.toContainText("%");
    if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, "tracker-csm-blank.png") });

    // Filled again from the tile.
    await stay.getByRole("button", { name: "Choose a question" }).click();
    // "Choose a question" lands in the search box: typing narrows the list to the question.
    const stayPicker = dash.getByRole("combobox", { name: "Question for Likely to stay" });
    await expect(stayPicker).toBeFocused();
    await stayPicker.fill("continue5");
    await expect(dash.getByRole("listbox", { name: "Question for Likely to stay" }).getByRole("option")).toHaveCount(2);
    await stayPicker.press("Enter");
    await expect(stayPicker).toHaveValue(/continue5/);
    // Driver search narrows the list without changing what is chosen.
    await dash.getByLabel("Search driver questions").fill("zzzz-no-such-question");
    await expect(dash.getByText("No question matches")).toBeVisible();
    await dash.getByLabel("Search driver questions").fill("");
    await dash.getByRole("button", { name: "Apply changes" }).click();
    await expect(tiles.filter({ hasText: "Likely to stay" })).toContainText(`${cref("continue5", "t2b").toFixed(1)}%`, { timeout: 2 * 60_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// D3b (Grant, 29 October 2026: "CSM change against the previous wave, splitting by company (for example per bank)"):
// the banking pack's waves 1 and 2, labelled. Wave 2 shows each tile's change since wave 1, a table of all seven banks,
// and a "Showing" choice that puts one bank's figures in the tiles; the client's bank, chosen under Customise, is
// shown by default and marked in the table. Figures compared with the pack's reference_results.json.
test("CSM by company and against the previous wave", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const csm = path.resolve("fixtures/csm");
  const CREF = JSON.parse(readFileSync(path.join(csm, "reference_relationship_w1_w2.json"), "utf8")).results;
  const cref = (variable, statistic, wave, company) => CREF.find((r) => r.wave === wave && r.company === company && r.variable === variable && r.statistic === statistic).expected;
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-csm-co-"));
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `tracker-csm-company-${Date.now()}` });
    await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
    for (const w of [1, 2]) {
      const file = path.join(dir, `bank_w${w}.sav`);
      copyFileSync(path.join(csm, `banking_relationship_w${w}_labels.sav`), file);
      await addFiles(page, [file], "Raw data");
      await expect(page.getByTestId("add-files-error")).toHaveCount(0);
    }
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    for (const w of [1, 2]) {
      const setup = await openSource(page, `bank_w${w}.sav`, "Setup");
      const wave = setup.getByLabel(`Wave: bank_w${w}.sav`);
      await expect(wave).toBeEnabled({ timeout: 2 * 60_000 });
      await wave.fill(`Wave ${w}`);
      await wave.blur();
      await expect(setup.getByLabel(`Fieldwork month: bank_w${w}.sav`)).toBeVisible({ timeout: 30_000 });
      await page.waitForLoadState("networkidle");
    }
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    for (const w of [1, 2]) await expect((await openSource(page, `bank_w${w}.sav`, "Setup")).getByLabel(`Wave: bank_w${w}.sav`)).toHaveValue(`Wave ${w}`, { timeout: 60_000 });

    const section = () => page.getByTestId("analytics-section").filter({ visible: true });
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Analytics/ }).first().click();
    await section().getByTestId("analytics-file-select").selectOption({ label: "Wave 2: bank_w2.sav" });
    await section().getByTestId("tracker-dashboards").getByRole("button", { name: /^CSM dashboard/ }).click({ timeout: 60_000 });
    const dash = page.getByRole("dialog", { name: "CSM dashboard" });
    const tiles = dash.getByTestId("tracker-csm-tile");
    await expect(dash.getByTestId("tracker-csm-companies")).toBeVisible({ timeout: 3 * 60_000 });
    await expect(dash.getByTestId("tracker-csm-company-row")).toHaveCount(7);

    // All customers: the tile and its change since wave 1.
    const sat = tiles.filter({ hasText: "Overall satisfaction" });
    await expect(sat).toContainText(`${cref("company_csat5", "t2b", 2, 0).toFixed(1)}%`);
    const d = cref("company_csat5", "mean5", 2, 0) - cref("company_csat5", "mean5", 1, 0);
    await expect(sat.getByTestId("tracker-csm-change")).toContainText(`${Math.abs(d).toFixed(2)} vs Wave 1`);
    const dStay = cref("continue5", "t2b", 2, 0) - cref("continue5", "t2b", 1, 0);
    await expect(tiles.filter({ hasText: "Likely to stay" }).getByTestId("tracker-csm-change")).toContainText(`${Math.abs(dStay).toFixed(1)} pp vs Wave 1`);
    // The trend labels each wave's satisfaction mean.
    await expect(dash.getByTestId("tracker-csm-trend")).toContainText(cref("company_csat5", "mean5", 1, 0).toFixed(1));

    // One bank in the tiles.
    await dash.getByLabel("Show figures for").selectOption({ label: "Capitec" });
    await expect(sat).toContainText(`${cref("company_csat5", "t2b", 2, 5).toFixed(1)}%`);
    await expect(tiles.filter({ hasText: "Likely to stay" })).toContainText(`${cref("continue5", "t2b", 2, 5).toFixed(1)}%`);

    // The client's bank, chosen and applied: shown by default and marked in the table.
    await dash.getByRole("button", { name: "Customise dashboard" }).click();
    await dash.getByLabel("Which company is yours?").selectOption({ label: "FNB" });
    await dash.getByRole("button", { name: "Apply changes" }).click();
    await expect(dash.getByText("Saved for this project.")).toBeVisible({ timeout: 2 * 60_000 });
    await expect(dash.getByTestId("tracker-csm-company-row").filter({ hasText: "FNB (yours)" })).toHaveCount(1, { timeout: 2 * 60_000 });
    if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, "tracker-csm-company.png"), fullPage: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
