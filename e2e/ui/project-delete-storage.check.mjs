// Deleting a project when storage cannot remove its files (Codex RR-F03, 2026-10-23). With the
// stand-in refusing removals, the project disappears from the dashboard, the dashboard says its
// files are still in storage, and the file stays in the stand-in's inventory with its record in
// project_storage_cleanup; with storage healthy again, "Remove them now" removes the file and the
// notice and record go. Synthetic data only. No model calls.
import { expect, test } from "@playwright/test";
import { addFiles } from "./helpers/addFiles.mjs";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname) || !target.storageFaultFile || !target.storageInventoryUrl) {
  throw new Error(`${manifestPath} does not describe a disposable stack with storage fault hooks; refusing to run.`);
}
const setFault = (fault) => writeFileSync(target.storageFaultFile, JSON.stringify(fault));
const storedKeys = async (runId) => (await (await fetch(target.storageInventoryUrl)).json()).filter((k) => k.includes(`/${runId}/`));
const SHOT = process.env.SHOT;

test.afterEach(() => rmSync(target.storageFaultFile, { force: true }));

test("a project deleted during a storage outage keeps its file listed for retry, and the retry removes it", async ({ page }) => {
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const dir = mkdtempSync(path.join(tmpdir(), "project-delete-"));
    const file = path.join(dir, "delete-check.csv");
    writeFileSync(file, ["ID,Gender,Score", "1,1,5", "2,2,4", "3,1,3"].join("\n"));
    const name = `Delete check ${Date.now()}`;

    await page.goto(target.appUrl, { waitUntil: "networkidle" });
    await page.locator('a[href="/?entry=generate"]').click();
    await page.getByLabel("Project name").fill(name);
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    await page.waitForURL(/\/runs\/[0-9a-f-]{36}/);
    const runId = /\/runs\/([0-9a-f-]{36})/.exec(page.url())[1];
    await page.getByRole("button", { name: /Import data/ }).first().click();
    await addFiles(page, file, "Raw data");
    await expect.poll(async () => Number((await db.query("select count(*) from documents where run_id=$1", [runId])).rows[0].count), { timeout: 60_000 }).toBe(1);
    expect((await storedKeys(runId)).length).toBeGreaterThan(0);

    // Storage refuses removals; the project is deleted and its files are listed.
    setFault({ remove: true });
    await page.goto(target.appUrl, { waitUntil: "networkidle" });
    // The project's card (the cleanup notice also names the project once it is deleted).
    const card = page.locator("li").filter({ hasText: name }).filter({ has: page.getByRole("button", { name: "Delete" }) });
    page.once("dialog", (d) => d.accept());
    await card.getByRole("button", { name: "Delete" }).click();
    await expect(card).toHaveCount(0, { timeout: 30_000 });
    const notice = page.getByTestId("project-cleanup-pending");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(`${name}: 1 file. Last attempt failed: Synthetic storage removal outage.`);
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-pending.png") });
    expect((await db.query("select 1 from runs where id=$1", [runId])).rowCount).toBe(0);
    expect((await storedKeys(runId)).length).toBeGreaterThan(0);
    expect((await db.query("select attempts from project_storage_cleanup where run_id=$1", [runId])).rows).toEqual([{ attempts: 1 }]);

    // Still listed after a reload; with storage healthy, the retry removes the file and the record.
    await page.reload({ waitUntil: "networkidle" });
    await expect(notice).toBeVisible();
    rmSync(target.storageFaultFile, { force: true });
    await notice.getByTestId("project-cleanup-retry").click();
    await expect(notice).toBeHidden({ timeout: 30_000 });
    expect(await storedKeys(runId)).toEqual([]);
    expect((await db.query("select 1 from project_storage_cleanup where run_id=$1", [runId])).rowCount).toBe(0);
  } finally {
    await db.end();
  }
});
