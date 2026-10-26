// OBJ-REV-013: a failed evidence write is never shown as a completed evaluation. Native path:
//   1. Every write of the evidence result fails (a disposable trigger raises on insert): "Continue
//      reading" reports the unsaved answer, no result row exists, and after a reload the work is
//      still pending (Continue reading offered).
//   2. With writes working again, Continue reading computes the answer from the actual data table:
//      exactly one current result, basis computed, with its table, the expected stance, no error,
//      and nothing pending after a reload.
// Ported from Codex's native harness (repair7/evaluator-stall-native-v12.mjs), whose retry could
// only end as an uncomputed planner failure because the model replay gave the crosstab planner
// no plan. Here the planner's submit_plan call is supplied by the stack's model fixture
// ("untargeted" rule), so the retry reaches the real engine. That is the scripted planner
// boundary: it does not test how a real model plans the table. The objective and its evidence
// question are synthetic fixtures inserted directly, as in the original harness.
// Data: 30 men (24 answer Yes) and 30 women (9 answer Yes), so the comparison is readable.
import { expect, test } from "@playwright/test";
import { openSection } from "./helpers/nav.mjs";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const fixtureFile = path.join(path.dirname(path.resolve(manifestPath)), "model-fixture.json");
const REQUEST = "Purchase by Gender for the write recovery check";

test.afterEach(() => rmSync(fixtureFile, { force: true }));

test("a refused evidence write stays pending through reload; the retry computes exactly one current result", async ({ page }, testInfo) => {
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  const trigger = `refuse_eval_${Date.now()}`;
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `evaluator-recovery-${Date.now()}` });
    const rows = ["Gender,Purchase"];
    for (let i = 0; i < 30; i++) rows.push(`Male,${i < 24 ? "Yes" : "No"}`);
    for (let i = 0; i < 30; i++) rows.push(`Female,${i < 9 ? "Yes" : "No"}`);
    const file = path.join(mkdtempSync(path.join(tmpdir(), "evaluator-")), "evaluation-data.csv");
    writeFileSync(file, rows.join("\n"));
    await ui.upload(run, file, "table");
    await expect.poll(async () => Number((await db.query("select count(*) from document_tables where run_id=$1", [run.id])).rows[0].count), { timeout: 60_000 }).toBeGreaterThan(0);

    const tenant = target.tenantId;
    await db.query("update runs set research_objective='Check native persistence' where id=$1", [run.id]);
    const candidate =
      (await db.query("select id from objective_candidates where run_id=$1 and candidate_text='Check native persistence' limit 1", [run.id])).rows[0]?.id ??
      (await db.query("insert into objective_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Check native persistence','Synthetic fixture','researcher_authored','accepted') returning id", [tenant, run.id])).rows[0].id;
    const evidence = (
      await db.query(
        "insert into objective_evidence(tenant_id,run_id,item_kind,item_order,item_text,objective_candidate_id,origin_candidate_id,origin_recorded,question,request_text,supports_if,against_if,expectation) values($1,$2,'objective',0,'Check native persistence',$3,$3,true,'Do men answer Yes to Purchase more often?',$4,'Men higher','Women higher',$5) returning id",
        [tenant, run.id, candidate, REQUEST, JSON.stringify({ kind: "comparison", answer: "Yes", question: null, groupA: "Male", groupB: "Female", direction: "higher", measure: "percent" })],
      )
    ).rows[0].id;
    writeFileSync(fixtureFile, JSON.stringify({ untargeted: [{ match: REQUEST, tool: "submit_plan", input: { summary: "Purchase by Gender", rows: ["Purchase"], columns: ["Gender"], filters: [], unclear: [] } }] }));

    const results = async () => (await db.query("select stance, basis, table_id, error from objective_evidence_results where evidence_id=$1", [evidence])).rows;
    const openReview = async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await openSection(page, "Review Objectives");
    };
    const more = page.getByRole("button", { name: "Continue reading", exact: true });

    // 1. Writes refused: reported, nothing stored, still pending after reload.
    await db.query(`create function ${trigger}() returns trigger language plpgsql as $$ begin if new.evidence_id='${evidence}'::uuid then raise exception 'Synthetic native write outage'; end if; return new; end $$; create trigger ${trigger} before insert or update on objective_evidence_results for each row execute function ${trigger}()`);
    await openReview();
    await more.click();
    await expect(page.getByText(/Could not save an answer for 1 question/)).toBeVisible({ timeout: 120_000 });
    expect(await results()).toEqual([]);
    await openReview();
    await expect(more).toBeVisible({ timeout: 60_000 });

    // 2. Writes restored: the retry computes one current result from the real table.
    await db.query(`drop trigger ${trigger} on objective_evidence_results; drop function ${trigger}()`);
    await more.click();
    await expect.poll(async () => (await results()).length, { timeout: 120_000 }).toBe(1);
    const [saved] = await results();
    expect(saved).toMatchObject({ basis: "computed", stance: "supports", error: null });
    expect(saved.table_id).toBeTruthy();
    await openReview();
    await expect(page.getByText(/Could not save an answer/)).toHaveCount(0);
    await expect(more).toHaveCount(0);
    expect(await results()).toHaveLength(1);
  } finally {
    await db.query(`drop trigger if exists ${trigger} on objective_evidence_results; drop function if exists ${trigger}()`).catch(() => {});
    await db.end();
  }
});
