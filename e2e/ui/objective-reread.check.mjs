// Filling from the same proposal again (Grant, 2026-10-22: it added duplicate objectives because
// each read re-words them). Real browser against the disposable local stack; the model replay is
// scripted through the stack's model-fixture.json. Synthetic data only.
//   1. Fill from a proposal: two objectives, accepted.
//   2. Fill from it again: the form says it already filled the project, nothing is added, and the
//      model is not asked (the fixture now answers differently and would show if it were).
//   3. Read it again with a re-worded answer: the re-worded lines and one new line come in as
//      pending suggestions on Review objectives, each shown beside the objective it likely restates
//      (the new one beside none); the stated list and the accepted objectives are unchanged.
import { expect, test } from "@playwright/test";
import { openSection } from "./helpers/nav.mjs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const fixtureFile = path.join(path.dirname(path.resolve(manifestPath)), "model-fixture.json");

const FIRST = "Measure rural demand for affordable mobile bundles\nUnderstand why customers switch provider";
const REWORDED = "Measure demand for affordable mobile bundles in rural areas\nUnderstand the reasons customers switch provider\nTest the family bundle offer";

test.afterEach(() => writeFileSync(fixtureFile, JSON.stringify({})));

test("the same proposal is not read twice; Read it again only suggests, beside the likely match", async ({ page }, testInfo) => {
  test.setTimeout(5 * 60_000);
  page.setDefaultTimeout(30_000);
  const marker = `REREAD-${Date.now()}`;
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `objective-reread-${Date.now()}` });
  const dir = mkdtempSync(path.join(os.tmpdir(), "reread-"));
  const file = path.join(dir, "Reread_Proposal.txt");
  writeFileSync(file, `Proposal ${marker}. Objectives about rural bundle demand and switching.`);
  await ui.upload(run, file, "proposal");
  rmSync(dir, { recursive: true, force: true });

  const client = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await client.connect();
  try {
    const form = page.locator("form", { has: page.locator('textarea[name="researchObjective"]') });
    const doc = (await client.query("select id from documents where run_id=$1 and source_filename='Reread_Proposal.txt'", [run.id])).rows[0].id;
    const rows = async () => (await client.query("select candidate_text, status from objective_candidates where run_id=$1 order by candidate_text", [run.id])).rows;
    const used = async () => Number((await client.query("select count(*) from trace where run_id=$1 and event='brief_intake_used'", [run.id])).rows[0].count);
    const submit = async (click) => {
      const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/runs/${run.id}`));
      await click();
      expect((await response).ok()).toBe(true);
      // Settled when the response has started and Save is usable again (the action stream can stay open).
      await expect(form.getByRole("button", { name: "Save", exact: true })).toBeEnabled({ timeout: 60_000 });
    };

    // 1. First fill.
    writeFileSync(fixtureFile, JSON.stringify({ tools: { record_brief_fields: [{ match: marker, input: { business_problem: null, research_objective: FIRST } }] } }));
    await openSection(page, "Set Objectives");
    await form.locator('select[name="proposalDocumentId"]').selectOption(doc);
    await submit(() => form.getByRole("button", { name: "Save", exact: true }).click());
    await expect.poll(rows, { timeout: 60_000 }).toEqual([
      { candidate_text: "Measure rural demand for affordable mobile bundles", status: "accepted" },
      { candidate_text: "Understand why customers switch provider", status: "accepted" },
    ]);
    const statedBefore = (await client.query("select stated_objectives_text from runs where id=$1", [run.id])).rows[0].stated_objectives_text;

    // 2. The same proposal again: not read, nothing added.
    writeFileSync(fixtureFile, JSON.stringify({ tools: { record_brief_fields: [{ match: marker, input: { business_problem: null, research_objective: REWORDED } }] } }));
    await form.locator('select[name="proposalDocumentId"]').selectOption(doc);
    await submit(() => form.getByRole("button", { name: "Save", exact: true }).click());
    await expect(page.getByTestId("brief-fill-already")).toContainText("Already filled from the proposal Reread_Proposal.txt");
    await expect(page.getByTestId("brief-fill-already")).toContainText("2 objectives came from it");
    if (process.env.SHOT) {
      const box = page.getByTestId("brief-fill-already").locator("xpath=ancestor::div[contains(@class,'border-dashed')][1]");
      await box.scrollIntoViewIfNeeded();
      await box.screenshot({ path: process.env.SHOT.replace(".png", "-already.png") });
    }
    expect(await rows()).toHaveLength(2);
    expect(await used()).toBe(1);

    // 3. Read it again: suggestions only.
    await submit(() => page.getByTestId("brief-fill-reread").click());
    await expect(page.getByTestId("brief-fill-reread-result")).toContainText("3 new lines are waiting on Review objectives as suggestions", { timeout: 60_000 });
    expect(await rows()).toEqual([
      { candidate_text: "Measure demand for affordable mobile bundles in rural areas", status: "pending" },
      { candidate_text: "Measure rural demand for affordable mobile bundles", status: "accepted" },
      { candidate_text: "Test the family bundle offer", status: "pending" },
      { candidate_text: "Understand the reasons customers switch provider", status: "pending" },
      { candidate_text: "Understand why customers switch provider", status: "accepted" },
    ]);
    expect((await client.query("select stated_objectives_text from runs where id=$1", [run.id])).rows[0].stated_objectives_text).toBe(statedBefore);

    // Review: each re-worded suggestion beside the objective it likely restates; the new one beside none.
    await page.reload({ waitUntil: "networkidle" });
    await openSection(page, "Review Objectives");
    // Rolled up, the likely repeats carry a chip; rolled down, each names the objective it looks like.
    await expect(page.getByTestId("objective-similar-chip").filter({ visible: true })).toHaveCount(2, { timeout: 60_000 });
    const rolls = page.locator("tbody[data-objective-row]", { has: page.getByTestId("objective-similar-chip") }).getByTestId("objective-roll");
    for (let i = 0; i < (await rolls.count()); i++) await rolls.nth(i).click();
    const similar = page.getByTestId("objective-similar-to").filter({ visible: true });
    await expect(similar).toHaveCount(2);
    await expect(similar.filter({ hasText: "Measure rural demand for affordable mobile bundles" })).toHaveCount(1);
    await expect(similar.filter({ hasText: "Understand why customers switch provider" })).toHaveCount(1);
    await expect(page.getByText('Suggested on re-reading the proposal "Reread_Proposal.txt"').first()).toBeVisible();
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(".png", "-review.png"), fullPage: true });
  } finally {
    await client.end();
  }
});
