// R6 CSM extension (Grant, 30 October 2026), real browser on the disposable stack. The banking CSM pack's wave 1:
// its Relationship, Channel and Noncustomer workbooks (fixtures/packs-2026-10-30/csm/banking) added as raw data and
// labelled Wave 1, then the CSM dashboard opened on the Relationship file:
//   1. the Company section is unchanged (overall satisfaction equals the pack's reference);
//   2. Journey: recent tasks, completion among known outcomes with pending beside it, journey satisfaction, each with
//      its bases, equal to the pack's reference to one decimal; ordered paths; the journey filter on company
//      satisfaction labelled as another population; a task filter changes the figures and their base;
//   3. Emotions and preference: the four emotions separately at journey and channel grain; preference by grain;
//      reasons for staying;
//   4. Competitive and noncustomers: the customer benchmark in scale points; the Sample selector switches to the
//      focal noncustomers' profile (consideration among the aware equals the reference), never pooled;
//   5. the CSV export carries grain, sample type and bases.
// Screenshots at 1440 x 900 to SHOT_DIR (docs/screenshots/r6csmext/).
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

const pack = path.resolve("fixtures/packs-2026-10-30/csm/banking");
const REF = JSON.parse(readFileSync(path.join(pack, "test-reference", "reference_results.json"), "utf8"));
const ref = (dataset, variable, statistic, company = 0) => REF.find((r) => r.wave === 1 && r.dataset === dataset && r.company === company && r.channel === 0 && r.variable === variable && r.statistic === statistic);
const one = (r) => `${r.expected.toFixed(1)}%`;
const FILES = ["Relationship", "Channel", "Noncustomer"].map((f) => `Banking_CSM_${f}_Wave_1.xlsx`);

test.use({ viewport: { width: 1440, height: 900 } });

test("CSM extension: journey, emotions and preference, competitive and noncustomers", async ({ page }, testInfo) => {
  test.setTimeout(20 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "csm-ext-"));
  const shot = async (name) => {
    if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, name) });
  };
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `csm-extension-${Date.now()}` });
    await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
    const files = FILES.map((f) => {
      const p = path.join(dir, f);
      copyFileSync(path.join(pack, f), p);
      return p;
    });
    await addFiles(page, files, "Raw data");
    await expect(page.getByTestId("add-files-error")).toHaveCount(0);
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    for (const f of FILES) {
      const setup = await openSource(page, f, "Setup");
      const wave = setup.getByLabel(`Wave: ${f}`);
      await expect(wave).toBeEnabled({ timeout: 3 * 60_000 });
      await wave.fill("Wave 1");
      await wave.blur();
      await expect(setup.getByLabel(`Fieldwork month: ${f}`)).toBeVisible({ timeout: 60_000 });
      await page.waitForLoadState("networkidle");
    }
    await expect(async () => {
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Import data/ }).first().click();
      for (const f of FILES) {
        const again = await openSource(page, f, "Setup");
        await expect(again.getByLabel(`Wave: ${f}`)).toHaveValue("Wave 1", { timeout: 10_000 });
      }
    }).toPass({ timeout: 4 * 60_000 });

    const section = () => page.getByTestId("analytics-section").filter({ visible: true });
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Analytics/ }).first().click();
    await section().getByTestId("analytics-file-select").selectOption({ label: `Wave 1: ${FILES[0]}` });
    await section().getByTestId("tracker-dashboards").getByRole("button", { name: /^CSM dashboard/ }).click({ timeout: 60_000 });
    const dash = page.getByRole("dialog", { name: "CSM dashboard" });

    // 1. The Company section as before.
    const tiles = dash.getByTestId("tracker-csm-tile");
    await expect(tiles.filter({ hasText: "Overall satisfaction" })).toContainText(one(ref("Relationship", "company_csat5", "t2b")), { timeout: 4 * 60_000 });
    await shot("01-company-unchanged.png");

    // 2. Journey.
    await dash.getByRole("tab", { name: "Journey" }).click();
    const j = dash.getByTestId("csmx-section-journey");
    const jt = j.getByTestId("csmx-journey-tiles");
    await expect(jt).toBeVisible({ timeout: 5 * 60_000 });
    const tile = (fig) => j.locator(`[data-testid="csmx-tile"][data-figure="${fig}"]`);
    await expect(tile("recent")).toContainText(one(ref("Relationship", "journey_recent30", "yes")));
    await expect(tile("recent")).toContainText(`n = ${ref("Relationship", "journey_recent30", "yes").raw_base.toLocaleString("en-GB")}`);
    await expect(tile("completion")).toContainText(one(ref("Relationship", "journey_completed", "yes")));
    await expect(tile("completion")).toContainText(`n = ${ref("Relationship", "journey_completed", "yes").raw_base}`);
    await expect(j.getByTestId("csmx-pending")).toContainText("Pending beside it");
    await expect(tile("journeyCsat")).toContainText(one(ref("Relationship", "journey_csat5", "t2b")));
    await expect(tile("multichannel")).toContainText(one(ref("Relationship", "journey_multichannel", "yes")));
    await expect(j.getByTestId("csmx-path-row").first()).toBeVisible();
    await expect(j.getByTestId("csmx-population-change")).toContainText("a different population");
    await expect(j.getByTestId("csmx-file")).toHaveCount(3);
    await shot("02-journey.png");
    // A task filter changes the figures and their base.
    const before = await tile("completion").textContent();
    await j.getByTestId("csmx-task").selectOption({ label: "Problem complaint or fraud concern" });
    await expect(j.getByTestId("csmx-updating")).toHaveCount(0, { timeout: 5 * 60_000 });
    await expect(tile("completion")).not.toHaveText(before ?? "", { timeout: 5 * 60_000 });
    await expect(j.getByTestId("csmx-population")).toContainText("task Problem complaint or fraud concern");
    await shot("03-journey-task-filter.png");
    await j.getByTestId("csmx-task").selectOption({ label: "All tasks" });

    // 3. Emotions and preference.
    await dash.getByRole("tab", { name: "Emotions and preference" }).click();
    const e = dash.getByTestId("csmx-section-experience");
    await expect(e.getByTestId("csmx-journey-emotion-table")).toBeVisible({ timeout: 5 * 60_000 });
    await expect(e.getByTestId("csmx-journey-emotion-table").getByTestId("csmx-emotion-row")).toHaveCount(6);
    await expect(e.locator('[data-testid="csmx-journey-emotion-table"] [data-emotion="frustrated"]')).toContainText(ref("Relationship", "journey_frustrated5", "mean5").expected.toFixed(2));
    await expect(e.locator('[data-testid="csmx-channel-emotion-table"] [data-emotion="reassured"]')).toContainText(ref("Channel", "channel_reassured5", "mean5").expected.toFixed(2));
    await expect(e.getByTestId("csmx-channel-people")).toContainText("distinct customers");
    await expect(e.getByTestId("csmx-preference")).toContainText(one(ref("Relationship", "experience_preference5", "t2b")));
    await expect(e.getByTestId("csmx-reasons")).toContainText(one(ref("Relationship", "stay_reason_r01", "yes")));
    await shot("04-emotions-preference.png");
    await e.getByTestId("csmx-reasons").scrollIntoViewIfNeeded();
    await shot("05-reasons-for-staying.png");

    // 4. Competitive and noncustomers.
    await dash.getByRole("tab", { name: "Competitive and noncustomers" }).click();
    const c = dash.getByTestId("csmx-section-competitive");
    await expect(c.getByTestId("csmx-benchmark")).toBeVisible({ timeout: 5 * 60_000 });
    const gap = ref("Relationship", "benchmark_gap5", "mean_gap");
    await expect(c.getByTestId("csmx-benchmark")).toContainText(`n = ${gap.raw_base}`);
    await shot("06-competitive-customers.png");
    await c.getByTestId("csmx-sample").selectOption("focal_noncustomers");
    await expect(c.getByTestId("csmx-nc-tiles")).toContainText(one(ref("Noncustomer", "focal_consider5", "t2b")));
    await expect(c.getByTestId("csmx-nc-sample")).toContainText("Never pooled with customers");
    await expect(c.getByTestId("csmx-benchmark")).toHaveCount(0);
    await expect(c.getByTestId("csmx-nc-attribute")).toHaveCount(6);
    await expect(c.getByTestId("csmx-nc-attribute").first()).toContainText(ref("Noncustomer", "expect_level_d01", "mean5").expected.toFixed(2));
    await shot("07-noncustomers.png");

    // 5. The export.
    const download = page.waitForEvent("download");
    await c.getByTestId("csmx-export").click();
    const csv = readFileSync(await (await download).path(), "utf8");
    expect(csv.split("\r\n")[0]).toContain("grain,sample_type,wave");
    expect(csv).toContain("Focal noncustomers");
    expect(csv).toContain("Synthetic demonstration data (CSM pack)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The combined pack (company and channel answers on one customer row, channel blocks ch01_ to ch04_): one file,
// labelled Wave 1. The Company tiles read the company questions only; the channel emotions come from the blocks.
test("CSM extension: the combined company and channel file", async ({ page }, testInfo) => {
  test.setTimeout(15 * 60_000);
  const combined = path.resolve("fixtures/packs-2026-10-30/csm-combined/banking");
  const csv = readFileSync(path.join(combined, "reference", "Reference_Metrics.csv"), "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const cols = csv[0].split(",");
  // Quoted cells may hold commas (the pooled rows name four variables).
  const split = (line) => {
    const out = [];
    let cur = "";
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const rows = csv.slice(1).map((l) => Object.fromEntries(split(l).map((c, i) => [cols[i], c])));
  const cref = (section, source, statistic, channel = "0") => Number(rows.find((r) => r.wave === "1" && r.section === section && r.company === "0" && r.channel === channel && r.source_variable === source && r.statistic === statistic).expected);
  const name = "Banking_CSM_Combined_Wave_1.xlsx";
  const dir = mkdtempSync(path.join(tmpdir(), "csm-comb-"));
  const shot = async (n) => {
    if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, n) });
  };
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `csm-combined-${Date.now()}` });
    await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
    const file = path.join(dir, name);
    copyFileSync(path.join(combined, "data", name), file);
    await addFiles(page, [file], "Raw data");
    await expect(page.getByTestId("add-files-error")).toHaveCount(0);
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    const setup = await openSource(page, name, "Setup");
    const wave = setup.getByLabel(`Wave: ${name}`);
    await expect(wave).toBeEnabled({ timeout: 3 * 60_000 });
    await wave.fill("Wave 1");
    await wave.blur();
    await expect(async () => {
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Import data/ }).first().click();
      const again = await openSource(page, name, "Setup");
      await expect(again.getByLabel(`Wave: ${name}`)).toHaveValue("Wave 1", { timeout: 10_000 });
    }).toPass({ timeout: 4 * 60_000 });
    const section = () => page.getByTestId("analytics-section").filter({ visible: true });
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Analytics/ }).first().click();
    await section().getByTestId("analytics-file-select").selectOption({ label: `Wave 1: ${name}` });
    await section().getByTestId("tracker-dashboards").getByRole("button", { name: /^CSM dashboard/ }).click({ timeout: 60_000 });
    const dash = page.getByRole("dialog", { name: "CSM dashboard" });
    await expect(dash.getByTestId("tracker-csm-tile").filter({ hasText: "Overall satisfaction" })).toContainText(`${cref("Company", "company_csat5", "t2b").toFixed(1)}%`, { timeout: 4 * 60_000 });
    await shot("08-combined-company.png");
    await dash.getByRole("tab", { name: "Emotions and preference" }).click();
    const e = dash.getByTestId("csmx-section-experience");
    await expect(e.getByTestId("csmx-channel-emotions")).toContainText("Channel blocks of the combined file", { timeout: 5 * 60_000 });
    await expect(e.locator('[data-testid="csmx-channel-emotion-table"] [data-emotion="reassured"]')).toContainText(cref("Channel", "channel_reassured5", "mean5").toFixed(2));
    await expect(e.locator('[data-testid="csmx-journey-emotion-table"] [data-emotion="angry"]')).toContainText(cref("Company", "journey_angry5", "mean5").toFixed(2));
    await shot("09-combined-emotions.png");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
