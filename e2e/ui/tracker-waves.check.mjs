// R5 waves (Grant, 30 October 2026): switching waves and comparing on the brand tracking dashboard, in a real browser
// on the disposable stack. Three BMW-style waves in one project: the pack's waves 1 and 2 and a third made from wave 2
// by src/lib/__tests__/helpers/make_wave3.py (BMW consideration lifted, brand code 10 renamed). Expected changes are
// src/lib/__tests__/helpers/wave_change_reference.py's (pandas and scipy over the same files), never the app's.
//   1. Wave 3 opens with the Wave selector listing the three waves in fieldwork order and "Compare with" on the
//      previous wave; the page states the test in one line; BMW's consideration tile shows its change against Wave 2,
//      equal to the reference to one decimal, marked significant (arrow, bold, words), as the reference's p says.
//   2. Brand associations, then Wave 2 chosen: the page and the brand are kept, the change is against Wave 1.
//   3. Back to Wave 3 with Compare with: Wave 1: the change is against Wave 1, equal to the reference.
// Screenshots at 1440x900 when SHOT_DIR is set.
import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT_DIR = process.env.SHOT_DIR;
const python = process.env.PYTHON_EXECUTABLE ?? "python3";
const pack = path.resolve("fixtures/tracker-packs/bmw_car");
const signed = (v) => {
  const r = Math.round(v * 10) / 10;
  return r === 0 ? "±0.0" : `${r > 0 ? "+" : "-"}${Math.abs(r).toFixed(1)}`;
};

test.use({ viewport: { width: 1440, height: 900 } });

test("brand tracking: switch waves, keep the page and brand, change against the chosen wave with its significance", async ({ page }, testInfo) => {
  test.setTimeout(25 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-waves-"));
  const files = [
    { name: "bmw_w3.sav", wave: "Wave 3", month: "2026-10" },
    { name: "bmw_w1.sav", wave: "Wave 1", month: "2026-02" },
    { name: "bmw_w2.sav", wave: "Wave 2", month: "2026-06" },
  ];
  copyFileSync(path.join(pack, "wave1_labels_only_compressed.sav"), path.join(dir, "bmw_w1.sav"));
  copyFileSync(path.join(pack, "wave2_labels_only_compressed.sav"), path.join(dir, "bmw_w2.sav"));
  const made = spawnSync(python, ["-I", path.resolve("src/lib/__tests__/helpers/make_wave3.py"), path.join(dir, "bmw_w3.sav"), path.join(dir, "bmw_w2.sav")], { encoding: "utf8" });
  if (made.status !== 0) throw new Error(made.stderr);
  const refRun = spawnSync(python, ["-I", path.resolve("src/lib/__tests__/helpers/wave_change_reference.py"), ...["bmw_w1.sav", "bmw_w2.sav", "bmw_w3.sav"].map((f) => path.join(dir, f))], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (refRun.status !== 0) throw new Error(refRun.stderr);
  const REF = JSON.parse(refRun.stdout);

  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  // "BMW" in the project name pre-fills the client's brand (prefilledFocalBrand).
  const run = await ui.createRun({ name: `BMW tracker-waves-${Date.now()}` });
  for (const f of files) await ui.upload(run, path.join(dir, f.name), "table");
  await page.goto(run.url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Import data/ }).first().click();
  for (const f of files) {
    const setup = await openSource(page, f.name, "Setup");
    const wave = setup.getByLabel(`Wave: ${f.name}`);
    await expect(wave).toBeEnabled({ timeout: 3 * 60_000 });
    await wave.fill(f.wave);
    await wave.blur();
    const month = setup.getByLabel(`Fieldwork month: ${f.name}`);
    await expect(month).toBeVisible({ timeout: 30_000 });
    await month.fill(f.month);
    const status = setup.getByTestId("setup-save-status").filter({ visible: true });
    await expect(status).toHaveAttribute("data-saving", "false", { timeout: 60_000 });
    await expect(setup.getByTestId("setup-save-error").filter({ visible: true })).toHaveCount(0);
  }

  // 1. Wave 3, compared with the previous wave by default.
  const section = () => page.getByTestId("analytics-section").filter({ visible: true });
  await expect(async () => {
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Analytics/ }).first().click();
    await section().getByTestId("analytics-file-select").selectOption({ label: "Wave 3: bmw_w3.sav" }, { timeout: 10_000 });
  }).toPass({ timeout: 3 * 60_000 });
  await section().getByTestId("tracker-dashboards").getByRole("button", { name: /^Brand tracking dashboard/ }).click({ timeout: 60_000 });
  const dash = page.getByRole("dialog", { name: "Brand tracking dashboard" });
  await expect(dash.getByTestId("tracker-kpis")).toBeVisible({ timeout: 8 * 60_000 });
  const waveSelect = dash.getByTestId("wave-select");
  await expect(waveSelect.locator("option")).toHaveText(["Wave 1 (Feb 2026)", "Wave 2 (Jun 2026)", "Wave 3 (Oct 2026)"]);
  await expect(dash.getByTestId("wave-compare-select").locator("option")).toHaveText(["Previous wave (Wave 2)", "Wave 1", "None"]);
  const note = dash.getByTestId("wave-test-note");
  await expect(note).toContainText("Change against Wave 2, in points from unrounded figures.");
  await expect(note).toContainText("Change marked when a two-sample test on effective bases gives p < 0.05; not adjusted for multiple comparisons.");
  const consider = dash.getByTestId("tracker-kpi").filter({ hasText: "Consideration" });
  const [chg, , p] = REF.pairs["2-1"]["stage:consider:b08"];
  expect(p).toBeLessThan(0.05);
  const badge = consider.getByTestId("tracker-kpi-change-badge");
  await expect(badge).toHaveAttribute("data-state", "significant");
  await expect(badge).toContainText(`▲ ${signed(chg)} pts`);
  await expect(badge).toContainText(`${signed(chg)} points against Wave 2, significant at 95%`);
  if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, "01-overview-wave3-vs-wave2.png") });

  // 2. Brand associations, then Wave 2: the page and the brand are kept; the change is against Wave 1.
  await dash.getByRole("navigation", { name: "Brand tracking sections" }).getByRole("button", { name: /Brand associations/ }).click();
  await expect(dash.getByTestId("tracker-associations-profile")).toBeVisible({ timeout: 5 * 60_000 });
  await expect(dash.getByTestId("tracker-association-trend")).toBeVisible({ timeout: 60_000 });
  await waveSelect.selectOption({ label: "Wave 2 (Jun 2026)" });
  await expect(dash.getByRole("heading", { name: "Brand associations" })).toBeVisible();
  await expect(dash.getByTestId("tracker-associations-profile")).toBeVisible({ timeout: 8 * 60_000 });
  await expect(dash.getByTestId("wave-test-note")).toContainText("Change against Wave 1", { timeout: 60_000 });
  await expect(dash.getByTestId("tracker-chips")).toContainText("BMW");
  await expect(waveSelect).toHaveValue(await waveSelect.locator("option", { hasText: "Wave 2" }).getAttribute("value"));
  const reliable = dash.getByTestId("tracker-association-row").filter({ hasText: "Reliable" }).getByTestId("tracker-association-change");
  await expect(reliable).toContainText(signed(REF.pairs["1-0"]["assoc:a01:b08"][0]));
  if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, "02-associations-wave2-vs-wave1.png") });

  // 3. Wave 3 compared with Wave 1 (chosen): against Wave 1, equal to the reference.
  await waveSelect.selectOption({ label: "Wave 3 (Oct 2026)" });
  await expect(dash.getByTestId("wave-test-note")).toContainText("Change against Wave 2", { timeout: 8 * 60_000 });
  await dash.getByTestId("wave-compare-select").selectOption({ label: "Wave 1" });
  await expect(dash.getByTestId("wave-test-note")).toContainText("Change against Wave 1", { timeout: 8 * 60_000 });
  await expect(dash.getByTestId("tracker-associations-profile")).toBeVisible();
  const reliable31 = dash.getByTestId("tracker-association-row").filter({ hasText: "Reliable" }).getByTestId("tracker-association-change");
  await expect(reliable31).toContainText(signed(REF.pairs["2-0"]["assoc:a01:b08"][0]));
  if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, "03-associations-wave3-vs-wave1.png") });
  await dash.getByRole("navigation", { name: "Brand tracking sections" }).getByRole("button", { name: /Brand overview/ }).click();
  await expect(dash.getByTestId("wave-test-note")).toContainText("Change against Wave 1", { timeout: 8 * 60_000 });
  const awareBadge = dash.getByTestId("tracker-kpi").filter({ hasText: "Awareness" }).getByTestId("tracker-kpi-change-badge");
  await expect(awareBadge).toContainText(`${signed(REF.pairs["2-0"]["stage:aware:b08"][0])} points against Wave 1`);
  if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, "04-overview-wave3-vs-wave1.png") });
});
