// Page 02 "Moments & needs": the Moment profile view of the moment by brand card and the Moment reach card (Grant,
// 30 October 2026), real browser on the disposable stack. BMW wave 1 as SPSS with labels only
// (fixtures/tracker-packs/bmw_car); expected values from the independent reference
// (src/lib/__tests__/helpers/moment_profile_reference.py, weighted):
//   1. The card opens on "Recall table" (today's view, six rows); "Moment profile" draws five brands' lines, the
//      x axis in category relevance order; every value in the figures table equals the reference to one decimal,
//      with its base; the aware bases are listed under the chart.
//   2. The brand picker: five drawn, the rest disabled; one taken off, another can be added; never six.
//   3. The choice is remembered for the file after a reload of the page.
//   4. Moment reach: every brand's four measures equal the reference (two decimals for counts, one for shares); the
//      headline names the client's brand; ranking by penetration reorders the bars.
// Screenshots at 1440 x 900 into testInfo's output and, when SCREENSHOT_DIR is set, into that directory.
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

const pack = path.resolve("fixtures/tracker-packs/bmw_car");
const savFile = path.join(pack, "wave1_labels_only_compressed.sav");
const python = process.env.PYTHON_EXECUTABLE ?? "python3";
const refRun = spawnSync(python, ["-I", path.resolve("src/lib/__tests__/helpers/moment_profile_reference.py"), "values", savFile], { encoding: "utf8", maxBuffer: 1 << 24 });
if (refRun.status !== 0) throw new Error(`The reference values could not be computed: ${refRun.stderr}`);
const REF = JSON.parse(refRun.stdout);
const PROFILE = REF.profile.weighted;
const REACH = REF.reach.weighted;
const relRun = spawnSync(python, ["-I", path.resolve("src/lib/__tests__/helpers/moment_reference.py"), "shares", savFile], { encoding: "utf8", maxBuffer: 1 << 24 });
if (relRun.status !== 0) throw new Error(relRun.stderr);
const REL = JSON.parse(relRun.stdout).weighted;
const RANKED = Array.from({ length: 12 }, (_, i) => `c${String(i + 1).padStart(2, "0")}`).sort((a, b) => REL[`relevant_${b}`][0] - REL[`relevant_${a}`][0]);
const LABELS = ["Replacing an unreliable car", "Reducing fuel and running costs", "Needing more space for a growing family", "Making the daily commute easier", "Taking long-distance family trips", "Feeling safer on the road", "Marking a career or life achievement", "Enjoying the driving experience", "Choosing lower-emission transport", "Getting technology that simplifies driving", "Staying within a fixed monthly budget", "Driving on rough roads or outdoor trips"];
const bKey = (code) => `b${String(Number(code)).padStart(2, "0")}`;
const pct = (v) => `${v.toFixed(1)}%`;
const shotDir = process.env.SCREENSHOT_DIR ? path.resolve(process.env.SCREENSHOT_DIR) : null;

test.use({ viewport: { width: 1440, height: 900 } });

test("tracker dashboard page 02: Moment profile and Moment reach equal the reference", async ({ page }, testInfo) => {
  test.setTimeout(12 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-moment-profile-"));
  const shot = async (name, locator) => {
    const opts = locator ? {} : { fullPage: false };
    const target_ = locator ?? page;
    await target_.screenshot({ path: testInfo.outputPath(name), ...opts });
    if (shotDir) {
      mkdirSync(shotDir, { recursive: true });
      await target_.screenshot({ path: path.join(shotDir, name), ...opts });
    }
  };
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    // "BMW" in the project name pre-fills the client's brand (prefilledFocalBrand), as in tracker-associations; without
    // it no client brand is set and the reach card rightly has no headline.
    const run = await ui.createRun({ name: `BMW tracker-moment-profile-${Date.now()}` });
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

    const section = () => page.getByTestId("analytics-section").filter({ visible: true });
    const openPage02 = async () => {
      await expect(async () => {
        await page.goto(run.url, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: /^Analytics/ }).first().click();
        await section().getByTestId("analytics-file-select").selectOption({ label: "Wave 1: bmw_w1.sav" }, { timeout: 10_000 });
      }).toPass({ timeout: 2 * 60_000 });
      await section().getByTestId("tracker-dashboards").getByRole("button", { name: /^Brand tracking dashboard/ }).click({ timeout: 60_000 });
      const dash = page.getByRole("dialog", { name: "Brand tracking dashboard" });
      await expect(dash.getByTestId("tracker-compare")).toBeVisible({ timeout: 3 * 60_000 });
      await dash.getByRole("navigation", { name: "Brand tracking sections" }).getByRole("button", { name: /Moments & needs/ }).click();
      await expect(dash.getByTestId("tracker-moments-relevance")).toBeVisible({ timeout: 3 * 60_000 });
      return dash;
    };
    let dash = await openPage02();
    const card = () => dash.getByTestId("tracker-moments-recall");

    // 1. Recall table by default, then Moment profile.
    const toggle = () => card().getByRole("group", { name: "Moment by brand view" });
    await expect(toggle().getByRole("button", { name: "Recall table" })).toHaveAttribute("aria-pressed", "true");
    await expect(card().getByTestId("tracker-recall-row")).toHaveCount(6);
    await shot("page02-recall-table-1440.png");
    await toggle().getByRole("button", { name: "Moment profile" }).click();
    const profile = card().getByTestId("moment-profile");
    await expect(profile).toBeVisible({ timeout: 3 * 60_000 });
    await expect(card()).toContainText("Cue-specific recall among those aware of each brand; pick-any. Weighted by weight.");
    await expect(profile.getByTestId("moment-profile-line")).toHaveCount(5);
    // The client's brand (BMW, code 8, pre-filled from the project name) is always one of the five.
    expect(await profile.getByTestId("moment-profile-line").evaluateAll((ls) => ls.map((l) => l.getAttribute("data-code")))).toContain("8");
    const axis = await profile.locator('[data-testid="moment-profile-chart"] text title').allTextContents();
    expect(axis).toEqual(RANKED.map((c) => LABELS[Number(c.slice(1)) - 1]));
    await profile.getByTestId("moment-profile-table").locator("summary").click();
    const cells = profile.getByTestId("moment-profile-cell");
    await expect(cells).toHaveCount(60);
    for (const cell of await cells.all()) {
      const code = await cell.getAttribute("data-code");
      const group = await cell.getAttribute("data-group");
      const [share, base] = PROFILE[`cep_${group.slice(-3)}_${bKey(code)}`];
      await expect(cell).toContainText(pct(share));
      await expect(cell).toContainText(`n=${base.toLocaleString("en-US")}`);
    }
    for (const code of await profile.getByTestId("moment-profile-line").evaluateAll((ls) => ls.map((l) => l.getAttribute("data-code")))) {
      await expect(profile.getByTestId("moment-profile-bases")).toContainText(`n=${REF.profile.aware_n[bKey(code)].toLocaleString("en-US")}`);
    }
    await profile.getByTestId("moment-profile-table").locator("summary").click();
    await profile.getByTestId("moment-profile-point").first().hover();
    await expect(profile.getByTestId("moment-profile-tip")).toBeVisible();
    await card().scrollIntoViewIfNeeded();
    await shot("page02-moment-profile-1440.png");
    await shot("page02-moment-profile-card.png", card());

    // 2. Five brands at most.
    const picker = profile.getByRole("group", { name: "Brands (up to 5)" });
    const off = picker.locator('button[aria-pressed="false"]');
    expect(await off.count()).toBeGreaterThan(0);
    for (const b of await off.all()) await expect(b).toBeDisabled();
    const removable = picker.locator('button[aria-pressed="true"]:not([disabled])').first();
    await removable.click();
    await expect(profile.getByTestId("moment-profile-line")).toHaveCount(4);
    await picker.locator('button[aria-pressed="false"]').first().click();
    await expect(profile.getByTestId("moment-profile-line")).toHaveCount(5);
    for (const b of await picker.locator('button[aria-pressed="false"]').all()) await expect(b).toBeDisabled();
    await profile.getByTestId("moment-profile-moments").selectOption("top");
    await expect(profile.locator('[data-testid="moment-profile-chart"] text title')).toHaveCount(6);

    // 4. Moment reach.
    const reach = dash.getByTestId("tracker-moment-reach");
    await expect(reach.getByTestId("moment-reach")).toBeVisible({ timeout: 3 * 60_000 });
    // Headline for the client's brand (BMW, code 8 in this pack): rank among the brands by unrounded moments per person.
    const byPerPerson = Object.keys(REACH).sort((a, b) => REACH[b].per_person - REACH[a].per_person);
    const focalKey = bKey(8);
    const nth = byPerPerson.indexOf(focalKey) + 1;
    const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
    await expect(reach.getByTestId("moment-reach-headline")).toHaveText(
      `BMW: ${REACH[focalKey].per_person.toFixed(1)} moments per person, ${ord(nth)} of ${byPerPerson.length}; linked to at least one moment by ${Math.round(REACH[focalKey].penetration)}%`,
    );
    await reach.getByTestId("moment-reach-table").locator("summary").click();
    for (const row of await reach.getByTestId("moment-reach-table-row").all()) {
      const x = REACH[bKey(await row.getAttribute("data-code"))];
      await expect(row.locator('td[data-measure="perPerson"]')).toHaveText(x.per_person.toFixed(2));
      await expect(row.locator('td[data-measure="penetration"]')).toHaveText(pct(x.penetration));
      await expect(row.locator('td[data-measure="perLinker"]')).toHaveText(x.per_linker.toFixed(2));
      await expect(row.locator('td[data-measure="shareOfLinks"]')).toHaveText(pct(x.share));
    }
    const order = async () => reach.getByTestId("moment-reach-row").evaluateAll((rs) => rs.map((r) => r.getAttribute("data-code")));
    expect((await order()).map(bKey)).toEqual(byPerPerson);
    await reach.getByRole("button", { name: "Moment penetration" }).click();
    const byPen = Object.keys(REACH).sort((a, b) => REACH[b].penetration - REACH[a].penetration);
    expect((await order()).map(bKey)).toEqual(byPen);
    await reach.getByRole("button", { name: "Moments per person" }).click();
    await reach.getByTestId("moment-reach-table").locator("summary").click();
    await reach.scrollIntoViewIfNeeded();
    await shot("page02-moment-reach-1440.png");
    await shot("page02-moment-reach-card.png", reach);

    // 3. Remembered for the file after a reload.
    dash = await openPage02();
    await expect(toggle().getByRole("button", { name: "Moment profile" })).toHaveAttribute("aria-pressed", "true");
    await expect(card().getByTestId("moment-profile")).toBeVisible({ timeout: 3 * 60_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
