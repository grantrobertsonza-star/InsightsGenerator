// What a researcher sees, and what is left behind, when the storage write of an upload fails
// (IMP-017 / IMP-007). The IMP-017 v12 run recorded "Upload of ... failed: fetch failed" for one
// project with no document row; its page and its complete storage state were never captured.
// This check reproduces that error class on the disposable stack, in two forms:
//   - the connection drops before the bytes are stored;
//   - the bytes are stored and then the connection drops, so the app never learns they landed.
// For each it asserts: the failure is shown on the page naming the file; no document row; no
// pending cleanup record; no object left in storage for the project (the stand-in's complete
// inventory, not a list of referenced objects); after a reload the project still lists no file.
// Then, with storage healthy, the same file uploads once and is stored once.
// Not covered: concurrent uploads at the 20 MB / 100,000-case limit, and real hosted storage.
// Synthetic data only. No model calls.
import { expect, test } from "@playwright/test";
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

test.afterEach(() => rmSync(target.storageFaultFile, { force: true }));

test("a failed upload storage write is shown, leaves no document, cleanup record or stored object, and a healthy retry stores the file once", async ({ page }) => {
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const dir = mkdtempSync(path.join(tmpdir(), "upload-failure-"));
    const file = path.join(dir, "storage-check.csv");
    writeFileSync(file, ["ID,Gender,Score", "1,1,5", "2,2,4", "3,1,3"].join("\n"));

    await page.goto(target.appUrl, { waitUntil: "networkidle" });
    await page.locator('a[href="/?entry=generate"]').click();
    await page.getByLabel("Project name").fill(`Upload failure check ${Date.now()}`);
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    await page.waitForURL(/\/runs\/[0-9a-f-]{36}/);
    const runUrl = page.url();
    const runId = /\/runs\/([0-9a-f-]{36})/.exec(runUrl)[1];

    const upload = async () => {
      await page.getByRole("button", { name: /Import data/ }).first().click();
      const form = page.locator("form", { has: page.locator('input[name="rawTableFiles"]') });
      await form.locator('input[name="rawTableFiles"]').setInputFiles(file);
      await form.getByRole("button", { name: "Upload", exact: true }).click();
    };
    const documents = async () => Number((await db.query("select count(*) from documents where run_id=$1", [runId])).rows[0].count);
    const pendingCleanup = async () =>
      Number((await db.query("select count(*) from trace where run_id=$1 and event='document_storage_cleanup_pending'", [runId])).rows[0].count);

    for (const mode of ["drop", "drop-after-store"]) {
      setFault({ put: mode });
      await upload();
      await expect(page.getByText(/Upload of storage-check\.csv failed/).first(), `${mode}: failure shown`).toBeVisible({ timeout: 60_000 });
      expect(await documents(), `${mode}: no document row`).toBe(0);
      expect(await pendingCleanup(), `${mode}: no pending cleanup record`).toBe(0);
      expect(await storedKeys(runId), `${mode}: no object left in storage`).toEqual([]);
      const errorTrace = await db.query("select detail from trace where run_id=$1 and event='upload_error' order by occurred_at desc limit 1", [runId]);
      test.info().annotations.push({ type: `${mode}-trace`, description: JSON.stringify(errorTrace.rows[0]?.detail ?? null) });

      await page.goto(runUrl, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /Import data/ }).first().click();
      await expect(page.getByText("storage-check.csv", { exact: true }), `${mode}: no file listed after reload`).toHaveCount(0);
    }

    rmSync(target.storageFaultFile, { force: true });
    await upload();
    await expect(page.getByText("storage-check.csv", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(documents, { timeout: 30_000 }).toBe(1);
    expect(await storedKeys(runId)).toHaveLength(1);
    expect(await pendingCleanup()).toBe(0);
  } finally {
    await db.end();
  }
});
