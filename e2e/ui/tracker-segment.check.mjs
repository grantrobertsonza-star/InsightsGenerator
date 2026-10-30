// R5 segment (Grant, 30 October 2026: "we need a filter up here, so the user can filter on a segment (age, gender,
// etc.)"), real browser on the disposable stack. BMW waves 1 and 2 as SPSS (fixtures/tracker-packs/bmw_car), labelled
// Wave 1 and Wave 2:
//   1. The brand dashboard on wave 2 opens on all eligible respondents (the Segment chip says "All eligible").
//   2. The Segment chip opens the picker: the file's profile questions (Gender, Age group, Province, Settlement,
//      income, life stage); Gender Woman and Age group 25-34 and 35-49 ticked, Apply. The chip shows the summary;
//      every card names the segment with its base (n equal to the independent reference); BMW's awareness tile
//      equals the segmented reference (src/lib/__tests__/helpers/segment_reference.py) to one decimal, and the change
//      against Wave 1 is the difference of the two segmented references.
//   3. Brand associations and Audience & media are computed on the segment too (their cards name it).
//   4. Reopening the dashboard keeps the segment (this browser); Clear goes back to all eligible respondents.
// Screenshots at 1440 x 900 when SHOT_DIR is set.
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
const python = process.env.PYTHON_EXECUTABLE ?? "python3";
const SEG = JSON.stringify({ gender: ["2"], age_band: ["2", "3"] });
const reference = (w) => {
  const r = spawnSync(python, ["-I", path.resolve("src/lib/__tests__/helpers/segment_reference.py"), "figures", path.join(pack, `wave${w}_labels_only_compressed.sav`), SEG], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(`The reference values could not be computed: ${r.stderr}`);
  return JSON.parse(r.stdout);
};
const R1 = reference(1);
const R2 = reference(2);
const shot = async (page, name) => {
  if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, name) });
};

test.use({ viewport: { width: 1440, height: 900 } });

test("tracker dashboard segment: every page computed on Woman, 25-34 or 35-49, equal to the reference; remembered; cleared", async ({ page }, testInfo) => {
  test.setTimeout(30 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-segment-"));
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `BMW tracker-segment-${Date.now()}` });
    await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
    const files = [1, 2].map((w) => {
      const f = path.join(dir, `bmw_w${w}.sav`);
      copyFileSync(path.join(pack, `wave${w}_labels_only_compressed.sav`), f);
      return f;
    });
    await addFiles(page, files, "Raw data");
    await expect(page.getByTestId("add-files-error")).toHaveCount(0);
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

    const section = () => page.getByTestId("analytics-section").filter({ visible: true });
    await expect(async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Analytics/ }).first().click();
      await section().getByTestId("analytics-file-select").selectOption({ label: "Wave 2: bmw_w2.sav" }, { timeout: 10_000 });
    }).toPass({ timeout: 3 * 60_000 });
    const open = async () => {
      await section().getByTestId("tracker-dashboards").getByRole("button", { name: /^Brand tracking dashboard/ }).click({ timeout: 60_000 });
      const d = page.getByRole("dialog", { name: "Brand tracking dashboard" });
      await expect(d.getByTestId("tracker-compare")).toBeVisible({ timeout: 4 * 60_000 });
      return d;
    };
    let dash = await open();

    // 1. All eligible.
    const chip = dash.getByTestId("tracker-segment-chip");
    await expect(chip).toContainText("All eligible");
    await expect(dash.getByTestId("tracker-segment-base")).toHaveCount(0);

    // 2. The picker: profile questions, answers by code; Apply.
    await chip.click();
    const picker = dash.getByTestId("tracker-segment-picker");
    await expect(picker.getByTestId("tracker-segment-question")).toHaveCount(6);
    await picker.locator('[data-testid=tracker-segment-question][data-variable="gender"]').click();
    await picker.locator('[data-testid=tracker-segment-answer][data-code="2"]').check();
    await picker.locator('[data-testid=tracker-segment-question][data-variable="age_band"]').click();
    await picker.locator('[data-testid=tracker-segment-answer][data-code="2"]').check();
    await picker.locator('[data-testid=tracker-segment-answer][data-code="3"]').check();
    await expect(picker.getByTestId("tracker-segment-draft")).toHaveText("Woman; 25–34 or 35–49");
    await shot(page, "segment-picker.png");
    await picker.getByTestId("tracker-segment-apply").click();
    await expect(chip).toContainText("Woman; 25–34 or 35–49");
    const baseLine = dash.getByTestId("tracker-segment-base").first();
    await expect(baseLine).toContainText(`Segment: Woman; 25–34 or 35–49; n=${R2.n}`, { timeout: 4 * 60_000 });
    expect(await dash.getByTestId("tracker-segment-base").count()).toBeGreaterThan(1);
    const aware = dash.getByTestId("tracker-kpi").filter({ hasText: "Awareness" });
    await expect(aware).toContainText(`${R2.weighted.funnel.aware.b08[0].toFixed(1)}%`);
    const change = R2.weighted.funnel.aware.b08[0] - R1.weighted.funnel.aware.b08[0];
    await expect(aware).toContainText(`${change > 0 ? "+" : "−"}${Math.abs(change).toFixed(1)}`);
    await expect(dash.getByTestId("tracker-basis")).toContainText("Within the segment Woman; 25–34 or 35–49, applied in both waves.");
    await shot(page, "segment-overview.png");

    // 3. Other pages on the segment.
    const menu = dash.getByRole("navigation", { name: "Brand tracking sections" });
    await menu.getByRole("button", { name: /Brand associations/ }).click();
    await expect(dash.getByTestId("tracker-segment-base").first()).toContainText(`n=${R2.n}`, { timeout: 4 * 60_000 });
    await shot(page, "segment-associations.png");
    await menu.getByRole("button", { name: /Audience & media/ }).click();
    await expect(dash.getByTestId("tracker-segment-base").first()).toContainText(`n=${R2.n}`, { timeout: 4 * 60_000 });
    await shot(page, "segment-audience.png");

    // 4. Remembered in this browser; Clear goes back to all eligible.
    await dash.getByRole("button", { name: /^(Close|← All analytics)$/ }).click();
    dash = await open();
    await expect(dash.getByTestId("tracker-segment-chip")).toContainText("Woman; 25–34 or 35–49");
    await expect(dash.getByTestId("tracker-segment-base").first()).toContainText(`n=${R2.n}`, { timeout: 4 * 60_000 });
    await dash.getByTestId("tracker-segment-chip").click();
    await dash.getByTestId("tracker-segment-clear").click();
    await expect(dash.getByTestId("tracker-segment-chip")).toContainText("All eligible");
    await expect(dash.getByTestId("tracker-compare")).toBeVisible({ timeout: 4 * 60_000 });
    await expect(dash.getByTestId("tracker-segment-base")).toHaveCount(0);
    await shot(page, "segment-cleared.png");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
