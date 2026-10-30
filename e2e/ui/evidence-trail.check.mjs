// CE-5 and CE-4 (Grant, 26 October 2026): "Trace the evidence" on a recommendation opens its evidence trail, in a
// real browser on the disposable stack. Seeded directly: a decision, an objective, a finding read from a
// report with its quote and page, its pre-insight, the synthesized insight, and the recommendation with
// the decision it serves. The coverage check runs through the stack's model-fixture override.
//   1. The card says which decision it serves; the trail shows the decision and the objective above the
//      recommendation, and the insight, pre-insight, finding, quote and source file beneath it.
//   2. From the objective ("Trace from this objective"): the conclusion, the insight it cites with the
//      recommendation acting on it, and the evidence beneath.
//   3. The researcher chooses the decisions the recommendation serves: "Saved" only after it is stored,
//      the card says "(chosen by the researcher)", and the trail shows it.
//   4. After the decision is rejected the trail marks it as no longer current, and the break count says so.
import { expect, test } from "@playwright/test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { openSection } from "./helpers/nav.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const fixtureFile = path.join(path.dirname(path.resolve(manifestPath)), "model-fixture.json");
const SHOT = process.env.SHOT;

test.use({ viewport: { width: 1440, height: 1000 } });
test.afterEach(() => rmSync(fixtureFile, { force: true }));

test("a recommendation's evidence trail runs from its decision and objective down to the quote and its source", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `evidence-trail-${Date.now()}` });
    const t = target.tenantId;
    const one = async (sql, p) => (await db.query(sql, p)).rows[0].id;
    await db.query("update runs set decision_statement = 'Whether to cut fees', stated_objectives_text = 'Understand why members leave' where id = $1", [run.id]);
    const decision = await one("insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Whether to cut fees','r','researcher_authored','accepted') returning id", [t, run.id]);
    const objective = await one("insert into objective_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Understand why members leave','r','researcher_authored','accepted') returning id", [t, run.id]);
    // CE-4: the brief passage the objective was filled from.
    const brief = await one("insert into documents(tenant_id,run_id,kind,source_filename,storage_path) values($1,$2,'evidence','brief.docx','seed/brief.docx') returning id", [t, run.id]);
    await db.query(
      "insert into brief_passages(tenant_id,run_id,field,objective_candidate_id,document_id,document_role,quote,verified) values($1,$2,'objective',$3,$4,'brief','We need to understand why members leave.',true)",
      [t, run.id, objective, brief],
    );
    // The report's text holds the finding's quote, so the insight's support can be checked (B37-F01).
    const doc = await one("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,extracted_text) values($1,$2,'report','exit-interviews.pdf','seed/exit.pdf','Exit interviews. Fees were the main reason I left. Other reasons were rare.') returning id", [t, run.id]);
    const finding = await one(
      "insert into findings(tenant_id,run_id,origin,finding_text,status,source_document_id,source_page,source_quote) values($1,$2,'stated','Fees drive leaving','accepted',$3,4,'Fees were the main reason I left.') returning id",
      [t, run.id, doc],
    );
    await db.query("insert into verdicts (tenant_id, finding_id, verdict_tier, rationale, statistical_checks, verification_method, corroboration_level) values ($1,$2,'robust','ok','{}','single_pass','single_source')", [t, finding]);
    const pre = await one("insert into insights(tenant_id,run_id,finding_id,headline,observation,tension,implication) values($1,$2,$3,'Fees push members out','o','t','i') returning id", [t, run.id, finding]);
    const si = await one("insert into synthesized_insights(tenant_id,run_id,headline,observation,tension,implication,triangulation_count,source_theme_count,review_status,action_plan_status) values($1,$2,'Fees are the exit trigger','o','t','i',1,1,'accepted','has_action') returning id", [t, run.id]);
    await db.query("insert into synthesized_insight_sources(synthesized_insight_id,pre_insight_id,tenant_id,support_snapshot) values($1,$2,$3,finding_support_parts($4))", [si, pre, t, finding]);
    const rec = await one("insert into recommendations(tenant_id,run_id,synthesized_insight_id,action_text,owner_role,owner_feasibility_note,timeline,metric,priority,assumptions_and_risks,alternatives_considered,source,status) values($1,$2,$3,'Cut the monthly fee for at-risk members','Head of Retention','n','Q1','m','high','a','b','ai_suggested','accepted') returning id", [t, run.id, si]);
    await db.query("insert into recommendation_decisions(recommendation_id,decision_candidate_id,decision_text,position,origin,tenant_id) values($1,$2,'Whether to cut fees',0,'model',$3)", [rec, decision, t]);
    writeFileSync(fixtureFile, JSON.stringify({ tools: { record_validations: [{ match: "Validate the insights against the objectives and decisions now", input: { validations: [{ item_index: 0, status: "resolved", conclusion: "Fees explain leaving.", insight_indices: [0] }, { item_index: 1, status: "resolved", conclusion: "Supports cutting fees.", insight_indices: [0] }] } }] } }));

    // Coverage is checked through the app, so the objective link is the app's own. The objective's
    // detail shows the brief passage it came from (CE-4).
    await page.goto(run.url, { waitUntil: "networkidle" });
    await openSection(page, "Review Objectives");
    await page.getByTestId("stated-objectives").getByRole("button", { name: /Understand why members leave/ }).click();
    await expect(page.getByTestId("objective-passage")).toContainText("We need to understand why members leave.");
    await expect(page.getByTestId("objective-passage")).toContainText("From the brief (brief.docx)");
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-passage.png"), fullPage: true });
    await page.getByRole("button", { name: "All objectives" }).click();
    await page.getByRole("button", { name: /^Check (now|again)$/ }).click();
    await expect.poll(async () => Number((await db.query("select count(*) from objective_validations where run_id=$1", [run.id])).rows[0].count), { timeout: 90_000 }).toBe(2);

    const openTrail = async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Recommendations/ }).first().click();
      await page.getByTestId("rec-tab-review").first().click();
      const card = page.locator(`[data-testid="recommendation-card"][data-recommendation-id="${rec}"]`).filter({ visible: true });
      await expect(card.getByTestId("recommendation-serves")).toContainText("Whether to cut fees");
      await card.getByRole("button", { name: "Trace the evidence" }).click();
      const trail = page.getByTestId("evidence-trail");
      await expect(trail.getByTestId("trail-tree")).toBeVisible({ timeout: 60_000 });
      return trail;
    };

    // 1. The whole trail.
    let trail = await openTrail();
    const purpose = trail.getByTestId("trail-purpose");
    await expect(purpose.locator('[data-kind="decision"]')).toContainText("Whether to cut fees");
    await expect(purpose.locator('[data-kind="objective"]')).toContainText("Understand why members leave");
    await expect(purpose.locator('[data-kind="passage"]')).toContainText("We need to understand why members leave.");
    await expect(purpose.locator('[data-kind="passage"]')).toContainText("From the brief (brief.docx)");
    const tree = trail.getByTestId("trail-tree");
    await expect(tree.locator('[data-kind="recommendation"]')).toContainText("Cut the monthly fee");
    await expect(tree.locator('[data-kind="insight"]')).toContainText("Fees are the exit trigger");
    await expect(tree.locator('[data-kind="finding"]')).toContainText("Fees drive leaving");
    await expect(tree.locator('[data-kind="data"]')).toContainText("Fees were the main reason I left.");
    await expect(tree.locator('[data-kind="source"]')).toContainText("exit-interviews.pdf, p. 4");
    await expect(trail.locator('[data-state="broken"]')).toHaveCount(0);
    if (SHOT) await trail.screenshot({ path: SHOT });
    await trail.getByRole("button", { name: "Close" }).click();
    await expect(trail).toHaveCount(0);

    // 2. The same trail read from the objective down.
    await page.goto(run.url, { waitUntil: "networkidle" });
    await openSection(page, "Review Objectives");
    await page.getByTestId("stated-objectives").getByRole("button", { name: /Understand why members leave/ }).click();
    await page.getByTestId("trace-objective").click();
    const fromObjective = page.getByTestId("evidence-trail");
    await expect(fromObjective.getByTestId("trail-tree")).toBeVisible({ timeout: 60_000 });
    await expect(fromObjective.getByTestId("trail-purpose").locator('[data-kind="objective"]')).toContainText("Understand why members leave");
    await expect(fromObjective.getByTestId("trail-purpose").locator('[data-kind="passage"]')).toContainText("We need to understand why members leave.");
    const objTree = fromObjective.getByTestId("trail-tree");
    await expect(objTree.locator('[data-kind="coverage"]')).toContainText("Fees explain leaving.");
    await expect(objTree.locator('[data-kind="insight"]')).toContainText("Fees are the exit trigger");
    await expect(objTree.locator('[data-kind="recommendation"]')).toContainText("Cut the monthly fee");
    await expect(objTree.locator('[data-kind="source"]')).toContainText("exit-interviews.pdf, p. 4");
    if (SHOT) await fromObjective.screenshot({ path: SHOT.replace(".png", "-objective.png") });
    await fromObjective.getByRole("button", { name: "Close" }).click();

    // 3. The researcher chooses the decisions it serves, adding a second one.
    const second = await one("insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Whether to add a loyalty tier','r','researcher_authored','accepted') returning id", [t, run.id]);
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Recommendations/ }).first().click();
    await page.getByTestId("rec-tab-review").first().click();
    const recCard = page.locator(`[data-testid="recommendation-card"][data-recommendation-id="${rec}"]`).filter({ visible: true });
    await recCard.getByTestId("recommendation-serves").getByRole("button", { name: "Change" }).click();
    const chooser = recCard.getByTestId("served-decisions-chooser");
    await chooser.getByLabel("Whether to add a loyalty tier").check();
    await chooser.getByRole("button", { name: "Save" }).click();
    await expect(recCard.getByTestId("served-decisions-saved")).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await db.query("select decision_candidate_id, origin from recommendation_decisions where recommendation_id=$1 order by position", [rec])).rows).toEqual([
      { decision_candidate_id: decision, origin: "researcher" },
      { decision_candidate_id: second, origin: "researcher" },
    ]);
    await expect(recCard.getByTestId("recommendation-serves")).toContainText("Whether to add a loyalty tier");
    await expect(recCard.getByTestId("recommendation-serves")).toContainText("(chosen by the researcher)");
    if (SHOT) await recCard.screenshot({ path: SHOT.replace(".png", "-decisions.png") });
    trail = await openTrail();
    await expect(trail.getByTestId("trail-purpose").locator('[data-kind="decision"]').nth(1)).toContainText("Chosen by the researcher");
    await trail.getByRole("button", { name: "Close" }).click();

    // 4. A decision rejected since: no longer current, and coverage is out of date too.
    await db.query("update decision_candidates set status='rejected' where id=$1", [decision]);
    trail = await openTrail();
    await expect(trail.getByTestId("trail-purpose").locator('[data-kind="decision"]').first()).toContainText("No longer a current decision.");
    await expect(trail.getByTestId("trail-purpose").locator('[data-kind="decision"]').first()).toHaveAttribute("data-state", "caution");
    await expect(trail.getByTestId("trail-purpose").locator('[data-kind="objective"]')).toContainText("Out of date");
  } finally {
    await db.end();
  }
});
