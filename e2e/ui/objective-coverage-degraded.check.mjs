// OBJ-REV-012 in Review Objectives: a coverage conclusion generated while data-evidence retrieval
// was failing shows the "Evidence check degraded" qualification, keeps it after a reload, and loses
// it once a reassessment runs with retrieval working. The conclusion and status are unchanged
// throughout.
//
// The failure is real, not a stored flag set by hand: the disposable app role's read access to
// objective_evidence is revoked while the coverage check runs, then restored before "Check again".
// Synthetic fixture: one accepted synthesized insight inserted directly, and the coverage model
// answer supplied through the stack's model-fixture override (record_validations has no scripted
// replay answer; the override matches the validator's fixed user message, since the objectives
// travel in its system prompt). This tests the qualification's path, not model interpretation.
import { expect, test } from "@playwright/test";
import { openSection } from "./helpers/nav.mjs";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname) || !/^ie_e2e_/.test(target.applicationRole?.name ?? "")) {
  throw new Error(`${manifestPath} does not describe a disposable stack with a disposable app role; refusing to run.`);
}
const role = target.applicationRole.name;
const fixtureFile = path.join(path.dirname(path.resolve(manifestPath)), "model-fixture.json");
const OBJECTIVE = "Coverage degraded check objective";
const CONCLUSION = "Synthetic coverage conclusion that must be shown in full";

test.afterEach(() => rmSync(fixtureFile, { force: true }));

test("a degraded coverage conclusion is qualified in Review Objectives, survives reload, and clears after a working reassessment", async ({ page }, testInfo) => {
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `coverage-degraded-${Date.now()}` });
    const section = (name) => openSection(page, name);

    await section("Set Objectives");
    const form = page.locator("form", { has: page.locator('textarea[name="researchObjective"]') });
    await form.locator('textarea[name="researchObjective"]').fill(OBJECTIVE);
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => Number((await db.query("select count(*) from objective_candidates where run_id=$1", [run.id])).rows[0].count), { timeout: 60_000 }).toBe(1);
    await db.query(
      "insert into synthesized_insights(tenant_id,run_id,headline,observation,tension,implication,review_status) values($1,$2,'Synthetic accepted insight','Observed','Uncertain','Review','accepted')",
      [target.tenantId, run.id],
    );
    writeFileSync(fixtureFile, JSON.stringify({ tools: { record_validations: [{ match: "Validate the insights against the objectives and decisions now", input: { validations: [{ item_index: 0, status: "resolved", conclusion: CONCLUSION, insight_indices: [0] }] } }] } }));

    // The coverage panel (the bordered card holding the heading, the check button and the list).
    const coverage = () => page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "Coverage of your objectives" }) }).last();
    const qualification = () => page.getByTestId("coverage-evidence-degraded");
    const stored = async () => (await db.query("select status, conclusion, evidence_digest_degraded from objective_validations where run_id=$1", [run.id])).rows;
    const openReview = async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await section("Review Objectives");
      await expect(page.getByRole("heading", { name: "Coverage of your objectives" })).toBeVisible({ timeout: 60_000 });
    };

    // 1. Retrieval fails for real while coverage is checked.
    await db.query(`revoke select on objective_evidence from ${role}`);
    try {
      await openReview();
      await coverage().getByRole("button", { name: /^Check (now|again)$/ }).click();
      await expect.poll(stored, { timeout: 90_000 }).toEqual([{ status: "resolved", conclusion: CONCLUSION, evidence_digest_degraded: true }]);
    } finally {
      await db.query(`grant select on objective_evidence to ${role}`);
    }

    // 2. After a reload the qualification is shown with the unchanged conclusion and status.
    await openReview();
    await expect(qualification()).toHaveCount(1);
    await expect(qualification()).toBeVisible();
    await expect(coverage().getByText("Evidence check degraded", { exact: true })).toBeVisible();
    await expect(coverage().getByText(CONCLUSION, { exact: true })).toBeVisible();
    await expect(coverage().getByText("Answered", { exact: true })).toBeVisible();
    // One-page Objectives (3001): selecting the objective moves its card under the detail in the
    // middle pane, qualification included; the coverage pane says so instead of repeating it.
    await page.getByTestId("stated-objectives").getByRole("button", { name: new RegExp(OBJECTIVE) }).click();
    const middle = page.getByTestId("selected-objective-coverage");
    await expect(middle.getByText("Evidence check degraded", { exact: true })).toBeVisible();
    await expect(middle.getByText(CONCLUSION, { exact: true })).toBeVisible();
    await expect(coverage().getByTestId("coverage-selected-note")).toBeVisible();
    await expect(coverage().getByText(CONCLUSION, { exact: true })).toHaveCount(0);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(".png", "-coverage-selected.png"), fullPage: true });
    await coverage().getByRole("button", { name: "Show all" }).click();
    await expect(middle).toHaveCount(0);
    await expect(coverage().getByText(CONCLUSION, { exact: true })).toBeVisible();

    // 3. A reassessment with retrieval working clears it, after reload too; the conclusion stays.
    await coverage().getByRole("button", { name: "Check again" }).click();
    await expect.poll(stored, { timeout: 90_000 }).toEqual([{ status: "resolved", conclusion: CONCLUSION, evidence_digest_degraded: false }]);
    await openReview();
    await expect(coverage().getByText(CONCLUSION, { exact: true })).toBeVisible();
    await expect(qualification()).toHaveCount(0);
    await expect(coverage().getByText("Evidence check degraded", { exact: true })).toHaveCount(0);
  } finally {
    await db.end();
  }
});
