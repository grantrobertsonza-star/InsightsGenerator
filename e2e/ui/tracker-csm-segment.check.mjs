// R5 CSM segment (Grant, 30 October 2026: "CSM needs a segment tool as well"), real browser on the disposable stack.
// The banking CSM pack's relationship waves 1 and 2 (fixtures/csm) with two seeded profile questions added by the
// independent reference script (src/lib/__tests__/helpers/csm_segment_reference.py "profile": gender and age group,
// beside the pack's own segment question), labelled Wave 1 and Wave 2:
//   1. The CSM dashboard on wave 2 opens on all eligible customers (the Segment chip says "All eligible").
//   2. The Segment chip opens the same picker as the brand dashboard: Gender, Age group and the pack's segment; Woman
//      and Segment 1 or Segment 3 ticked, Apply. Every tile and card names the segment with its base (n equal to the
//      reference); the satisfaction mean and top two box, NPS parts and the driver card's cases equal the reference.
//   3. A bank chosen in "Show figures for": its tiles are within the segment (equal to the reference for that bank
//      in the segment).
//   4. Reopening the dashboard keeps the segment (this browser); Clear goes back to all eligible customers.
// Screenshots at 1440 x 900 when SHOT_DIR is set.
import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addFiles } from "./helpers/addFiles.mjs";
import { openSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

const csm = path.resolve("fixtures/csm");
const python = process.env.PYTHON_EXECUTABLE ?? "python3";
const script = path.resolve("src/lib/__tests__/helpers/csm_segment_reference.py");
const run_ = (args) => {
  const r = spawnSync(python, ["-I", script, ...args], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(`The reference script failed: ${r.stderr}`);
  return r.stdout;
};
const SEG = { gender: ["2"], segment: ["1", "3"] };
const shot = async (page, name) => {
  if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, name) });
};

test.use({ viewport: { width: 1440, height: 900 } });

test("CSM dashboard segment: every figure computed on Woman and Segment 1 or 3, equal to the reference; by bank within it; remembered; cleared", async ({ page }, testInfo) => {
  test.setTimeout(30 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-csm-segment-"));
  try {
    const files = [1, 2].map((w) => {
      const f = path.join(dir, `bank_w${w}.sav`);
      run_(["variant", path.join(csm, `banking_relationship_w${w}_labels.sav`), f, "profile"]);
      return f;
    });
    const R2 = JSON.parse(run_(["figures", files[1], JSON.stringify(SEG)])).weighted;
    const R2bank = JSON.parse(run_(["figures", files[1], JSON.stringify({ ...SEG, company: ["5"] })])).weighted;

    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `CSM tracker-csm-segment-${Date.now()}` });
    await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
    await addFiles(page, files, "Raw data");
    await expect(page.getByTestId("add-files-error")).toHaveCount(0);
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
    await expect(async () => {
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Import data/ }).first().click();
      for (const w of [1, 2]) await expect((await openSource(page, `bank_w${w}.sav`, "Setup")).getByLabel(`Wave: bank_w${w}.sav`)).toHaveValue(`Wave ${w}`, { timeout: 10_000 });
    }).toPass({ timeout: 3 * 60_000 });

    const section = () => page.getByTestId("analytics-section").filter({ visible: true });
    await expect(async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Analytics/ }).first().click();
      await section().getByTestId("analytics-file-select").selectOption({ label: "Wave 2: bank_w2.sav" }, { timeout: 10_000 });
    }).toPass({ timeout: 3 * 60_000 });
    const open = async () => {
      await section().getByTestId("tracker-dashboards").getByRole("button", { name: /^CSM dashboard/ }).click({ timeout: 60_000 });
      const d = page.getByRole("dialog", { name: "CSM dashboard" });
      await expect(d.getByTestId("tracker-csm-companies")).toBeVisible({ timeout: 4 * 60_000 });
      return d;
    };
    let dash = await open();

    // 1. All eligible.
    const chip = dash.getByTestId("tracker-segment-chip");
    await expect(chip).toContainText("All eligible");
    await expect(dash.getByTestId("tracker-segment-base")).toHaveCount(0);

    // 2. The picker: the profile questions; Woman, and Segment 1 or Segment 3.
    await chip.click();
    const picker = dash.getByTestId("tracker-segment-picker");
    await expect(picker.getByTestId("tracker-segment-question")).toHaveCount(3);
    await picker.locator('[data-testid=tracker-segment-question][data-variable="gender"]').click();
    await picker.locator('[data-testid=tracker-segment-answer][data-code="2"]').check();
    await picker.locator('[data-testid=tracker-segment-question][data-variable="segment"]').click();
    await picker.locator('[data-testid=tracker-segment-answer][data-code="1"]').check();
    await picker.locator('[data-testid=tracker-segment-answer][data-code="3"]').check();
    await expect(picker.getByTestId("tracker-segment-draft")).toHaveText("Woman; Segment 1 or Segment 3");
    await shot(page, "csm-segment-picker.png");
    await picker.getByTestId("tracker-segment-apply").click();
    await expect(chip).toContainText("Woman; Segment 1 or Segment 3");
    const tiles = dash.getByTestId("tracker-csm-tile");
    const sat = tiles.filter({ hasText: "Overall satisfaction" });
    await expect(sat.getByTestId("tracker-segment-base")).toContainText(`Segment: Woman; Segment 1 or Segment 3; n=${R2.base.n}`, { timeout: 4 * 60_000 });
    // Every tile and card names the segment.
    expect(await dash.getByTestId("tracker-segment-base").count()).toBeGreaterThanOrEqual(8);
    await expect(sat).toContainText(`${R2.satisfaction.mean.toFixed(1)} / 5`);
    await expect(sat).toContainText(`top two ${R2.satisfaction.box.toFixed(1)}%`);
    await expect(tiles.filter({ hasText: "Likely to stay" })).toContainText(`${R2.stay.box.toFixed(1)}%`);
    const nps = dash.getByTestId("tracker-csm-nps");
    await expect(nps).toContainText(`${R2.nps.promoters.toFixed(0)}% promoters`);
    await expect(nps).toContainText(`valid n = ${R2.nps.raw}`);
    await expect(nps).toContainText("customers in the segment");
    await expect(dash.getByTestId("tracker-drivers")).toContainText(`${R2.drivers.n} complete cases of ${R2.base.n} in the segment`);
    await expect(dash.getByTestId("tracker-csm-trend")).toContainText("the segment applied in each wave");
    await shot(page, "csm-segment-company.png");
    await dash.getByRole("tab", { name: "Drivers" }).click();
    await expect(dash.getByTestId("tracker-drivers").getByTestId("tracker-segment-base")).toContainText(`n=${R2.base.n}`);
    await shot(page, "csm-segment-drivers.png");
    await dash.getByRole("tab", { name: "Company" }).click();

    // 3. One bank, within the segment.
    await dash.getByLabel("Show figures for").selectOption({ label: "Capitec" });
    await expect(sat).toContainText(`${R2bank.satisfaction.mean.toFixed(1)} / 5`);
    await expect(sat).toContainText(`top two ${R2bank.satisfaction.box.toFixed(1)}%`);
    await shot(page, "csm-segment-bank.png");

    // 4. Remembered in this browser; Clear goes back to all eligible.
    await dash.getByRole("button", { name: /^(Close|← All analytics)$/ }).click();
    dash = await open();
    await expect(dash.getByTestId("tracker-segment-chip")).toContainText("Woman; Segment 1 or Segment 3");
    await expect(dash.getByTestId("tracker-segment-base").first()).toContainText(`n=${R2.base.n}`, { timeout: 4 * 60_000 });
    await dash.getByTestId("tracker-segment-chip").click();
    await dash.getByTestId("tracker-segment-clear").click();
    await expect(dash.getByTestId("tracker-segment-chip")).toContainText("All eligible");
    await expect(dash.getByTestId("tracker-csm-companies")).toBeVisible({ timeout: 4 * 60_000 });
    await expect(dash.getByTestId("tracker-segment-base")).toHaveCount(0);
    await shot(page, "csm-segment-cleared.png");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
