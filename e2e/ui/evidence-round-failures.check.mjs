// Objective evidence panel, the reading loop's failure and limit branches (OBJ-REV-013 failed
// round, the OBJ-REV-M04 60-round guard and load failure), which the persistence-stall check
// (evaluator-write-recovery) does not reach.
// Real browser and server on the disposable stack. Controlled boundary: the browser intercepts the
// evaluate action only (recognised by its result, the one that carries "done"). Per round it
// passes the request through, rewrites the server's real result (the guard step), or answers
// without reaching the server: a {ok:false} result or a dropped connection, so the server's state
// is exactly what the panel is told. The crosstab planner's plan is fixture-supplied (scripted
// model boundary); the objective and its questions are synthetic inserts.
//   1. Failed round: the first round passes, the second returns {ok:false}. "Reading stopped:
//      <reason>" is shown, the panel is idle again and Continue reading is still offered, also
//      after a reload; with rounds passing through again it finishes and is no longer offered.
//   2. Guard: every round reports progress with 5 still unread. The loop stops after exactly 60
//      rounds, says it stopped after a long run with 5 unread, and keeps Continue reading.
//   3. Dropped connection: the round's request fails in the browser. "Reading stopped: ..." is
//      shown, the panel is idle again (buttons enabled) and keeps Continue reading. Before the fix
//      it stayed on "Reading the data..." with every button disabled.
//   4. Load failure: with the app role's read on objective_evidence revoked, opening Review
//      Objectives shows the load error instead of an empty or partial list; restored, it loads.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname) || !target.applicationRole?.name) {
  throw new Error(`${manifestPath} does not describe a disposable stack with a disposable app role; refusing to run.`);
}
const role = target.applicationRole.name;
const fixtureFile = path.join(path.dirname(path.resolve(manifestPath)), "model-fixture.json");
const REQUEST = "Purchase by Gender for the round failure check";
const EVALUATE = /\{"ok":true,"done":\d+,"remaining":\d+\}/;

test.afterEach(() => rmSync(fixtureFile, { force: true }));

test("a failed round, the 60-round guard, a dropped connection and a failed load each leave the panel usable and honest", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  // How the next evaluate responses are handled: a list of modes consumed one per round, then
  // `fallback` for the rest.
  let modes = [];
  let fallback = "pass";
  let evaluateRounds = 0;
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `evidence-rounds-${Date.now()}` });
    const rows = ["Gender,Purchase"];
    for (let i = 0; i < 30; i++) rows.push(`Male,${i < 24 ? "Yes" : "No"}`);
    for (let i = 0; i < 30; i++) rows.push(`Female,${i < 9 ? "Yes" : "No"}`);
    const file = path.join(mkdtempSync(path.join(tmpdir(), "rounds-")), "rounds-data.csv");
    writeFileSync(file, rows.join("\n"));
    await ui.upload(run, file, "table");
    await expect.poll(async () => Number((await db.query("select count(*) from document_tables where run_id=$1", [run.id])).rows[0].count), { timeout: 60_000 }).toBeGreaterThan(0);
    await db.query("update runs set research_objective='Round failure objective' where id=$1", [run.id]);
    const candidate =
      (await db.query("select id from objective_candidates where run_id=$1 and candidate_text='Round failure objective' limit 1", [run.id])).rows[0]?.id ??
      (await db.query("insert into objective_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Round failure objective','Synthetic fixture','researcher_authored','accepted') returning id", [target.tenantId, run.id])).rows[0].id;
    let order = 0;
    const addQuestion = (text) =>
      db.query(
        "insert into objective_evidence(tenant_id,run_id,item_kind,item_order,item_text,objective_candidate_id,origin_candidate_id,origin_recorded,question,request_text,supports_if,against_if,expectation) values($1,$2,'objective',$3,'Round failure objective',$4,$4,true,$5,$6,'Men higher','Women higher',$7)",
        [target.tenantId, run.id, order++, candidate, text, REQUEST, JSON.stringify({ kind: "comparison", answer: "Yes", question: null, groupA: "Male", groupB: "Female", direction: "higher", measure: "percent" })],
      );
    writeFileSync(fixtureFile, JSON.stringify({ untargeted: [{ match: REQUEST, tool: "submit_plan", input: { summary: "Purchase by Gender", rows: ["Purchase"], columns: ["Gender"], filters: [], unclear: [] } }] }));
    // Installed after the upload: the browser's interception is for the evaluate rounds only.
    // The evaluate action is recognised by its result (only it returns "done"); its action id and
    // first real response are kept, so a failed or dropped round is answered here without
    // reaching the server, and the server's state stays exactly as the panel is told.
    let evaluateId = null;
    let template = null;
    await page.route("**/*", async (route) => {
      const req = route.request();
      const id = req.headers()["next-action"];
      if (req.method() !== "POST" || !id) return route.continue();
      const isEvaluate = evaluateId !== null && id === evaluateId;
      const mode = isEvaluate ? (modes.length ? modes.shift() : fallback) : "pass";
      if (isEvaluate) evaluateRounds++;
      if (mode === "drop") return route.abort("connectionreset");
      if (mode === "fail") return route.fulfill({ ...template, body: template.body.replace(EVALUATE, '{"ok":false,"error":"Synthetic evaluation outage"}') });
      const response = await route.fetch();
      const body = await response.text();
      if (!isEvaluate && EVALUATE.test(body)) {
        evaluateId = id;
        template = { status: response.status(), headers: response.headers(), body };
        evaluateRounds++;
        modes.shift();
      }
      if (mode === "busy") return route.fulfill({ response, body: body.replace(EVALUATE, '{"ok":true,"done":1,"remaining":5}') });
      return route.fulfill({ response, body });
    });
    const stored = async () => Number((await db.query("select count(*) from objective_evidence_results where run_id=$1", [run.id])).rows[0].count);
    const openReview = async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Review Objectives", exact: true }).click();
    };
    const more = page.getByRole("button", { name: "Continue reading", exact: true });
    const idle = async () => {
      await expect(more).toBeEnabled({ timeout: 60_000 });
      await expect(page.getByRole("button", { name: /^(Gather again|Gather evidence)$/ })).toBeEnabled();
      await expect(page.getByText("Reading the data...", { exact: true })).toHaveCount(0);
    };
    // Finished: every expected answer stored and the panel idle with nothing left to continue.
    // (While a round runs the Continue button is labelled "Reading the data...", so its absence
    // alone is not a finish.)
    const finished = async (answers) => {
      await expect.poll(stored, { timeout: 120_000 }).toBe(answers);
      await expect(page.getByRole("button", { name: /^(Gather again|Gather evidence)$/ })).toBeEnabled({ timeout: 60_000 });
      await expect(more).toHaveCount(0);
    };

    // 1. Failed second round.
    for (const q of ["Round question one?", "Round question two?", "Round question three?"]) await addQuestion(q);
    await openReview();
    modes = ["pass", "fail"];
    evaluateRounds = 0;
    await more.click();
    await expect(page.getByRole("alert").filter({ hasText: "Synthetic evaluation outage" })).toBeVisible({ timeout: 120_000 });
    await idle();
    expect(evaluateRounds).toBe(2);
    expect(await stored()).toBe(2); // only the first round reached the server; one pair is unread
    // A failed round is not a finish: the panel still offers to continue after a reload too.
    await openReview();
    await expect(more).toBeVisible({ timeout: 60_000 });
    modes = [];
    await more.click();
    await finished(3);

    // 2. The 60-round guard.
    await addQuestion("Round question four?");
    await openReview();
    fallback = "busy";
    evaluateRounds = 0;
    await more.click();
    await expect(page.getByText("Stopped after a long run with 5 question(s) still unread. Use Continue reading below.")).toBeVisible({ timeout: 240_000 });
    expect(evaluateRounds).toBe(60);
    await idle();
    fallback = "pass";

    // 3. Dropped connection on a round.
    await addQuestion("Round question five?");
    await openReview();
    modes = ["drop"];
    evaluateRounds = 0;
    await more.click();
    await expect(page.getByRole("alert").filter({ hasText: /^Reading stopped: / })).toBeVisible({ timeout: 60_000 });
    await idle();
    expect(evaluateRounds).toBe(1);
    modes = [];
    await more.click();
    await finished(5);

    // 4. Load failure.
    await db.query(`revoke select on objective_evidence from ${role}`);
    try {
      await openReview();
      await expect(page.getByRole("alert").filter({ hasText: /objective_evidence|permission denied|The server could not complete this/ }).first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText("Round question one?", { exact: true })).toHaveCount(0);
    } finally {
      await db.query(`grant select on objective_evidence to ${role}`);
    }
    await openReview();
    await expect(page.getByText("Round question one?", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  } finally {
    await db.query(`grant select on objective_evidence to ${role}`).catch(() => {});
    await db.end();
  }
});
