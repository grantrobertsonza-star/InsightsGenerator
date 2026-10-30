// CE-1 in Review Objectives: coverage says when it is out of date. A check is made against one
// accepted insight; a second insight is then accepted in the database (as another tab or a
// re-synthesis would). After a reload the coverage pane, the selected objective's tile and the
// objective's verdict chip all say the check is out of date; "Update coverage" makes it current again.
// Synthetic fixture: insights inserted directly; the coverage model answer supplied through the stack's
// model-fixture override (as objective-coverage-degraded.check.mjs). Tests the freshness path, not
// model interpretation.
import { expect, test } from "@playwright/test";
import { openSection } from "./helpers/nav.mjs";
import { insertSupportedInsight } from "./helpers/supportedInsight.mjs";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) {
  throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
}
const fixtureFile = path.join(path.dirname(path.resolve(manifestPath)), "model-fixture.json");
const OBJECTIVE = "Coverage freshness check objective";
const CONCLUSION = "Synthetic coverage conclusion for the freshness check";

test.afterEach(() => rmSync(fixtureFile, { force: true }));

test("coverage made before an insight was accepted says it is out of date, and Update coverage makes it current", async ({ page }, testInfo) => {
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `coverage-stale-${Date.now()}` });
    const section = (name) => openSection(page, name);

    await section("Set Objectives");
    const form = page.locator("form", { has: page.locator('textarea[name="researchObjective"]') });
    await form.locator('textarea[name="researchObjective"]').fill(OBJECTIVE);
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => Number((await db.query("select count(*) from objective_candidates where run_id=$1", [run.id])).rows[0].count), { timeout: 60_000 }).toBe(1);
    const insert = (headline) => insertSupportedInsight(db, target.tenantId, run.id, headline);
    const first = await insert("First accepted insight");
    writeFileSync(fixtureFile, JSON.stringify({ tools: { record_validations: [{ match: "Validate the insights against the objectives and decisions now", input: { validations: [{ item_index: 0, status: "resolved", conclusion: CONCLUSION, insight_indices: [0] }] } }] } }));

    const coverage = () => page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "Coverage of your objectives" }) }).last();
    const stale = () => page.getByTestId("coverage-stale");
    const openReview = async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await section("Review Objectives");
      await expect(page.getByRole("heading", { name: "Coverage of your objectives" })).toBeVisible({ timeout: 60_000 });
    };
    const storedCount = async () => Number((await db.query("select count(*) from objective_validations where run_id=$1", [run.id])).rows[0].count);

    // 1. Checked: current, no note; the row records its objective's id.
    await openReview();
    await coverage().getByRole("button", { name: /^Check (now|again)$/ }).click();
    await expect.poll(storedCount, { timeout: 90_000 }).toBe(1);
    await openReview();
    await expect(coverage().getByText(CONCLUSION, { exact: true })).toBeVisible();
    await expect(stale()).toHaveCount(0);
    const ids = (await db.query("select v.objective_candidate_id = c.id as same from objective_validations v, objective_candidates c where v.run_id=$1 and c.run_id=$1", [run.id])).rows;
    expect(ids).toEqual([{ same: true }]);

    // 2. A second insight is accepted after the check: out of date in the pane, the tile and the chip.
    await insert("Second accepted insight");
    await openReview();
    await expect(stale()).toBeVisible();
    await expect(stale()).toContainText("Out of date: the accepted insights changed after this evidence check");
    await expect(coverage().getByText(CONCLUSION, { exact: true })).toBeVisible();
    await expect(page.getByTestId("stated-objectives").locator('[data-stale="true"]')).toContainText("(not current)");
    await page.getByTestId("stated-objectives").getByRole("button", { name: new RegExp(OBJECTIVE) }).click();
    const middle = page.getByTestId("selected-objective-coverage");
    await expect(middle.getByTestId("coverage-stale")).toBeVisible();
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });

    // 3. Update coverage: current again, after a reload too.
    await middle.getByRole("button", { name: "Update coverage" }).click();
    await expect(middle.getByTestId("coverage-stale")).toHaveCount(0, { timeout: 90_000 });
    await openReview();
    await expect(stale()).toHaveCount(0);
    await expect(page.getByTestId("stated-objectives").locator('[data-stale="true"]')).toHaveCount(0);

    // 4. B37-F01: the only finding behind the cited insight is rejected (as on the Findings page). The
    // inputs are unchanged, but the conclusion is not supported now: said beside the kept verdict, on
    // the pane, the selected objective and the chip; after a reload too.
    const cited = (await db.query("select l.synthesized_insight_id from objective_validation_insights l join objective_validations v on v.id = l.validation_id where v.run_id=$1", [run.id])).rows.map((r) => r.synthesized_insight_id);
    const citedFinding = cited.includes(first.insightId) ? first.findingId : (await db.query("select f.id from findings f join insights i on i.finding_id = f.id join synthesized_insight_sources s on s.pre_insight_id = i.id where s.synthesized_insight_id = $1", [cited[0]])).rows[0].id;
    await db.query("update findings set status='rejected' where id=$1", [citedFinding]);
    await openReview();
    await expect(page.getByTestId("coverage-support").first()).toContainText("Not supported now: an insight this conclusion cites no longer has valid support");
    await expect(page.getByTestId("coverage-support-chip").first()).toHaveText("Support no longer valid");
    await expect(coverage().getByText(CONCLUSION, { exact: true })).toBeVisible();
    await expect(page.getByTestId("stated-objectives").locator('[data-stale="true"]')).toContainText("(not current)");
    await page.getByTestId("stated-objectives").getByRole("button", { name: new RegExp(OBJECTIVE) }).click();
    await expect(middle.getByTestId("coverage-support")).toContainText("Not supported now");
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(/\.png$/, "-unsupported.png"), fullPage: true });
  } finally {
    await db.end();
  }
});
