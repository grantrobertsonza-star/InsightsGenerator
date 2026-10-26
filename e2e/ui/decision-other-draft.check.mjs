// Codex R2P-F02 (2026-10-26), in a real browser on the disposable stack: accepting one decision used to
// remount the whole decision section (its key followed whether a decision was set), closing another
// decision's open editor and losing the researcher's unsaved draft. Now:
//   1. First decision (the project had none): open B's editor and type, accept A, wait for the accept
//      to be stored and A's card to show it; B's editor is still open with the draft, and saving it
//      stores it.
//   2. Control, a decision already set: the same with C and D.
//   3. After a reload the stored wording and statuses are what the page shows.
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

test("accepting one decision keeps another decision's open draft", async ({ page }, testInfo) => {
  test.setTimeout(5 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `decision-other-draft-${Date.now()}` });
    await db.query(
      "insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status,created_at) select $1,$2,t,'r','ai_suggested','pending',now()-(n||' min')::interval from (values ('Decision A',4),('Decision B',3),('Decision C',2),('Decision D',1)) v(t,n)",
      [target.tenantId, run.id],
    );
    const stored = async () => Object.fromEntries((await db.query("select candidate_text, status from decision_candidates where run_id=$1", [run.id])).rows.map((r) => [r.candidate_text, r.status]));
    const statement = async () => (await db.query("select decision_statement from runs where id=$1", [run.id])).rows[0].decision_statement;
    expect(await statement()).toBeFalsy();
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Business decisions/ }).first().click();
    const cardOf = (text) => page.locator("div.rounded-lg.border", { has: page.getByText(text, { exact: true }) }).filter({ has: page.getByRole("button", { name: /Edit/ }) }).last();
    const editor = () => page.locator("div.rounded-lg.border", { has: page.locator("textarea:visible") }).filter({ has: page.getByRole("button", { name: "Save and accept" }) }).last();

    const keepsDraft = async (accept, edit, draft) => {
      const card = cardOf(edit);
      await expect(card).toBeVisible({ timeout: 60_000 });
      await card.getByRole("button", { name: /^Edit/ }).click();
      await editor().locator("textarea").fill(draft);
      await cardOf(accept).getByRole("button", { name: "Accept", exact: true }).click();
      await expect.poll(async () => (await stored())[accept], { timeout: 60_000 }).toBe("accepted");
      // The page has the accept: A's card says so (the refreshed server render has arrived).
      await expect(page.locator("div.rounded-lg.border", { has: page.getByText(accept, { exact: true }) }).getByText("Accepted decision")).toBeVisible({ timeout: 60_000 });
      await page.waitForLoadState("networkidle");
      await expect(editor().locator("textarea")).toHaveValue(draft);
      await editor().getByRole("button", { name: "Save and accept" }).click();
      await expect.poll(async () => (await stored())[draft], { timeout: 60_000 }).toBe("accepted");
      // The editor closed after its own save (the separate "Add decision" box is not an editor).
      await expect(page.locator("div.rounded-lg.border").filter({ has: page.getByRole("button", { name: "Save and accept" }) }).filter({ has: page.locator("textarea:visible") })).toHaveCount(0);
    };

    // 1. The first decision of the project (decision_statement empty before it).
    await keepsDraft("Decision A", "Decision B", "Decision B, my wording");
    expect(await statement()).toBeTruthy();
    // 2. Control: a decision is already set.
    await keepsDraft("Decision C", "Decision D", "Decision D, my wording");
    // 3. Reload shows what is stored.
    expect(await stored()).toEqual({ "Decision A": "accepted", "Decision B, my wording": "accepted", "Decision C": "accepted", "Decision D, my wording": "accepted" });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Business decisions/ }).first().click();
    for (const t of ["Decision A", "Decision B, my wording", "Decision C", "Decision D, my wording"]) await expect(page.getByText(t, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  } finally {
    await db.end();
  }
});
