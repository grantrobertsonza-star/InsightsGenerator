// SemanticTabs: a plain-English request for a mean (Grant, 2026-10-22: "Give me the mean overall
// satisfaction score" built a frequency table whose summary said "Mean of..."). Real browser against
// the disposable local stack; the planner's tool call is scripted through the stack's
// model-fixture.json ("untargeted" rule), so validation, the plan screen and the engine are real.
// Synthetic data only (the golden fixture).
//   1. The plan lists Satisfaction under statistics: the shown summary is the code's ("the mean and
//      answers of Overall satisfaction"), not the model's wording, the Rows line says "mean, then
//      answers", and Check says how the mean is worked out.
//   2. Add table now: the table shows "Mean score: Overall satisfaction" above the answers, with the
//      distribution kept; a worded satisfaction scale is an ordered scale, so no qualification.
//   3. A request for the mean of Region (text answers in this file): no mean row, and Check says why.
//      (The qualification on numeric codes that are not a scale is checked against the engine in
//      crosstabAskMeanEngine.test.ts; the golden fixture has no such variable.)
//   4. A request that does not list a statistic, with the model's summary claiming a mean: the shown
//      summary says answers only.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { openCrosstabs } from "./helpers/crosstabs.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const fixtureFile = path.join(path.dirname(path.resolve(manifestPath)), "model-fixture.json");
const FIXTURE = path.resolve("fixtures/golden-thread-1");
const NOTE = "mean of the answer codes, which may not be in order";


test.use({ viewport: { width: 1600, height: 1000 } });
test.afterEach(() => writeFileSync(fixtureFile, JSON.stringify({})));

test("SemanticTabs builds a requested mean above the answers, qualified when the codes may not be in order", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  page.setDefaultTimeout(30_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `crosstab-ask-mean-${Date.now()}` });
    await ui.upload(run, path.join(FIXTURE, "golden-survey-documented.xlsx"), "table");
    await ui.expectReadyOrActionableRecovery(run);
    await page.goto(run.url, { waitUntil: "networkidle" });
    const ws = await openCrosstabs(page, "golden-survey-documented.xlsx");
    await ws.getByRole("button", { name: "SemanticTabs" }).click();

    const script = (request, input) => writeFileSync(fixtureFile, JSON.stringify({ untargeted: [{ match: request, tool: "submit_plan", input }] }));
    const ask = async (request) => {
      await ws.getByPlaceholder(/What to measure/).fill(request);
      await ws.getByRole("button", { name: "Set it up" }).click();
      await expect(ws.getByTestId("crosstab-ask-summary")).toBeVisible({ timeout: 60_000 });
    };
    const storedLabels = async () =>
      (await db.query("select rows::text as t from document_tables where run_id=$1 and table_index >= 100", [run.id])).rows.map((r) => r.t).join("\n");

    // 1. The plan.
    const r1 = `MEAN-SAT-${Date.now()} Give me the mean overall satisfaction score`;
    script(r1, { summary: "Mean of overall satisfaction.", rows: ["Satisfaction"], columns: [], filters: [], statistics: [{ row: "Satisfaction", statistic: "mean" }], unclear: [] });
    await ask(r1);
    await expect(ws.getByTestId("crosstab-ask-summary")).toHaveText("A table of the mean and answers of Overall satisfaction (Satisfaction), for everyone, no column split.");
    await expect(ws.getByTestId("crosstab-ask-rows")).toHaveText("Overall satisfaction (mean, then answers)");
    await expect(ws.getByTestId("crosstab-ask-check")).toContainText("The mean of Overall satisfaction is the mean of its numeric answer codes");
    await expect(ws.getByTestId("crosstab-ask-check")).toContainText("don't know, refused and not applicable answers are left out");
    await expect(ws.getByTestId("crosstab-ask-check")).toContainText(NOTE);
    if (process.env.SHOT) await ws.getByTestId("crosstab-ask-summary").locator("xpath=..").screenshot({ path: process.env.SHOT.replace(".png", "-plan.png") });

    // 2. The table: the mean above the answers, distribution kept, no qualification on a satisfaction scale.
    await ws.getByRole("button", { name: "Add table now" }).click();
    const meanCell = page.getByText("Mean score: Overall satisfaction", { exact: true }).filter({ visible: true }).first();
    await expect(meanCell).toBeVisible({ timeout: 120_000 });
    // Row order is read from the table itself in one step: two separate box reads can straddle a
    // layout shift (a status line appearing or going) and compare positions from different moments.
    const order = await meanCell.evaluate((cell) => {
      const rows = [...cell.closest("table").querySelectorAll("tr")].map((tr) => tr.textContent ?? "");
      return { mean: rows.findIndex((t) => t.includes("Mean score: Overall satisfaction")), answer: rows.findIndex((t) => t.includes("Very dissatisfied")) };
    });
    expect(order.answer, "the answers are in the same table").toBeGreaterThanOrEqual(0);
    expect(order.mean, "the mean row is above the answers").toBeLessThan(order.answer);
    await expect(page.getByText("Very satisfied", { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(`Mean score: Overall satisfaction (${NOTE})`)).toHaveCount(0);
    await expect.poll(storedLabels, { timeout: 60_000 }).toContain("Mean score: Overall satisfaction");
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(".png", "-table.png"), fullPage: true });

    // 3. Region: text answers, so no mean row, and Check says why.
    await ws.getByRole("button", { name: "SemanticTabs" }).click();
    const r2 = `MEAN-REGION-${Date.now()} average region`;
    script(r2, { summary: "Average region.", rows: ["Region"], columns: [], filters: [], statistics: [{ row: "Region", statistic: "mean" }], unclear: [] });
    await ask(r2);
    await expect(ws.getByTestId("crosstab-ask-summary")).toHaveText("A table of the answers of Region, for everyone, no column split.");
    await expect(ws.getByTestId("crosstab-ask-check")).toContainText("No mean for Region: its answers are text");
    const before = await storedLabels();
    await ws.getByRole("button", { name: "Add table now" }).click();
    await expect.poll(async () => (await storedLabels()).length, { timeout: 120_000 }).toBeGreaterThan(before.length);
    expect(await storedLabels()).not.toContain("Mean score: Region");

    // 4. No statistic listed: the model's claim of a mean is not shown.
    await ws.getByRole("button", { name: "SemanticTabs" }).click();
    const r3 = `NO-STAT-${Date.now()} satisfaction please`;
    script(r3, { summary: "Mean of overall satisfaction.", rows: ["Satisfaction"], columns: [], filters: [], unclear: [] });
    await ask(r3);
    await expect(ws.getByTestId("crosstab-ask-summary")).toHaveText("A table of the answers of Overall satisfaction (Satisfaction), for everyone, no column split.");
    await expect(ws.getByTestId("crosstab-ask-rows")).toHaveText("Overall satisfaction");
  } finally {
    await db.end();
  }
});
