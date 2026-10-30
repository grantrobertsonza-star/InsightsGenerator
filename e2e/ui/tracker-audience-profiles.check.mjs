// The brand dashboard's Audience and Media pages (R5, Grant 30 October 2026), real browser on the disposable stack:
//   1. Audience shows age, gender and income cards by default, each with every answer of its question for BMW's recent
//      acquirers and all eligible respondents (gender and income shares equal to the independent reference,
//      src/lib/__tests__/helpers/profile_reference.py, weighted).
//   2. "Add a profile question" lists the other questions by wording with the variable name; choosing Province saves it
//      ("Saved for this ..." only after the save) and its card shows nine provinces; Hide gender and moving Province up
//      are saved; reopening the dashboard shows the cards in the saved order.
//   3. Media: Compare to Toyota's recent acquirers shows Toyota's base (n=56); Sort by difference and Show index work;
//      with BMW's 13 acquirers the index is withheld and no headline is claimed.
//   4. A file where BMW has 360 acquirers (the reference's "large" variant): the headline names Instagram, which the
//      engine's test (and the hand-written z-test) finds clearly higher than among all eligible respondents.
// Screenshots at 1440x900 go to AUDIENCE_SHOTS_DIR when set, else to the test's output folder.
import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addFiles } from "./helpers/addFiles.mjs";
import { openSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

const savFile = path.resolve("fixtures/tracker-packs/bmw_car/wave1_labels_only_compressed.sav");
const python = process.env.PYTHON_EXECUTABLE ?? "python3";
const helper = path.resolve("src/lib/__tests__/helpers/profile_reference.py");
function py(args) {
  const r = spawnSync(python, ["-I", helper, ...args], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(`The reference could not be computed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}
const REF = py(["profiles", savFile, "bought12_b08", "gender", "income", "province"]);
const pct = (v) => `${v.toFixed(1)}%`;
const shotsDir = process.env.AUDIENCE_SHOTS_DIR ? path.resolve(process.env.AUDIENCE_SHOTS_DIR) : null;

test.use({ viewport: { width: 1440, height: 900 } });

/** A project named for BMW with one wave file, the brand dashboard opened on it. */
async function openDashboard(page, testInfo, file, name) {
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `BMW ${name}-${Date.now()}` });
  await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
  await addFiles(page, [file], "Raw data");
  await expect(page.getByTestId("add-files-error")).toHaveCount(0);
  await page.getByRole("button", { name: /^Import data/ }).first().click();
  const base = path.basename(file);
  const setup = await openSource(page, base, "Setup");
  const wave = setup.getByLabel(`Wave: ${base}`);
  await expect(wave).toBeEnabled({ timeout: 2 * 60_000 });
  await wave.fill("Wave 1");
  await wave.blur();
  await expect(setup.getByLabel(`Fieldwork month: ${base}`)).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  const section = () => page.getByTestId("analytics-section").filter({ visible: true });
  const open = async () => {
    await expect(async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Analytics/ }).first().click();
      await section().getByTestId("analytics-file-select").selectOption({ label: `Wave 1: ${base}` }, { timeout: 10_000 });
    }).toPass({ timeout: 2 * 60_000 });
    await section().getByTestId("tracker-dashboards").getByRole("button", { name: /^Brand tracking dashboard/ }).click({ timeout: 60_000 });
    const dash = page.getByRole("dialog", { name: "Brand tracking dashboard" });
    await expect(dash.getByTestId("tracker-compare")).toBeVisible({ timeout: 3 * 60_000 });
    return dash;
  };
  return { open };
}
const shot = async (page, testInfo, name) => {
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: shotsDir ? path.join(shotsDir, name) : testInfo.outputPath(name) });
  await page.screenshot({ path: shotsDir ? path.join(shotsDir, name.replace(".png", "-full.png")) : testInfo.outputPath(name.replace(".png", "-full.png")), fullPage: true });
};

test("Audience: age, gender and income by default; add, hide and reorder are saved and kept; Media compare, sort and index", async ({ page }, testInfo) => {
  test.setTimeout(12 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-profiles-"));
  try {
    const file = path.join(dir, "bmw_w1.sav");
    copyFileSync(savFile, file);
    const { open } = await openDashboard(page, testInfo, file, "profiles");
    let dash = await open();
    const menu = dash.getByRole("navigation", { name: "Brand tracking sections" });
    await menu.getByRole("button", { name: /^05\s*Audience$/ }).click();

    // 1. The default cards.
    const cards = dash.getByTestId("tracker-audience-profile");
    await expect(cards).toHaveCount(3, { timeout: 3 * 60_000 });
    await expect(dash.getByTestId("tracker-audience-profiles").getByTestId("tracker-audience-profile-row").first()).toBeVisible({ timeout: 3 * 60_000 });
    for (const [i, role] of ["age", "gender", "income"].entries()) await expect(cards.nth(i)).toHaveAttribute("data-role", role);
    for (const variable of ["gender", "income"]) {
      const rows = dash.locator(`[data-testid="tracker-audience-profile"][data-variable="${variable}"]`).getByTestId("tracker-audience-profile-row");
      const codes = Object.keys(REF.weighted.category[variable]);
      await expect(rows).toHaveCount(codes.length);
      for (const [i, code] of codes.entries()) {
        await expect(rows.nth(i)).toHaveAttribute("data-key", code);
        await expect(rows.nth(i).getByTestId("tracker-audience-profile-row-focal")).toHaveText(pct(REF.weighted.acquirers[variable][code][0]));
        await expect(rows.nth(i).getByTestId("tracker-audience-profile-row-comparison")).toHaveText(pct(REF.weighted.category[variable][code][0]));
      }
    }
    await shot(page, testInfo, "audience-default.png");

    // 2. Add Province, hide Gender, move Province up; each saved before the next.
    const saved = dash.getByText(/^Saved for this (programme|project)\.$/);
    await dash.getByRole("button", { name: "+ Add a profile question" }).click();
    const picker = dash.getByRole("combobox", { name: "Add a profile question" });
    await picker.click();
    await picker.fill("Prov");
    await expect(dash.getByRole("option", { name: "Province (province)" })).toBeVisible();
    await dash.getByRole("option", { name: "Province (province)" }).click();
    await expect(saved).toBeVisible({ timeout: 60_000 });
    const province = dash.locator('[data-testid="tracker-audience-profile"][data-variable="province"]');
    await expect(province.getByTestId("tracker-audience-profile-row")).toHaveCount(9, { timeout: 3 * 60_000 });
    for (const [i, code] of Object.keys(REF.weighted.category.province).entries()) {
      await expect(province.getByTestId("tracker-audience-profile-row").nth(i).getByTestId("tracker-audience-profile-row-comparison")).toHaveText(pct(REF.weighted.category.province[code][0]));
    }
    await dash.getByRole("button", { name: "Hide Gender", exact: true }).click();
    await expect(dash.locator('[data-testid="tracker-audience-profile"][data-variable="gender"]')).toHaveCount(0, { timeout: 60_000 });
    await dash.getByRole("button", { name: "Move Province up", exact: true }).click();
    const order = () => cards.evaluateAll((els) => els.map((e) => e.getAttribute("data-variable")));
    await expect.poll(order, { timeout: 60_000 }).toEqual(["age_band", "province", "income"]);
    await expect(dash.getByTestId("tracker-audience-profile-row").first()).toBeVisible({ timeout: 3 * 60_000 });
    await shot(page, testInfo, "audience-chosen.png");

    // Reopened: the saved order.
    dash = await open();
    await dash.getByRole("navigation", { name: "Brand tracking sections" }).getByRole("button", { name: /^05\s*Audience$/ }).click();
    await expect.poll(order, { timeout: 3 * 60_000 }).toEqual(["age_band", "province", "income"]);

    // 3. Media: compare to Toyota, sort by difference, index (withheld: BMW has 13 acquirers).
    await dash.getByRole("navigation", { name: "Brand tracking sections" }).getByRole("button", { name: /^06\s*Media$/ }).click();
    await expect(dash.getByTestId("tracker-audience-media-row")).toHaveCount(12, { timeout: 3 * 60_000 });
    await expect(dash.getByTestId("tracker-media-headline")).toHaveCount(0);
    await shot(page, testInfo, "media-default.png");
    await dash.getByTestId("tracker-media-compare").selectOption({ label: "Toyota recent acquirers" });
    await expect(dash.getByTestId("tracker-media-groups")).toContainText("vs Toyota recent acquirers (n=56)", { timeout: 3 * 60_000 });
    await dash.getByTestId("tracker-media-sort").selectOption("difference");
    await dash.getByTestId("tracker-media-show").selectOption("index");
    const index = dash.getByTestId("tracker-audience-media-row-index");
    await expect(index).toHaveCount(12);
    expect(new Set(await index.allTextContents())).toEqual(new Set(["n/a"]));
    await expect(dash.getByTestId("tracker-media-method")).toContainText("No test: a group has fewer than 50 respondents.");
    await shot(page, testInfo, "media-toyota-index.png");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Media: with 360 BMW acquirers the headline names only the differences the engine's test passes", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-media-"));
  try {
    const file = path.join(dir, "bmw_large.sav");
    py(["variant", savFile, file, "large"]);
    const ref = py(["media", file, "bought12_b08"]);
    const higher = Object.entries(ref.weighted).filter(([, r]) => r.decision === "higher").map(([k]) => k);
    expect(higher).toEqual(["media_m03", "media_m12"]);
    const { open } = await openDashboard(page, testInfo, file, "media");
    const dash = await open();
    await dash.getByRole("navigation", { name: "Brand tracking sections" }).getByRole("button", { name: /^06\s*Media$/ }).click();
    const headline = dash.getByTestId("tracker-media-headline");
    await expect(headline).toBeVisible({ timeout: 3 * 60_000 });
    await expect(headline).toHaveText(
      `BMW recent acquirers are more likely to use Instagram (${pct(ref.weighted.media_m03.focal[0])} vs ${pct(ref.weighted.media_m03.comparison[0])}) and AI chatbots (${pct(ref.weighted.media_m12.focal[0])} vs ${pct(ref.weighted.media_m12.comparison[0])}) than all eligible category respondents.`,
    );
    await shot(page, testInfo, "media-headline.png");
    await dash.getByTestId("tracker-media-show").selectOption("index");
    await expect(dash.locator('[data-testid="tracker-audience-media-row"][data-key="media_m03"]').getByTestId("tracker-audience-media-row-index")).toHaveText(String(Math.round(ref.weighted.media_m03.index)));
    await shot(page, testInfo, "media-index.png");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
