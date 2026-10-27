// Renaming and deleting a program (Grant, 27 October 2026), in a real browser on the disposable stack:
// rename shows the new name after saving; delete asks once, in place, saying the projects are kept; after
// it the program is gone and its project is still in the project list, unlinked.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;

test("a program can be renamed and deleted, and its project is kept", async ({ page }, testInfo) => {
  test.setTimeout(3 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const t = target.tenantId;
    const stamp = Date.now();
    const program = (await db.query("insert into programs(tenant_id,name) values($1,$2) returning id", [t, `Tracker ${stamp}`])).rows[0].id;
    const run = (await db.query("insert into runs(tenant_id,project_name,program_id,wave_label) values($1,$2,$3,'Wave 2') returning id", [t, `Kept project ${stamp}`, program])).rows[0].id;
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    await bind({ page, target, testInfo });
    await page.goto(`${target.appUrl}/programs`, { waitUntil: "networkidle" });
    const card = page.locator("li", { hasText: `Tracker ${stamp}` }).filter({ has: page.getByTestId("program-controls") });
    await card.getByRole("button", { name: "Rename" }).click();
    await card.getByLabel("Program name").fill(`Renamed tracker ${stamp}`);
    await card.getByRole("button", { name: "Save" }).click();
    const renamed = page.locator("li", { hasText: `Renamed tracker ${stamp}` }).filter({ has: page.getByTestId("program-controls") });
    await expect(renamed).toBeVisible({ timeout: 30_000 });
    expect((await db.query("select name from programs where id=$1", [program])).rows[0].name).toBe(`Renamed tracker ${stamp}`);

    await renamed.getByRole("button", { name: "Delete" }).click();
    await expect(renamed.getByRole("group", { name: "Confirm delete" })).toContainText("Its 1 project is unlinked and kept, with all their data.");
    if (SHOT) await page.screenshot({ path: SHOT });
    await renamed.getByRole("button", { name: "Delete program" }).click();
    await expect(page.locator("li", { hasText: `Renamed tracker ${stamp}` })).toHaveCount(0, { timeout: 30_000 });
    expect((await db.query("select count(*)::int as n from programs where id=$1", [program])).rows[0].n).toBe(0);
    expect((await db.query("select program_id, project_name from runs where id=$1", [run])).rows[0]).toEqual({ program_id: null, project_name: `Kept project ${stamp}` });
  } finally {
    await db.end();
  }
});
