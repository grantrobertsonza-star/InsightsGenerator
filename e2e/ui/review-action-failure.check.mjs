// Review screens report a refused save and keep the researcher's text (standing requirements: a
// failure is explicit; unsaved human wording is not silently lost). Before the fix each of these
// controls awaited a throwing server action inside a transition: the error escaped, the page was
// replaced by the runtime error screen and the typed or edited text was gone.
// Real browser on the disposable stack. Each refusal is a disposable trigger on the affected
// table for this run only, dropped before the retry. Synthetic fixtures: the accepted insight and
// the recommendation are inserted directly.
//   1. Review Objectives, Edit and Save on an objective: the failure is shown, the
//      editor keeps the new wording, the stored text is unchanged; Save after the outage stores it.
//   2. Review Objectives, Add your own objective: reported, the typed text stays in the box.
//   3. Business decisions, Add your own decision: reported, the typed text stays in the box.
//   4. Recommendations, "Edit and accept" then "Save and accept": reported, the edited action text
//      is kept.
import { expect, test } from "@playwright/test";
import { openSection } from "./helpers/nav.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
// The database's reason when the action returns it, otherwise the generic sentence with a server
// reference (a thrown server-action message is withheld by Next.js; see actionFailure.ts).
const OUTAGE = /Synthetic write outage|The server could not complete this \(reference \w+\)/;

test("refused review saves are reported and keep the researcher's text", async ({ page }, testInfo) => {
  page.on("dialog", (d) => d.accept());
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  const fn = `refuse_review_${Date.now()}`;
  let refused = null;
  const refuse = async (table, runId) => {
    refused = table;
    await db.query(`create function ${fn}() returns trigger language plpgsql as $$ begin raise exception 'Synthetic write outage'; end $$; create trigger ${fn} before insert or update on ${table} for each row when (new.run_id='${runId}'::uuid) execute function ${fn}()`);
  };
  const allow = async () => {
    if (refused) await db.query(`drop trigger if exists ${fn} on ${refused}; drop function if exists ${fn}()`);
    refused = null;
  };
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `review-action-failure-${Date.now()}` });
    // Section buttons can carry a count ("Recommendations 1"), so a string name matches exactly
    // and a pattern is used where a count may follow.
    const section = (name) => openSection(page, name);
    const open = async (name) => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await section(name);
    };

    await section("Set Objectives");
    const form = page.locator("form", { has: page.locator('textarea[name="researchObjective"]') });
    await form.locator('textarea[name="researchObjective"]').fill("Review failure objective");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => Number((await db.query("select count(*) from objective_candidates where run_id=$1", [run.id])).rows[0].count), { timeout: 60_000 }).toBe(1);
    const objectiveText = async () => (await db.query("select candidate_text from objective_candidates where run_id=$1", [run.id])).rows.map((r) => r.candidate_text);

    // 1. Edit and Save an objective in Review Objectives.
    await open("Review Objectives");
    const row = page.locator("tbody[data-objective-row]", { hasText: "Review failure objective" }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await refuse("objective_candidates", run.id);
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    const editingRow = page.locator("tbody[data-objective-row]", { has: page.locator("textarea") }).first();
    await editingRow.locator("textarea").fill("Review failure objective, edited");
    await editingRow.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editingRow.getByRole("alert")).toContainText(OUTAGE, { timeout: 60_000 });
    await expect(editingRow.locator("textarea")).toHaveValue("Review failure objective, edited");
    expect(await objectiveText()).toEqual(["Review failure objective"]);
    await allow();
    await editingRow.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(objectiveText, { timeout: 30_000 }).toEqual(["Review failure objective, edited"]);

    // 2. Add your own objective.
    await open("Review Objectives");
    const addObjective = page.locator("form", { hasText: "Add your own objective" });
    await refuse("objective_candidates", run.id);
    await addObjective.locator("textarea").fill("A second objective typed by the researcher");
    await addObjective.getByRole("button", { name: "Add objective" }).click();
    await expect(page.getByRole("alert").filter({ hasText: OUTAGE }).first()).toBeVisible({ timeout: 60_000 });
    await expect(addObjective.locator("textarea")).toHaveValue("A second objective typed by the researcher");
    expect(await objectiveText()).toEqual(["Review failure objective, edited"]);
    await allow();

    // 3. Add your own decision.
    await open("Business decisions");
    const addDecision = page.locator("form", { hasText: "Add your own decision" });
    await expect(addDecision).toBeVisible({ timeout: 60_000 });
    await refuse("decision_candidates", run.id);
    await addDecision.locator("textarea").fill("A decision typed by the researcher");
    await addDecision.getByRole("button", { name: /Add/ }).last().click();
    await expect(page.getByRole("alert").filter({ hasText: OUTAGE }).first()).toBeVisible({ timeout: 60_000 });
    await expect(addDecision.locator("textarea")).toHaveValue("A decision typed by the researcher");
    expect(Number((await db.query("select count(*) from decision_candidates where run_id=$1", [run.id])).rows[0].count)).toBe(0);
    await allow();

    // 4. Edit and "Save and accept" a recommendation.
    const insight = (
      await db.query(
        "insert into synthesized_insights(tenant_id,run_id,headline,observation,tension,implication,review_status) values($1,$2,'Synthetic accepted insight','Observed','Uncertain','Review','accepted') returning id",
        [target.tenantId, run.id],
      )
    ).rows[0].id;
    await db.query(
      "insert into recommendations(tenant_id,run_id,synthesized_insight_id,action_text,owner_role,owner_feasibility_note,timeline,metric,priority,assumptions_and_risks,alternatives_considered,source,status) values($1,$2,$3,'Original recommended action','Head of growth','Has budget','Next quarter','Repeat purchase rate','medium','Assumes stable prices','Do nothing','ai_suggested','pending')",
      [target.tenantId, run.id, insight],
    );
    await open(/^Recommendations( \d+)?$/);
    const card = page.locator("div", { hasText: "Original recommended action" }).filter({ has: page.getByRole("button", { name: "Edit and accept", exact: true }) }).last();
    await expect(card).toBeVisible({ timeout: 60_000 });
    await refuse("recommendations", run.id);
    await card.getByRole("button", { name: "Edit and accept", exact: true }).click();
    // The card while editing: the container holding both its "From insight" line and the save button.
    const editor = page
      .locator("div", { has: page.getByText("From insight: Synthetic accepted insight") })
      .filter({ has: page.getByRole("button", { name: "Save and accept" }) })
      .last();
    const action = editor.locator("textarea").first();
    await expect(action).toHaveValue("Original recommended action", { timeout: 30_000 });
    await action.fill("Edited recommended action");
    await editor.getByRole("button", { name: "Save and accept" }).click();
    await expect(page.getByRole("alert").filter({ hasText: OUTAGE }).first()).toBeVisible({ timeout: 60_000 });
    await expect(action).toHaveValue("Edited recommended action");
    expect((await db.query("select action_text, status from recommendations where run_id=$1", [run.id])).rows).toEqual([{ action_text: "Original recommended action", status: "pending" }]);
    await allow();
  } finally {
    await allow().catch(() => {});
    await db.end();
  }
});
