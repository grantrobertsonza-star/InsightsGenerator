// Business decisions: a decision change whose insight/recommendation update fails is reported as
// saved-but-not-updated, stays flagged after a reload, and "Update them now" reconciles it.
// Before the repair the failure was swallowed by the refresh wrapper (insights stayed built on
// the old decisions with no sign of it) or, when logging failed too, reported as "Not changed"
// about a change that had been saved.
// Real browser, server and database on the disposable stack. The failure is a real one: a
// disposable trigger refuses this run's insight insert, so the real insight refresh fails while
// writing. Synthetic inserts: two decision candidates, one finding with a robust verdict (so an
// insight is due). Scripted model boundary: record_insights and record_recommendations answers are
// supplied by the stack's model fixture.
//   1. Accept the pending decision while insight writes are refused: the panel says it was saved
//      and names the failure; the decision is accepted and the statement lists both decisions;
//      the run is marked as owed a refresh.
//   2. After a reload the panel still says the insights and recommendations are not up to date.
//   3. With writes allowed, "Update them now" clears the notice, the marker is gone, the insight
//      exists, and after a reload there is no notice.
//   4. (Independent review 2026-10-17) Reword the accepted decision: the refresh succeeds but does
//      not rewrite the existing insight, so the panel, the pre-insight card and the pre-insights
//      Excel export mark it "Written for earlier decisions", after a reload too, and its text is unchanged.
// Third test: the same replay for a "generate" run with an existing insight and recommendation.
// Fourth test (independent review 2026-10-17, release 9225d95): on a "generate" run a pre-decision
// insight (no decision context) gets a recommendation from the ACTUAL generator while Decision A is
// accepted (model answer scripted); it records Decision A. Rewording A to C natively: after a
// reload the panel counts it as written for earlier decisions, its text is unchanged; rewording
// back to A clears the notice after a reload.
// Second test, the panel's own callers with reload (no failure injected): add your own decision,
// delete it, "Accept all" on two pending ones; after each reload the panel, the stored statuses
// and the decision statement agree, and nothing is left owed.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import XLSX from "xlsx";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const fixtureFile = path.join(path.dirname(path.resolve(manifestPath)), "model-fixture.json");

test.afterEach(() => rmSync(fixtureFile, { force: true }));

test("a decision change whose refresh fails is shown as saved and not updated, survives reload, and reconciles on retry", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  const fn = `refuse_insight_${Date.now()}`;
  const allow = () => db.query(`drop trigger if exists ${fn} on insights; drop function if exists ${fn}()`);
  try {
    writeFileSync(fixtureFile, JSON.stringify({
      tools: {
        record_insights: [{ match: "", input: { insights: [{ index: 0, headline: "Synthetic headline", observation: "Synthetic observation", tension: "Synthetic tension", implication: "Synthetic implication" }] } }],
        record_recommendations: [{ match: "", input: { recommendations: [{ index: 0, action_text: "Synthetic action", owner_role: "Owner", owner_feasibility_note: "Feasible", timeline: "Q1", metric: "Metric", priority: "medium", assumptions_and_risks: "None", alternatives_considered: "None" }] } }],
      },
    }));
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `decision-refresh-${Date.now()}` });
    const t = target.tenantId;
    await db.query("insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status,created_at) values($1,$2,'Decision A','r','ai_suggested','accepted',now()-interval '2 min'),($1,$2,'Decision B','r','ai_suggested','pending',now()-interval '1 min')", [t, run.id]);
    await db.query("update runs set decision_statement='Decision A' where id=$1", [run.id]);
    const finding = (await db.query("insert into findings(tenant_id,run_id,origin,finding_text,status) values($1,$2,'generated','Synthetic finding for the refresh check','accepted') returning id", [t, run.id])).rows[0].id;
    await db.query("insert into verdicts(tenant_id,finding_id,verdict_tier,rationale,verification_method,corroboration_level) values($1,$2,'robust','Synthetic','single_pass','single_source')", [t, finding]);
    await db.query(`create function ${fn}() returns trigger language plpgsql as $$ begin raise exception 'Synthetic insight write outage'; end $$; create trigger ${fn} before insert on insights for each row when (new.run_id='${run.id}'::uuid) execute function ${fn}()`);

    const pendingMarkers = async () => Number((await db.query("select count(*) from trace where run_id=$1 and event='decision_refresh_pending'", [run.id])).rows[0].count);
    const openDecisions = async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Business decisions/ }).first().click();
      await expect(page.getByText("Decision A", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    };
    const notice = page.getByRole("status").filter({ hasText: /insights and recommendations/ });

    // 1. Accept while the insight write is refused.
    await openDecisions();
    const card = page.locator("div", { has: page.getByText("Decision B", { exact: true }) }).filter({ has: page.getByRole("button", { name: "Accept", exact: true }) }).last();
    await card.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(notice.first()).toContainText(/^Saved\. The insights and recommendations were not updated to match: .*Synthetic insight write outage/, { timeout: 120_000 });
    expect((await db.query("select status from decision_candidates where run_id=$1 and candidate_text='Decision B'", [run.id])).rows[0].status).toBe("accepted");
    expect((await db.query("select decision_statement from runs where id=$1", [run.id])).rows[0].decision_statement).toBe("1. Decision A\n2. Decision B");
    expect(await pendingMarkers()).toBeGreaterThan(0);
    await expect(page.getByText(/^Not saved:|^Not changed:/)).toHaveCount(0);

    // 2. Still flagged after a reload.
    await openDecisions();
    await expect(notice.first()).toContainText("have not been updated since the accepted decisions last changed", { timeout: 60_000 });

    // 3. Writes allowed again: retry reconciles.
    await allow();
    await notice.first().getByRole("button", { name: "Update them now" }).click();
    await expect(notice).toHaveCount(0, { timeout: 120_000 });
    expect(await pendingMarkers()).toBe(0);
    expect(Number((await db.query("select count(*) from insights where finding_id=$1", [finding])).rows[0].count)).toBe(1);
    await openDecisions();
    await expect(notice).toHaveCount(0);

    // 4. Independent review replay (validate mode): reword the accepted decision. The refresh
    // succeeds but does not rewrite the existing insight, so it stays marked, after a reload too.
    await expectEarlierDecisionsMarked({ page, db, run, finding, openDecisions, notice, pendingMarkers });
  } finally {
    await allow().catch(() => {});
    await db.end();
  }
});

/** Edits accepted "Decision B", then checks the existing insight is kept and marked everywhere it shows. */
async function expectEarlierDecisionsMarked({ page, db, run, finding, openDecisions, notice, pendingMarkers }) {
  const before = (await db.query("select id, headline, decision_context from insights where finding_id=$1", [finding])).rows[0];
  expect(before.decision_context).toBe("1. Decision A\n2. Decision B");
  const edited = page.locator("div", { has: page.getByText("Decision B", { exact: true }) }).filter({ has: page.getByRole("button", { name: "Edit", exact: true }) }).last();
  await edited.getByRole("button", { name: "Edit", exact: true }).click();
  const save = page.getByRole("button", { name: "Save and accept", exact: true });
  await save.locator("..").locator("..").locator("textarea").fill("Decision B materially revised");
  await save.click();
  await expect.poll(async () => (await db.query("select decision_statement from runs where id=$1", [run.id])).rows[0].decision_statement, { timeout: 120_000 }).toBe("1. Decision A\n2. Decision B materially revised");
  await expect.poll(pendingMarkers, { timeout: 120_000 }).toBe(0);
  const earlier = notice.filter({ hasText: "written for earlier ones" });
  await expect(earlier.first()).toContainText("1 insight was written for earlier ones", { timeout: 60_000 });
  await openDecisions();
  await expect(earlier.first()).toContainText("1 insight was written for earlier ones", { timeout: 60_000 });
  await expect(page.getByText(/^Not saved:|^Not changed:/)).toHaveCount(0);
  // The insight itself is untouched.
  expect((await db.query("select id, headline, decision_context from insights where finding_id=$1", [finding])).rows[0]).toEqual(before);
  // Marked in the pre-insights list (Working data, Pre-insights tab).
  await page.getByRole("button", { name: /^Working data(\s*\d+)?$/ }).first().click();
  await page.getByRole("button", { name: /^Pre-insights/ }).first().click();
  const insightCard = page.locator("div.rounded-lg", { hasText: before.headline }).last();
  await expect(insightCard.getByText("Written for earlier decisions", { exact: true })).toBeVisible({ timeout: 60_000 });
  // And in the insights export.
  const response = await page.request.get(`${new URL(run.url).origin}/api/runs/${run.id}/insights/export`);
  expect(response.status()).toBe(200);
  const book = XLSX.read(await response.body(), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]);
  expect(rows.find((r) => r.Headline === before.headline)?.["Decision this serves"]).toBe(
    "Written for earlier decisions (the accepted decisions have changed since): 1. Decision A\n2. Decision B",
  );
}

test("generate mode: an existing insight written for an earlier decision stays marked after the decision is reworded", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `decision-context-generate-${Date.now()}` });
    const t = target.tenantId;
    await db.query("insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status,created_at) values($1,$2,'Decision A','r','ai_suggested','accepted',now()-interval '2 min'),($1,$2,'Decision B','r','ai_suggested','accepted',now()-interval '1 min')", [t, run.id]);
    await db.query("update runs set entry_point='generate', decision_statement=$2 where id=$1", [run.id, "1. Decision A\n2. Decision B"]);
    const finding = (await db.query("insert into findings(tenant_id,run_id,origin,finding_text,status) values($1,$2,'generated','Synthetic finding for the generate check','accepted') returning id", [t, run.id])).rows[0].id;
    await db.query("insert into verdicts(tenant_id,finding_id,verdict_tier,rationale,verification_method,corroboration_level) values($1,$2,'robust','Synthetic','single_pass','single_source')", [t, finding]);
    // An existing recommendation too, so the refresh has nothing to add (no model call needed). It
    // records the decisions it was generated for, as the generator does since migration 0102.
    const insight = (await db.query("insert into insights(tenant_id,run_id,finding_id,decision_context,headline,observation,tension,implication) values($1,$2,$3,$4,'Existing generate headline','o','t','i') returning id", [t, run.id, finding, "1. Decision A\n2. Decision B"])).rows[0].id;
    await db.query("insert into recommendations(tenant_id,run_id,insight_id,action_text,owner_role,owner_feasibility_note,timeline,metric,priority,assumptions_and_risks,alternatives_considered,source,status,edited,decision_context) values($1,$2,$3,'Researcher wording','o','f','t','m','medium','a','b','ai_suggested','accepted',true,$4)", [t, run.id, insight, "1. Decision A\n2. Decision B"]);
    const pendingMarkers = async () => Number((await db.query("select count(*) from trace where run_id=$1 and event='decision_refresh_pending'", [run.id])).rows[0].count);
    const openDecisions = async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Business decisions/ }).first().click();
      await expect(page.getByText("Decision A", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    };
    const notice = page.getByRole("status").filter({ hasText: /insights and recommendations/ });
    await openDecisions();
    await expect(notice).toHaveCount(0);
    await expectEarlierDecisionsMarked({ page, db, run, finding, openDecisions, notice, pendingMarkers });
  } finally {
    await db.end();
  }
});

test("own add, own delete and accept all agree with the database and the statement after reload", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  page.on("dialog", (d) => d.accept());
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `decision-callers-${Date.now()}` });
    await db.query("insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status,created_at) values($1,$2,'Pending one','r','ai_suggested','pending',now()-interval '2 min'),($1,$2,'Pending two','r','ai_suggested','pending',now()-interval '1 min')", [target.tenantId, run.id]);
    const stored = async () => (await db.query("select candidate_text, status from decision_candidates where run_id=$1 order by created_at", [run.id])).rows;
    const statement = async () => (await db.query("select decision_statement from runs where id=$1", [run.id])).rows[0].decision_statement;
    const owed = async () => Number((await db.query("select count(*) from trace where run_id=$1 and event='decision_refresh_pending'", [run.id])).rows[0].count);
    const openDecisions = async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Business decisions/ }).first().click();
      await expect(page.getByText("Pending one", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    };

    // Add your own.
    await openDecisions();
    const form = page.locator("form", { has: page.getByRole("button", { name: "Add decision" }) });
    await form.locator("textarea").fill("My own decision");
    await form.getByRole("button", { name: "Add decision" }).click();
    await expect.poll(async () => (await stored()).find((r) => r.candidate_text === "My own decision")?.status, { timeout: 60_000 }).toBe("accepted");
    await openDecisions();
    await expect(page.getByText("My own decision", { exact: true }).first()).toBeVisible();
    expect(await statement()).toBe("My own decision");

    // Delete it.
    const own = page.locator("div", { has: page.getByText("My own decision", { exact: true }) }).filter({ has: page.getByRole("button", { name: /Delete/ }) }).last();
    await own.getByRole("button", { name: /Delete/ }).first().click();
    await expect.poll(async () => (await stored()).some((r) => r.candidate_text === "My own decision"), { timeout: 60_000 }).toBe(false);
    await openDecisions();
    await expect(page.getByText("My own decision", { exact: true })).toHaveCount(0);
    expect(await statement()).toBeNull();

    // Accept all.
    await page.getByRole("button", { name: "Accept all", exact: true }).click();
    await expect.poll(async () => (await stored()).map((r) => r.status), { timeout: 60_000 }).toEqual(["accepted", "accepted"]);
    await openDecisions();
    await expect(page.getByRole("button", { name: "Accept all", exact: true })).toHaveCount(0);
    expect(await statement()).toBe("1. Pending one\n2. Pending two");
    expect(await owed()).toBe(0);
    await expect(page.getByRole("status").filter({ hasText: /insights and recommendations/ })).toHaveCount(0);
  } finally {
    await db.end();
  }
});

test("generate mode: a recommendation generated for Decision A on a no-context insight is qualified after A is reworded, and clears when A is restored", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    writeFileSync(fixtureFile, JSON.stringify({
      tools: { record_recommendations: [{ match: "", input: { recommendations: [{ index: 0, action_text: "Action framed for Decision A", owner_role: "Owner", owner_feasibility_note: "Feasible", timeline: "Soon", metric: "Measure", priority: "medium", assumptions_and_risks: "None", alternatives_considered: "None" }] } }] },
    }));
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `recommendation-context-${Date.now()}` });
    const t = target.tenantId;
    await db.query("update runs set entry_point='generate', decision_statement='Decision A' where id=$1", [run.id]);
    await db.query("insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Decision A','r','ai_suggested','accepted')", [t, run.id]);
    const f = (await db.query("insert into findings(tenant_id,run_id,origin,finding_text,status) values($1,$2,'generated','Evidence written before any decision','accepted') returning id", [t, run.id])).rows[0].id;
    await db.query("insert into verdicts(tenant_id,finding_id,verdict_tier,rationale,verification_method,corroboration_level) values($1,$2,'robust','Synthetic','single_pass','single_source')", [t, f]);
    const i = (await db.query("insert into insights(tenant_id,run_id,finding_id,decision_context,headline,observation,tension,implication) values($1,$2,$3,null,'Evidence before decisions','o','t','i') returning id", [t, run.id, f])).rows[0].id;
    const recs = async () => (await db.query("select id, action_text, decision_context from recommendations where insight_id=$1 order by id", [i])).rows;
    const pendingMarkers = async () => Number((await db.query("select count(*) from trace where run_id=$1 and event='decision_refresh_pending'", [run.id])).rows[0].count);
    const open = async (decision) => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Business decisions/ }).first().click();
      await expect(page.getByText(decision, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    };
    const earlier = page.getByRole("status").filter({ hasText: "written for earlier ones" });
    const reword = async (from, to) => {
      const card = page.locator("div", { has: page.getByText(from, { exact: true }) }).filter({ has: page.getByRole("button", { name: "Edit", exact: true }) }).last();
      await card.getByRole("button", { name: "Edit", exact: true }).click();
      const save = page.getByRole("button", { name: "Save and accept", exact: true });
      await save.locator("..").locator("..").locator("textarea").fill(to);
      await save.click();
      await expect.poll(async () => (await db.query("select decision_statement from runs where id=$1", [run.id])).rows[0].decision_statement, { timeout: 120_000 }).toBe(to);
      await expect.poll(pendingMarkers, { timeout: 120_000 }).toBe(0);
    };

    // The page's own background refresh runs the actual generator for the no-context insight.
    await open("Decision A");
    await expect.poll(async () => (await recs()).length, { timeout: 120_000 }).toBe(1);
    const before = await recs();
    expect(before[0]).toMatchObject({ action_text: "Action framed for Decision A", decision_context: "Decision A" });
    await open("Decision A");
    await expect(earlier).toHaveCount(0);

    await reword("Decision A", "Decision C replaces Decision A");
    await open("Decision C replaces Decision A");
    await expect(earlier.first()).toContainText("1 recommendation was written for earlier ones", { timeout: 60_000 });
    expect(await recs(), "kept as it was").toEqual(before);
    expect((await db.query("select decision_context from insights where id=$1", [i])).rows[0].decision_context).toBeNull();

    await reword("Decision C replaces Decision A", "Decision A");
    await open("Decision A");
    await expect(earlier).toHaveCount(0);
    expect(await recs()).toEqual(before);
  } finally {
    rmSync(fixtureFile, { force: true });
    await db.end();
  }
});
