// R5 (Grant, 30 October 2026): an FMCG brand tracker's dashboard, real browser on the disposable stack. Two waves of
// the small synthetic snack tracker (fixtures/tracker-fmcg, make_fmcg.py), SPSS with labels only; wave 1 asks "Bought in
// the past 3 months", wave 2 "Bought in the past month" under the same variable names.
//   1. Wave 2's Brand tracking dashboard: Customise shows one "Tracker type" dropdown, suggested FMCG from the
//      questions, with the reason.
//   2. The tiles are the FMCG funnel in order, each behaviour stage with its window ("Trial, ever", "Usage, past
//      month"); the funnel rows say the same.
//   3. With the client's brand chosen (Crunchos), awareness shows its change against wave 1, equal to an independent
//      pandas reading of the two files; usage shows no change and says the time window changed. The trend chart says
//      the same and draws no wave 1 usage point.
//   4. Set to Durables: the Durables funnel (shortlist and first choice blank, no such question); set back.
// Screenshots at 1440 x 900 to SHOT_DIR when it is given.
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

const fixtures = path.resolve("fixtures/tracker-fmcg");
const python = process.env.PYTHON_EXECUTABLE ?? "python3";
// The independent reading: weighted share of 1 among the answered (blank is not asked), per variable.
const script = [
  "import json, sys, pyreadstat",
  "out = {}",
  "for f in sys.argv[1:]:",
  "    df, _ = pyreadstat.read_sav(f)",
  "    w = df['weight']",
  "    out[f] = {c: float(w[df[c] == 1].sum() / w[df[c].notna()].sum() * 100) for c in df.columns if c not in ('resp_id', 'weight', 'most_often')}",
  "print(json.dumps(out))",
].join("\n");
const files = [1, 2].map((w) => path.join(fixtures, `fmcg_wave${w}.sav`));
const refRun = spawnSync(python, ["-I", "-c", script, ...files], { encoding: "utf8" });
if (refRun.status !== 0) throw new Error(`The reference values could not be computed: ${refRun.stderr}`);
const REF = JSON.parse(refRun.stdout);
const ref = (wave, variable) => REF[files[wave - 1]][variable];

test.use({ viewport: { width: 1440, height: 900 } });

test("FMCG tracker: tracker type suggested and chosen, stages with their windows, a changed window not compared", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-fmcg-"));
  const shot = async (name) => {
    if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, name) });
  };
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `snack-tracker-${Date.now()}` });
    await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
    for (const w of [1, 2]) {
      const file = path.join(dir, `fmcg_w${w}.sav`);
      copyFileSync(files[w - 1], file);
      await addFiles(page, [file], "Raw data");
      await expect(page.getByTestId("add-files-error")).toHaveCount(0);
    }
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    for (const w of [1, 2]) {
      const setup = await openSource(page, `fmcg_w${w}.sav`, "Setup");
      const wave = setup.getByLabel(`Wave: fmcg_w${w}.sav`);
      await expect(wave).toBeEnabled({ timeout: 2 * 60_000 });
      await wave.fill(`Wave ${w}`);
      await wave.blur();
      await expect(setup.getByLabel(`Fieldwork month: fmcg_w${w}.sav`)).toBeVisible({ timeout: 30_000 });
      await page.waitForLoadState("networkidle");
    }
    // Both wave labels read back after a reload (a label's save can queue behind the file's first read).
    await expect(async () => {
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Import data/ }).first().click();
      for (const w of [1, 2]) {
        const again = await openSource(page, `fmcg_w${w}.sav`, "Setup");
        await expect(again.getByLabel(`Wave: fmcg_w${w}.sav`)).toHaveValue(`Wave ${w}`, { timeout: 10_000 });
      }
    }).toPass({ timeout: 3 * 60_000 });

    const section = () => page.getByTestId("analytics-section").filter({ visible: true });
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Analytics/ }).first().click();
    await section().getByTestId("analytics-file-select").selectOption({ label: "Wave 2: fmcg_w2.sav" });
    await section().getByTestId("tracker-dashboards").getByRole("button", { name: /^Brand tracking dashboard/ }).click({ timeout: 60_000 });
    const dash = page.getByRole("dialog", { name: "Brand tracking dashboard" });
    await expect(dash.getByTestId("tracker-compare")).toBeVisible({ timeout: 3 * 60_000 });

    // 2. The FMCG funnel, in order, with the windows.
    const titles = dash.getByTestId("tracker-kpi-title");
    await expect(titles).toHaveText(["Awareness", "Consideration", "Trial, ever", "Usage, past month", "Frequent usage, window not stated"]);
    await expect(dash.getByTestId("tracker-compare-row").first().getByTestId("tracker-compare-stage")).toHaveText(["Awareness", "Consideration", "Trial, ever", "Usage, past month", "Frequent usage, window not stated"]);

    // 1 and 3. Customise: the tracker type dropdown and its suggestion; choose the client's brand.
    await dash.getByRole("button", { name: "Customise dashboard" }).click();
    const custom = dash.getByTestId("tracker-customise");
    const type = custom.getByLabel("Tracker type");
    await expect(type.locator("option:checked")).toHaveText("Suggested: FMCG");
    await expect(type.locator("option")).toHaveText(["Suggested: FMCG", "Durables", "FMCG"]);
    await expect(custom.getByTestId("tracker-type-reason")).toContainText("Suggested from the questions: a purchase or use question in a recent window");
    await expect(custom.getByTestId("tracker-type-reason")).toContainText("bought most often");
    await custom.getByLabel("Which brand is yours?").selectOption({ label: "Crunchos" });
    await shot("fmcg-customise-1440.png");
    await custom.getByRole("button", { name: "Apply changes" }).click();
    await expect(dash.getByText("Saved for this project.")).toBeVisible({ timeout: 2 * 60_000 });
    const tiles = dash.getByTestId("tracker-kpi");
    const aware = tiles.filter({ hasText: "Awareness" });
    await expect(aware).toContainText(`${ref(2, "aware_b1").toFixed(1)}%`, { timeout: 2 * 60_000 });
    const change = ref(2, "aware_b1") - ref(1, "aware_b1");
    await expect(aware.getByTestId("tracker-kpi-change")).toContainText(`${Math.abs(change).toFixed(1)} pp vs Wave 1`);
    const usage = tiles.filter({ hasText: "Usage, past month" });
    await expect(usage).toContainText(`${ref(2, "bought_window_b1").toFixed(1)}%`);
    await expect(usage.getByTestId("tracker-kpi-change")).toHaveText("The time window changed (past 3 months in the previous wave, past month now), so it is not compared.");
    await expect(dash.getByTestId("tracker-timeline")).toContainText("Usage, past month");
    await expect(dash.getByTestId("tracker-timeline-withheld")).toContainText("Usage, Wave 1: The time window changed");
    await shot("fmcg-overview-1440.png");
    await dash.getByTestId("tracker-timeline").scrollIntoViewIfNeeded();
    await shot("fmcg-timeline-1440.png");

    // 4. Durables: its funnel, with blank tiles where this file has no such question; then back to the suggestion.
    await dash.getByRole("button", { name: "Customise dashboard" }).click();
    await type.selectOption({ label: "Durables" });
    await custom.getByRole("button", { name: "Apply changes" }).click();
    await expect(titles).toHaveText(["Awareness", "Consideration", "Usage, past month"], { timeout: 2 * 60_000 });
    await expect(dash.locator('[data-testid="tracker-kpi"][data-blank="true"]')).toHaveCount(3);
    await shot("fmcg-set-durables-1440.png");
    await dash.getByRole("button", { name: "Customise dashboard" }).click();
    await expect(type.locator("option:checked")).toHaveText("Durables");
    await type.selectOption({ label: "Suggested: FMCG" });
    await custom.getByRole("button", { name: "Apply changes" }).click();
    await expect(titles).toHaveText(["Awareness", "Consideration", "Trial, ever", "Usage, past month", "Frequent usage, window not stated"], { timeout: 2 * 60_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
