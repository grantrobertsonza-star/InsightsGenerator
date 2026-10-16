// Objective evidence panel: a refused question edit keeps the editor and the researcher's draft and
// says why; a refused "Leave out" is reported. Before the fix the editor closed even when the save
// failed (the draft was lost), and the include/leave-out and retry results were ignored.
// Real browser on the disposable stack; the refusal is a disposable trigger on this run's evidence
// rows, dropped before the retry. The objective and its evidence question are synthetic inserts.
//   1. Edit the question, Save and re-read while updates are refused: "Not saved: ..." is shown, the
//      editor still holds the new wording, the stored question is unchanged.
//   2. Cancel, then Leave out while refused: "Not changed: ..." is shown, the question stays included.
//   3. With updates allowed, the edit saves and the panel shows the new wording after reload.
// Not covered natively: Continue reading staying offered after a failed evaluation round (it needs
// the evaluate action to fail while the panel's own load still works).
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FAILURE = /Synthetic evidence outage|The server could not complete this/;

test("a refused evidence question edit keeps the draft; a refused leave-out is reported", async ({ page }, testInfo) => {
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  const fn = `refuse_evidence_${Date.now()}`;
  const allow = () => db.query(`drop trigger if exists ${fn} on objective_evidence; drop function if exists ${fn}()`);
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `evidence-edit-failure-${Date.now()}` });
    const file = path.join(mkdtempSync(path.join(tmpdir(), "evidence-")), "evidence-data.csv");
    writeFileSync(file, ["Gender,Purchase", ...Array.from({ length: 40 }, (_, i) => `${i % 2 ? "Male" : "Female"},${i % 3 ? "Yes" : "No"}`)].join("\n"));
    await ui.upload(run, file, "table");
    await expect.poll(async () => Number((await db.query("select count(*) from document_tables where run_id=$1", [run.id])).rows[0].count), { timeout: 60_000 }).toBeGreaterThan(0);
    await db.query("update runs set research_objective='Evidence edit objective' where id=$1", [run.id]);
    const candidate = (await db.query("insert into objective_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Evidence edit objective','Synthetic fixture','researcher_authored','accepted') returning id", [target.tenantId, run.id])).rows[0].id;
    const evidence = (
      await db.query(
        "insert into objective_evidence(tenant_id,run_id,item_kind,item_order,item_text,objective_candidate_id,origin_candidate_id,origin_recorded,question,request_text,supports_if,against_if,expectation) values($1,$2,'objective',0,'Evidence edit objective',$3,$3,true,'Original evidence question?','Purchase by Gender','Men higher','Women higher',$4) returning id",
        [target.tenantId, run.id, candidate, JSON.stringify({ kind: "comparison", answer: "Yes", question: null, groupA: "Male", groupB: "Female", direction: "higher", measure: "percent" })],
      )
    ).rows[0].id;
    const stored = async () => (await db.query("select question, excluded from objective_evidence where id=$1", [evidence])).rows[0];
    const openReview = async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Review Objectives", exact: true }).click();
      await expect(page.getByText("Original evidence question?", { exact: true }).or(page.getByText("Revised evidence question?", { exact: true })).first()).toBeVisible({ timeout: 60_000 });
    };
    const question = () => page.locator("li", { hasText: /Original evidence question\?|Revised evidence question\?/ }).filter({ visible: true }).last();

    await openReview();
    await db.query(`create function ${fn}() returns trigger language plpgsql as $$ begin raise exception 'Synthetic evidence outage'; end $$; create trigger ${fn} before update on objective_evidence for each row when (new.run_id='${run.id}'::uuid) execute function ${fn}()`);

    // 1. Refused edit keeps the draft.
    await question().getByRole("button", { name: "Edit", exact: true }).click();
    const editor = page.locator("li", { has: page.getByRole("button", { name: "Save and re-read" }) }).filter({ visible: true }).last();
    const questionInput = editor.getByLabel("Question");
    await questionInput.fill("Revised evidence question?");
    await editor.getByRole("button", { name: "Save and re-read" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /Not saved:/ }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("alert").filter({ hasText: /Not saved:/ }).first()).toContainText(FAILURE);
    await expect(questionInput).toHaveValue("Revised evidence question?");
    expect(await stored()).toEqual({ question: "Original evidence question?", excluded: false });

    // 2. Refused leave-out is reported.
    await editor.getByRole("button", { name: "Cancel" }).click();
    await question().getByRole("button", { name: "Leave out", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: /Not changed:/ }).first()).toBeVisible({ timeout: 60_000 });
    expect(await stored()).toEqual({ question: "Original evidence question?", excluded: false });

    // 3. Allowed again: the edit saves and survives reload.
    await allow();
    await question().getByRole("button", { name: "Edit", exact: true }).click();
    const editor2 = page.locator("li", { has: page.getByRole("button", { name: "Save and re-read" }) }).filter({ visible: true }).last();
    await editor2.getByLabel("Question").fill("Revised evidence question?");
    await editor2.getByRole("button", { name: "Save and re-read" }).click();
    await expect.poll(async () => (await stored()).question, { timeout: 30_000 }).toBe("Revised evidence question?");
    await openReview();
    await expect(page.getByText("Revised evidence question?", { exact: true }).first()).toBeVisible();
  } finally {
    await allow().catch(() => {});
    await db.end();
  }
});
