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
// Second test, the panel's own callers with reload (no failure injected): add your own decision,
// delete it, "Accept all" on two pending ones; after each reload the panel, the stored statuses
// and the decision statement agree, and nothing is left owed.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

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
      await expect(page.getByText("Decision B", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
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
  } finally {
    await allow().catch(() => {});
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
