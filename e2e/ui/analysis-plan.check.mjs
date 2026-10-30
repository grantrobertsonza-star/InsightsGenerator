// CE-6, the analysis plan, in the browser on the disposable stack. Real server and database; the model
// is the scripted replay (the table planner's plan is fixture-supplied); the objective and its two plan
// lines are synthetic inserts, as in evidence-round-failures.check.mjs.
//   1. The panel shows the plan summary (2 lines, 0 approved, 2 proposed) and the methodology note for
//      a plan written before the stated methodology changed.
//   2. Approving one line marks it Approved; the summary and the database agree, and so does a reload.
//   3. "Add approved tables to Cross tabs" moves only the approved line's table, with its line recorded.
//   4. Committing it in Cross tabs makes findings marked Planned, whose route names the line and its
//      objective; the unapproved line's table stays out of Cross tabs.
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
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) {
  throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
}
const fixtureFile = path.join(path.dirname(path.resolve(manifestPath)), "model-fixture.json");
const REQUEST = "Purchase by Gender for the plan check";
const SHOT = process.env.SHOT;

test.afterEach(() => rmSync(fixtureFile, { force: true }));
test.use({ viewport: { width: 1400, height: 1000 } });

test("plan lines are approved one by one, and the approved line's table makes planned findings", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `analysis-plan-${Date.now()}` });
    const rows = ["Gender,Purchase"];
    for (let i = 0; i < 40; i++) rows.push(`Male,${i < 30 ? "Yes" : "No"}`);
    for (let i = 0; i < 40; i++) rows.push(`Female,${i < 10 ? "Yes" : "No"}`);
    const file = path.join(mkdtempSync(path.join(tmpdir(), "plan-")), "plan-data.csv");
    writeFileSync(file, rows.join("\n"));
    await ui.upload(run, file, "table");
    await expect.poll(async () => Number((await db.query("select count(*) from document_tables where run_id=$1", [run.id])).rows[0].count), { timeout: 60_000 }).toBeGreaterThan(0);
    const objective = "Know whether men buy more than women";
    await db.query("update runs set research_objective=$2, methodology='Compare age groups.' where id=$1", [run.id, objective]);
    const candidate = (await db.query(
      "insert into objective_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,$3,'Synthetic fixture','researcher_authored','accepted') returning id",
      [target.tenantId, run.id, objective],
    )).rows[0].id;
    // The current plan was written with another methodology than the one stated now.
    await db.query("insert into objective_evidence_generations(tenant_id,run_id,variables_truncated,pooled_count,used_count,is_current,methodology_state,methodology_sha) values($1,$2,false,2,2,true,'stated','0000')", [target.tenantId, run.id]);
    const expectation = JSON.stringify({ kind: "comparison", answer: "Yes", question: null, groupA: "Male", groupB: "Female", direction: "higher", measure: "percent" });
    for (const [order, question] of [[0, "Do men buy more than women?"], [1, "Is the gap at least ten points?"]]) {
      await db.query(
        "insert into objective_evidence(tenant_id,run_id,item_kind,item_order,item_text,objective_candidate_id,origin_candidate_id,origin_recorded,question,request_text,supports_if,against_if,expectation) values($1,$2,'objective',$3,$4,$5,$5,true,$6,$7,'Men higher','Women higher',$8)",
        [target.tenantId, run.id, order, objective, candidate, question, REQUEST, expectation],
      );
    }
    writeFileSync(fixtureFile, JSON.stringify({ untargeted: [{ match: REQUEST, tool: "submit_plan", input: { summary: "Purchase by Gender", rows: ["Purchase"], columns: ["Gender"], filters: [], unclear: [] } }] }));

    await page.goto(run.url, { waitUntil: "networkidle" });
    await openSection(page, "Review Objectives");
    const more = page.getByRole("button", { name: "Continue reading", exact: true });
    await expect(more).toBeVisible({ timeout: 60_000 });
    await more.click();
    await expect.poll(async () => Number((await db.query("select count(*) from objective_evidence_results where run_id=$1 and table_id is not null", [run.id])).rows[0].count), { timeout: 120_000 }).toBe(2);

    // 1. Summary and methodology note.
    const summary = page.getByTestId("plan-summary").filter({ visible: true });
    await expect(summary).toContainText("Plan: 2 lines, 0 approved, 2 proposed.", { timeout: 60_000 });
    await expect(summary.getByTestId("plan-methodology-note")).toContainText("stated methodology has changed since this plan was written");

    // 2. Approve the first line only.
    const firstLine = page.locator("li[data-plan-line]").filter({ hasText: "Do men buy more than women?" }).filter({ visible: true });
    await firstLine.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(firstLine.getByTestId("plan-approval")).toHaveText("Approved", { timeout: 60_000 });
    await expect(summary).toContainText("Plan: 2 lines, 1 approved, 1 proposed.");
    const approvedRows = async () => (await db.query("select question from objective_evidence where run_id=$1 and approved_revision = question_revision", [run.id])).rows.map((r) => r.question);
    expect(await approvedRows()).toEqual(["Do men buy more than women?"]);
    await page.reload({ waitUntil: "networkidle" });
    await openSection(page, "Review Objectives");
    await expect(page.locator("li[data-plan-line]").filter({ hasText: "Do men buy more than women?" }).filter({ visible: true }).getByTestId("plan-approval")).toHaveText("Approved", { timeout: 60_000 });
    if (SHOT) await page.locator("li[data-plan-line]").filter({ visible: true }).first().locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]").screenshot({ path: SHOT });

    // 3. Only the approved line's table moves, with its line recorded.
    await page.getByRole("button", { name: "Add approved tables to Cross tabs" }).filter({ visible: true }).click();
    await expect(page.getByText(/1 table from plan-data\.csv added to Cross tabs as drafts/).filter({ visible: true })).toBeVisible({ timeout: 60_000 });
    const tables = async () =>
      (await db.query("select dt.crosstab_status, dt.plan_line->>'question' as question from objective_evidence_results r join document_tables dt on dt.id = r.table_id where r.run_id=$1 order by question nulls last", [run.id])).rows;
    expect(await tables()).toEqual([{ crosstab_status: "draft", question: "Do men buy more than women?" }, { crosstab_status: "evidence", question: null }]);

    // 4. Commit in Cross tabs; the findings are Planned and name their line and objective.
    // The sidebar entry carries a count once a draft is waiting ("Cross tabs 1").
    await openSection(page, /^Cross tabs(\s*\d+)?$/);
    const commit = page.getByTestId("crosstab-workspace").filter({ visible: true }).getByRole("button", { name: /^Commit \d+ table/ });
    await expect(commit).toBeVisible({ timeout: 120_000 });
    await commit.click();
    await expect(page.getByText(/Committed \d+ table\(s\)\. [1-9]\d* finding\(s\) generated\./).filter({ visible: true })).toBeVisible({ timeout: 180_000 });
    await page.reload({ waitUntil: "networkidle" });
    await openSection(page, /^Findings(\s*\d+)?$/);
    // Findings opens on its overview; the findings themselves are on the review tab.
    await page.getByTestId("findings-tab-review").filter({ visible: true }).first().click();
    const planned = page.locator('[data-testid="finding-route"][data-route="planned"]').filter({ visible: true });
    await expect(planned.first()).toBeVisible({ timeout: 60_000 });
    await expect(planned.first()).toHaveAttribute("title", `Planned: "Do men buy more than women?" (approved), for the objective "${objective}"`);
    if (SHOT) {
      await planned.first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: SHOT.replace(/\.png$/, "-finding.png") });
    }
  } finally {
    await db.end();
  }
});
