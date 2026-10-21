// DESIGN-GTR-01 (Codex, 2026-10-21): each section's filters band and the split below it are
// remembered per section. In a real browser on the disposable stack, on a project with insights,
// recommendations and report claims:
//   1. Folding the Insights band leaves Recommendations and Report claims unfolded; a non-default
//      split width set in Insights leaves the others at their default.
//   2. A reload restores each section's own choice.
//   3. A filter chosen in the band, and the add-your-own draft in Recommendations, survive folding.
//   4. The fold control works from the keyboard.
//   5. With storage blocked, folding still works on the page.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FIXTURE = path.resolve("fixtures/golden-thread-1");

test.use({ viewport: { width: 1440, height: 1000 } });

test("each section's filters band and split are remembered on their own", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `band-prefs-${Date.now()}` });
  await ui.upload(run, path.join(FIXTURE, "golden-survey-documented.xlsx"), "table");
  await ui.upload(run, path.join(FIXTURE, "report.docx"), "report");
  await ui.expectReadyOrActionableRecovery(run);
  const table = await ui.buildPurchaseCrosstab(run);
  const finding = await ui.postAndAcceptFinding(table);
  await ui.addIndependentEvidence(run);
  await ui.generateOrLoadInsight(run, finding);
  await ui.addEligibleHumanRecommendation(run, { independentOf: finding, text: `Band prefs action ${Date.now()}` });
  // The fixture's report states no higher-order claim, so one is seeded: a copy of the finding as a
  // stated claim, which is all Report claims needs to show its panes.
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  await db.query(
    `insert into findings select (jsonb_populate_record(null::findings, to_jsonb(f) || jsonb_build_object('id', gen_random_uuid(), 'finding_kind', 'stated_insight', 'duplicate_group_id', null))).* from findings f where f.id = $1`,
    [finding.id],
  );
  await db.end();

  const open = async (section, tab) => {
    await page.getByRole("button", { name: new RegExp(`^${section}(\\s*\\d+)?$`) }).first().click();
    await page.getByTestId(tab).filter({ visible: true }).first().click();
  };
  const band = () => page.locator('[data-testid="three-pane-left"][data-left-placement="top"]').filter({ visible: true }).first();
  const toggle = () => band().getByTestId("three-pane-top-toggle");
  const folded = async () => (await band().getAttribute("data-left-collapsed")) === "true";
  const rightHandle = () => page.getByTestId("three-pane-handle-right").filter({ visible: true }).first();
  const rightWidth = async () => Number(await rightHandle().getAttribute("aria-valuenow"));

  await page.goto(run.url, { waitUntil: "networkidle" });
  await open("Recommendations", "rec-tab-review");
  const recDefault = await rightWidth();
  await open("Findings", "findings-tab-claims");
  const claimsDefault = await rightWidth();

  // 1. Fold Insights and widen its detail pane.
  await open("Insights", "insights-tab-review");
  expect(await folded()).toBe(false);
  await toggle().click();
  await expect(band()).toHaveAttribute("data-left-collapsed", "true");
  const insightsDefault = await rightWidth();
  await rightHandle().focus();
  await page.keyboard.press("ArrowLeft"); // the handle is the pane's inner edge: left widens the right pane
  await page.keyboard.press("ArrowLeft");
  await expect.poll(rightWidth).toBeGreaterThan(insightsDefault);
  const insightsWide = await rightWidth();
  await open("Recommendations", "rec-tab-review");
  expect(await folded()).toBe(false);
  expect(await rightWidth()).toBe(recDefault);
  await open("Findings", "findings-tab-claims");
  expect(await folded()).toBe(false);
  expect(await rightWidth()).toBe(claimsDefault);

  // 2. Reload: each section keeps its own choice.
  await page.reload({ waitUntil: "networkidle" });
  await open("Insights", "insights-tab-review");
  await expect(band()).toHaveAttribute("data-left-collapsed", "true");
  expect(await rightWidth()).toBe(insightsWide);
  await open("Recommendations", "rec-tab-review");
  expect(await folded()).toBe(false);
  await open("Findings", "findings-tab-claims");
  expect(await folded()).toBe(false);

  // 3. Choices in a band survive folding: an Insights filter, and a Recommendations draft.
  await open("Insights", "insights-tab-review");
  await toggle().click();
  const allPill = band().getByRole("group", { name: "Support" }).getByRole("button").first();
  const firstFilter = band().getByRole("group", { name: "Support" }).getByRole("button").nth(1);
  await firstFilter.click();
  await expect(firstFilter).toHaveAttribute("aria-pressed", "true");
  await toggle().click();
  await toggle().click();
  await expect(firstFilter).toHaveAttribute("aria-pressed", "true");
  await allPill.click();
  await open("Recommendations", "rec-tab-review");
  const draft = band().getByRole("form", { name: "Add your own recommendation" }).getByLabel("Action", { exact: true });
  await draft.fill("Half-typed action kept through folding");
  await toggle().click();
  await toggle().click();
  await expect(draft).toHaveValue("Half-typed action kept through folding");

  // 4. Keyboard: Enter on the fold control folds and unfolds it.
  await toggle().focus();
  await page.keyboard.press("Enter");
  await expect(band()).toHaveAttribute("data-left-collapsed", "true");
  await page.keyboard.press("Enter");
  await expect(band()).toHaveAttribute("data-left-collapsed", "false");

  // 5. Storage blocked: folding still works on the page, and a reload shows the default.
  const blocked = await page.context().newPage();
  await blocked.addInitScript(() => {
    const thrower = () => {
      throw new Error("storage blocked (test)");
    };
    Object.defineProperty(window, "localStorage", { configurable: true, get: thrower });
  });
  await blocked.goto(run.url, { waitUntil: "networkidle" });
  await blocked.getByRole("button", { name: /^Recommendations(\s*\d+)?$/ }).first().click();
  await blocked.getByTestId("rec-tab-review").filter({ visible: true }).first().click();
  const blockedBand = blocked.locator('[data-testid="three-pane-left"][data-left-placement="top"]').filter({ visible: true }).first();
  await expect(blockedBand).toHaveAttribute("data-left-collapsed", "false");
  await blockedBand.getByTestId("three-pane-top-toggle").click();
  await expect(blockedBand).toHaveAttribute("data-left-collapsed", "true");
  await blocked.close();
});
