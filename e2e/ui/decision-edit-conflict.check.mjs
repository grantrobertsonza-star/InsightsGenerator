// Codex DEC500-F01 (2026-10-24), in a real browser on the disposable stack: a decision editor opened
// before another change used to "save" over it (or over nothing, when the decision was deleted),
// close the editor and lose the draft. Now:
//   1. Another editor's wording lands while this editor is open (written to the database, as a
//      second page's save would): Save and accept is refused, the editor stays open with the draft,
//      and the stored wording is shown; "Replace with mine" then saves the draft deliberately.
//   2. The same with "Use current wording": the draft becomes the stored wording and saving it keeps it.
//   3. The decision is deleted while the editor is open: the save is refused, nothing is stored, the
//      draft stays in the box; after a reload the decision is gone, as stored.
// Synthetic decisions; no model call is needed.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;

test("a stale or deleted decision editor keeps the draft and says what is stored, never 'saved'", async ({ page }, testInfo) => {
  test.setTimeout(5 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `decision-conflict-${Date.now()}` });
    const t = target.tenantId;
    await db.query(
      "insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status,created_at) values($1,$2,'Decision one','r','ai_suggested','pending',now()-interval '3 min'),($1,$2,'Decision two','r','ai_suggested','pending',now()-interval '2 min'),($1,$2,'Decision three','r','ai_suggested','pending',now()-interval '1 min')",
      [t, run.id],
    );
    const stored = async (where) => (await db.query(`select candidate_text, status from decision_candidates where run_id=$1 and ${where}`, [run.id])).rows;
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Business decisions/ }).first().click();
    const cardOf = (text) => page.locator("div.rounded-lg.border", { has: page.getByText(text, { exact: true }) }).filter({ has: page.getByRole("button", { name: /Edit/ }) }).last();
    const editOpen = async (text) => {
      const card = cardOf(text);
      await expect(card).toBeVisible({ timeout: 60_000 });
      await card.getByRole("button", { name: /^Edit/ }).click();
      return page.locator("div.rounded-lg.border", { has: page.locator("textarea") }).last();
    };

    // 1. Another editor's wording lands; this one's save is refused and the draft kept.
    let editor = await editOpen("Decision one");
    await editor.locator("textarea").fill("Decision one, my wording");
    await db.query("update decision_candidates set candidate_text='Decision one, their wording', status='accepted' where run_id=$1 and candidate_text='Decision one'", [run.id]);
    await editor.getByRole("button", { name: "Save and accept" }).click();
    await expect(editor.getByTestId("decision-edit-conflict")).toContainText("changed after you opened it, so your edit was not saved");
    await expect(editor.getByTestId("decision-current-wording")).toContainText("Stored now: Decision one, their wording");
    await expect(editor.locator("textarea")).toHaveValue("Decision one, my wording");
    expect(await stored("candidate_text like 'Decision one%'")).toEqual([{ candidate_text: "Decision one, their wording", status: "accepted" }]);
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-decision-conflict.png") });
    await editor.getByRole("button", { name: "Replace with mine" }).click();
    await expect(editor.locator("textarea")).toHaveCount(0, { timeout: 60_000 });
    await expect.poll(() => stored("candidate_text like 'Decision one%'")).toEqual([{ candidate_text: "Decision one, my wording", status: "accepted" }]);

    // 2. Use current wording.
    editor = await editOpen("Decision two");
    await editor.locator("textarea").fill("Decision two, my wording");
    await db.query("update decision_candidates set candidate_text='Decision two, their wording' where run_id=$1 and candidate_text='Decision two'", [run.id]);
    await editor.getByRole("button", { name: "Save and accept" }).click();
    await expect(editor.getByTestId("decision-edit-conflict")).toBeVisible();
    await editor.getByRole("button", { name: "Use current wording" }).click();
    await expect(editor.locator("textarea")).toHaveValue("Decision two, their wording");
    await editor.getByRole("button", { name: "Save and accept" }).click();
    await expect.poll(() => stored("candidate_text like 'Decision two%'")).toEqual([{ candidate_text: "Decision two, their wording", status: "accepted" }]);

    // 3. Deleted while the editor is open.
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Business decisions/ }).first().click();
    editor = await editOpen("Decision three");
    await editor.locator("textarea").fill("Decision three, my wording");
    await db.query("delete from decision_candidates where run_id=$1 and candidate_text='Decision three'", [run.id]);
    await editor.getByRole("button", { name: "Save and accept" }).click();
    await expect(editor.getByTestId("decision-edit-conflict")).toContainText("no longer in the project");
    await expect(editor.locator("textarea")).toHaveValue("Decision three, my wording");
    expect(await stored("candidate_text like 'Decision three%'")).toEqual([]);
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-decision-gone.png") });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Business decisions/ }).first().click();
    await expect(page.getByText("Decision one, my wording", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Decision three", { exact: true })).toHaveCount(0);
  } finally {
    await db.end();
  }
});
