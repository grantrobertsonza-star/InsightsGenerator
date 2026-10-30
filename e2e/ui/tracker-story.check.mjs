// R5story (Grant, 30 October 2026): the brand tracking dashboard as a self-contained story, real browser on the
// disposable stack (model REPLAY, scripts/e2e/model-replay.mjs: AI insights restate the page's own figures; the
// summary restates the accepted inputs). Two waves of the BMW pack as SPSS (fixtures/tracker-packs/bmw_car):
//   1. BMW chosen; "Post as finding" on the funnel card shows "Posted as finding" only after the server answered, and
//      again reads "Already posted" (one finding).
//   2. "AI insights" opens the side panel for the page shown; "Draft insights" lists AI drafts checked against the
//      page's figures; Accept turns one into "Accepted"; "Post as finding" posts it.
//   3. "Export slides": the summary is drafted from the accepted insight, accepted, and the deck downloads.
// Screenshots at 1440x900 go to SHOT_DIR when set.
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
const shot = (page, name) => (process.env.SHOT_DIR ? page.screenshot({ path: path.join(process.env.SHOT_DIR, name) }) : null);

test.use({ viewport: { width: 1440, height: 900 } });

test("tracker story: post a card, AI insights accepted and posted, slides exported", async ({ page }, testInfo) => {
  test.setTimeout(15 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-story-"));
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `tracker-story-${Date.now()}` });
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
    await expect(async () => {
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Import data/ }).first().click();
      for (const w of [1, 2]) {
        const again = await openSource(page, `bmw_w${w}.sav`, "Setup");
        await expect(again.getByLabel(`Wave: bmw_w${w}.sav`)).toHaveValue(`Wave ${w}`, { timeout: 10_000 });
      }
    }).toPass({ timeout: 3 * 60_000 });

    const section = () => page.getByTestId("analytics-section").filter({ visible: true });
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Analytics/ }).first().click();
    await section().getByTestId("analytics-file-select").selectOption({ label: "Wave 2: bmw_w2.sav" });
    await section().getByTestId("tracker-dashboards").getByRole("button", { name: /^Brand tracking dashboard/ }).click({ timeout: 60_000 });
    const dash = page.getByRole("dialog", { name: "Brand tracking dashboard" });
    await expect(dash.getByTestId("tracker-compare")).toBeVisible({ timeout: 3 * 60_000 });
    await dash.getByRole("button", { name: "Customise dashboard" }).click();
    await dash.getByTestId("tracker-customise").getByLabel("Which brand is yours?").selectOption({ label: "BMW" });
    await dash.getByTestId("tracker-customise").getByRole("button", { name: "Apply changes" }).click();
    await expect(dash.getByText("Saved for this project.")).toBeVisible({ timeout: 2 * 60_000 });
    await expect(dash.getByTestId("tracker-kpi").filter({ hasText: "Awareness" })).toContainText("%", { timeout: 2 * 60_000 });

    // 1. Post the funnel card.
    const funnelPost = dash.getByTestId("tracker-compare").getByTestId("dashboard-finding-button");
    await expect(funnelPost).toHaveText("Post as finding");
    await funnelPost.click();
    await expect(funnelPost).toHaveText("Posted as finding", { timeout: 3 * 60_000 });
    await shot(page, "story-01-posted.png");
    await funnelPost.click();
    await expect(funnelPost).toHaveText("Already posted", { timeout: 3 * 60_000 });

    // 2. AI insights for the page shown.
    await dash.getByTestId("ai-insights-button").click();
    const panel = page.getByTestId("ai-insights-panel");
    await expect(panel).toContainText("Brand overview");
    await expect(panel).toContainText("No insights drafted for this page yet.", { timeout: 3 * 60_000 });
    await panel.getByTestId("ai-insights-draft").click();
    await expect(panel.getByTestId("ai-insight").first()).toBeVisible({ timeout: 3 * 60_000 });
    await expect(panel.getByTestId("ai-insight-status").first()).toHaveText("AI draft");
    await shot(page, "story-02-ai-insights.png");
    await panel.getByTestId("ai-insight-accept").first().click();
    await expect(panel.getByTestId("ai-insight-status").first()).toHaveText("Accepted", { timeout: 3 * 60_000 });
    await panel.getByTestId("ai-insight-post").first().click();
    await expect(panel.getByTestId("ai-insight-message").first()).toHaveText("Posted as a finding", { timeout: 3 * 60_000 });
    await shot(page, "story-03-ai-accepted.png");
    await panel.getByRole("button", { name: "Close AI insights" }).click();

    // 3. Export slides: summary drafted from the accepted insight, accepted, deck downloaded.
    await dash.getByTestId("export-slides-button").click();
    const dialog = page.getByTestId("export-dialog");
    await expect(dialog.getByTestId("export-summary-draft")).toBeEnabled({ timeout: 5 * 60_000 });
    await dialog.getByTestId("export-summary-draft").click();
    await expect(dialog.getByTestId("export-summary").getByTestId("ai-insight-status")).toHaveText("AI draft", { timeout: 5 * 60_000 });
    await dialog.getByTestId("export-summary").getByTestId("ai-insight-accept").click();
    await expect(dialog.getByTestId("export-summary").getByTestId("ai-insight-status")).toHaveText("Accepted", { timeout: 5 * 60_000 });
    await shot(page, "story-04-export-dialog.png");
    const downloaded = page.waitForEvent("download", { timeout: 8 * 60_000 });
    await dialog.getByTestId("export-download").click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toMatch(/brand-tracking\.pptx$/);
    await expect(dialog.getByTestId("export-done")).toBeVisible();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
