// Codex TR500-F02 and TR500-F03 (2026-10-23): on the Findings page, a note, status or bulk change
// that is refused or fails keeps the researcher's work and says what happened beside the control;
// the project view stays; retrying the same draft (no retyping) saves it. In a real browser on the
// disposable stack, with synthetic findings inserted directly and faults made in the database: a
// trigger that refuses (or delays) updates of one finding, and a finding deleted after the page
// opened. No model calls.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) {
  throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
}
const SHOT = process.env.SHOT;
const BOUNDARY = /This part of the project could not be shown/;

test("refused, failed, delayed and stale finding edits keep the draft and the view; a retry saves the same draft", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  const fault = async (findingId, body) => {
    await db.query(`create or replace function tr500_fault() returns trigger language plpgsql as $$ begin ${body}; return new; end $$`);
    await db.query(`drop trigger if exists tr500_fault on findings`);
    await db.query(`create trigger tr500_fault before update on findings for each row when (old.id = '${findingId}') execute function tr500_fault()`);
  };
  const clearFault = async () => {
    await db.query(`drop trigger if exists tr500_fault on findings`);
    await db.query(`drop function if exists tr500_fault()`);
  };
  const stored = async (id) => (await db.query("select status, researcher_note from findings where id=$1", [id])).rows[0] ?? null;
  try {
    // A project with three synthetic stated findings.
    const stamp = Date.now();
    await page.goto(target.appUrl, { waitUntil: "networkidle" });
    await page.locator('a[href="/?entry=validate"]').click();
    await page.getByLabel("Project name").fill(`Edit failures ${stamp}`);
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    await page.waitForURL(/\/runs\/[0-9a-f-]{36}/);
    const runId = /\/runs\/([0-9a-f-]{36})/.exec(page.url())[1];
    const runUrl = page.url().split("?")[0];
    const tenant = (await db.query("select tenant_id from runs where id=$1", [runId])).rows[0].tenant_id;
    const ids = [];
    for (const label of ["Alpha", "Beta", "Gamma"]) {
      ids.push(
        (
          await db.query(
            "insert into findings(tenant_id,run_id,origin,finding_text,status,theme) values($1,$2,'stated',$3,'pending','Edit checks') returning id",
            [tenant, runId, `${label} finding ${stamp}: members renew when service is fast.`],
          )
        ).rows[0].id,
      );
    }
    const [alpha, beta, gamma] = ids;

    const openFindings = async () => {
      await page.goto(runUrl, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Findings(\s*\d+)?$/ }).first().click();
      await page.getByTestId("findings-tab-review").filter({ visible: true }).first().click();
    };
    // A finding's card in the list: the smallest visible block holding its text and its review
    // buttons, outside the "Finding detail" panel (which shows the selected finding again).
    const card = (label) =>
      page
        .locator("div")
        .filter({ hasText: `${label} finding ${stamp}` })
        .filter({ has: page.getByRole("button", { name: "Accept", exact: true }) })
        .filter({ hasNotText: "Finding detail" })
        .filter({ visible: true })
        .last();
    await openFindings();
    await expect(card("Alpha")).toBeVisible({ timeout: 60_000 });

    // 1. A refused note save: the draft stays, the reason shows inline, the view stays.
    const draft = "Researcher draft that must survive a refused save";
    await card("Alpha").getByRole("button", { name: "+ Add note" }).click();
    const note = card("Alpha").getByLabel("Note");
    await note.fill(draft);
    await fault(alpha, "raise exception 'Synthetic note refusal'");
    await card("Alpha").getByRole("button", { name: "Save", exact: true }).click();
    const noteError = card("Alpha").getByTestId("finding-note-error");
    await expect(noteError).toBeVisible({ timeout: 30_000 });
    await expect(noteError).toContainText("Your note is still here.");
    await expect(note).toHaveValue(draft);
    await expect(note).toBeEnabled();
    await expect(page.getByText(BOUNDARY)).toHaveCount(0);
    expect(await stored(alpha)).toMatchObject({ researcher_note: null });
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-note-refused.png") });

    // Recovery with the same draft, no retyping.
    await clearFault();
    await card("Alpha").getByRole("button", { name: "Save", exact: true }).click();
    await expect(card("Alpha").getByRole("button", { name: new RegExp(`^Note:\\s*${draft}`) })).toBeVisible({ timeout: 30_000 });
    expect(await stored(alpha)).toMatchObject({ researcher_note: draft });

    // 2. A delayed save: the editor stays open, disabled and showing the draft, until it settles.
    const slow = "A note saved slowly";
    await card("Beta").getByRole("button", { name: "+ Add note" }).click();
    await card("Beta").getByLabel("Note").fill(slow);
    await fault(beta, "perform pg_sleep(3)");
    await card("Beta").getByRole("button", { name: "Save", exact: true }).click();
    await expect(card("Beta").getByRole("button", { name: "Saving..." })).toBeVisible();
    await expect(card("Beta").getByLabel("Note")).toHaveValue(slow);
    await expect(card("Beta").getByLabel("Note")).toBeDisabled();
    await expect(card("Beta").getByRole("button", { name: new RegExp(`^Note:\\s*${slow}`) })).toBeVisible({ timeout: 30_000 });
    await clearFault();
    expect(await stored(beta)).toMatchObject({ researcher_note: slow });

    // 3. A finding deleted after the page opened: refused as gone, draft kept, view kept.
    const stale = "Note for a finding that was removed";
    await card("Gamma").getByRole("button", { name: "+ Add note" }).click();
    await card("Gamma").getByLabel("Note").fill(stale);
    await db.query("delete from findings where id=$1", [gamma]);
    await card("Gamma").getByRole("button", { name: "Save", exact: true }).click();
    await expect(card("Gamma").getByTestId("finding-note-error")).toContainText(/no longer in this project/, { timeout: 30_000 });
    await expect(card("Gamma").getByLabel("Note")).toHaveValue(stale);
    await expect(page.getByText(BOUNDARY)).toHaveCount(0);

    // 4. A refused status change: the buttons go back and say why; then it saves.
    await fault(beta, "raise exception 'Synthetic status refusal'");
    const accept = card("Beta").getByRole("button", { name: "Accept", exact: true });
    await accept.click();
    await expect(card("Beta").getByTestId("finding-status-error")).toBeVisible({ timeout: 30_000 });
    await expect(accept).toHaveAttribute("aria-pressed", "false");
    expect(await stored(beta)).toMatchObject({ status: "pending" });
    await expect(page.getByText(BOUNDARY)).toHaveCount(0);
    await clearFault();
    await accept.click();
    await expect(accept).toHaveAttribute("aria-pressed", "true");
    await expect(card("Beta").getByTestId("finding-status-error")).toHaveCount(0);
    await expect.poll(async () => (await stored(beta)).status).toBe("accepted");

    // 5. A bulk change naming a finding that is gone changes none, says so, and shows the saved
    //    statuses again. Alpha is deleted while its card is still on screen (step 4's save refreshed
    //    the list, so Gamma is no longer shown).
    await expect(card("Gamma")).toHaveCount(0);
    await db.query("delete from findings where id=$1", [alpha]);
    await page.getByRole("button", { name: /^Reject all/ }).first().click();
    const bulkError = page.getByTestId("findings-bulk-error");
    await expect(bulkError).toContainText(/1 of the 2 findings is no longer in this project, so none of them was changed/, { timeout: 30_000 });
    expect(await stored(beta)).toMatchObject({ status: "accepted" });
    await expect(card("Beta").getByRole("button", { name: "Accept", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(card("Beta").getByRole("button", { name: "Reject", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText(BOUNDARY)).toHaveCount(0);
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-bulk-refused.png") });

    // After a reload (Alpha gone), the same bulk change saves.
    await openFindings();
    await page.getByRole("button", { name: /^Reject all/ }).first().click();
    await expect.poll(async () => (await stored(beta)).status).toBe("rejected");
    await expect(page.getByTestId("findings-bulk-error")).toHaveCount(0);
  } finally {
    await clearFault().catch(() => {});
    await db.end();
  }
});
