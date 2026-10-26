// A Setup objective edit or delete that the database refuses is reported, and the researcher's
// draft is kept (standing requirement: no "saved" before persistence, no silent loss of unsaved
// changes). Before the fix the action's error escaped the list's transition: the page was
// replaced by the runtime error screen and the open draft was lost.
// Real browser on the disposable stack; the refusal is a disposable trigger on this run's row.
//   1. Edit A to B while updates are refused: "Not saved: ..." with the database's reason; the
//      editor stays open holding B; the stored objective is still A.
//   2. Updates allowed again: Save stores B; after reload Setup shows B and not A.
//   3. Delete while updates are refused: "Not deleted: ..."; B is still listed and stored.
import { expect, test } from "@playwright/test";
import { openSection } from "./helpers/nav.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

test("a refused Setup edit or delete is reported and keeps the draft; a later save succeeds", async ({ page }, testInfo) => {
  page.on("dialog", (d) => d.accept());
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  const fn = `refuse_setup_${Date.now()}`;
  const refuse = (runId) => db.query(`create function ${fn}() returns trigger language plpgsql as $$ begin raise exception 'Synthetic edit outage'; end $$; create trigger ${fn} before update on runs for each row when (new.id='${runId}'::uuid) execute function ${fn}()`);
  const allow = () => db.query(`drop trigger if exists ${fn} on runs; drop function if exists ${fn}()`);
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `setup-save-failure-${Date.now()}` });
    const stated = async () => (await db.query("select stated_objectives_text from runs where id=$1", [run.id])).rows[0].stated_objectives_text;
    const setObjectives = () => openSection(page, "Set Objectives");

    await setObjectives();
    const form = page.locator("form", { has: page.locator('textarea[name="researchObjective"]') });
    await form.locator('textarea[name="researchObjective"]').fill("Save failure objective A");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    const itemA = page.locator("li").filter({ has: page.getByText("Save failure objective A", { exact: true }) }).last();
    await expect(itemA).toBeVisible({ timeout: 60_000 });
    await expect.poll(stated, { timeout: 30_000 }).toBe("Save failure objective A");

    // 1. Refused edit.
    await refuse(run.id);
    await itemA.getByRole("button", { name: "Edit", exact: true }).click();
    const editor = page.locator("li").filter({ has: page.locator("textarea") });
    await editor.locator("textarea").fill("Save failure objective B");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText(/Not saved: .*Synthetic edit outage/, { timeout: 60_000 });
    await expect(editor.locator("textarea")).toHaveValue("Save failure objective B");
    expect(await stated()).toBe("Save failure objective A");

    // 2. Retry with updates allowed.
    await allow();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(stated, { timeout: 30_000 }).toBe("Save failure objective B");
    await page.goto(run.url, { waitUntil: "networkidle" });
    await setObjectives();
    const itemB = page.locator("li").filter({ has: page.getByText("Save failure objective B", { exact: true }) }).last();
    await expect(itemB).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Save failure objective A", { exact: true })).toHaveCount(0);

    // 3. Refused delete.
    await refuse(run.id);
    await itemB.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(itemB.getByRole("alert")).toContainText(/Not deleted: .*Synthetic edit outage/, { timeout: 60_000 });
    await expect(itemB).toBeVisible();
    expect(await stated()).toBe("Save failure objective B");
  } finally {
    await allow().catch(() => {});
    await db.end();
  }
});
