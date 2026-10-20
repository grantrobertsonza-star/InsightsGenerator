// IMP-010: reopening a ready raw data file shows a bounded preview with its true size and does not
// read the file again. Fixture: 5,000 cases by 301 columns (generated; synthetic).
//   1. After import has finished (stored table present, first read done, setup accepted), the
//      project is reopened twice.
//   2. Each reopen: the preview states the true size ("5,000 rows, 301 columns") and that it shows
//      only a bounded part ("Showing the first N of 5,000 rows and M of 301 columns"); Data quality
//      reports 5000 cases; and two signals that change on every read stay unchanged:
//        - the storage stand-in's count of downloads of this file's stored object (a read of the
//          file has to download it, in any server mode);
//        - the stored table row's version (xmin). A re-read upserts the table with ON CONFLICT DO
//          UPDATE, which keeps its id, created_at and (for the same file) its row count, so those
//          cannot show a re-read; but every update writes a new row version.
//      On a dev server, whose log names each server action, the log for the reopen must also not
//      contain readDataFileAction (the action that parses the stored file).
//   3. Positive control: changing the file's layout makes the page read the file again, and both
//      signals change, so the unchanged values in step 2 are not a blind check.
// Real browser on the disposable stack; the table row is read from the database and the download
// count from the stand-in's disposable /__reads endpoint.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openSource, openSourceTab } from "./helpers/sources.mjs";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname) || !target.storageReadsUrl) {
  throw new Error(`${manifestPath} does not describe a disposable stack with the storage read count; refusing to run.`);
}
const appLog = path.join(path.dirname(path.resolve(manifestPath)), "app.log");

test("reopening a ready 5,000 x 301 raw file shows a bounded preview with its true size and does not re-read it", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const dir = mkdtempSync(path.join(tmpdir(), "reopen-"));
    const file = path.join(dir, "wide-tall.csv");
    let seed = 7;
    const next = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), 1 + (seed % 5));
    const lines = [["ID", ...Array.from({ length: 300 }, (_, i) => `Q${i + 1}`)].join(",")];
    for (let r = 1; r <= 5000; r++) lines.push([r, ...Array.from({ length: 300 }, next)].join(","));
    writeFileSync(file, lines.join("\n"));

    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `raw-reopen-${Date.now()}` });
    await ui.upload(run, file, "table");
    // The stored table: identity, row version (changes on every write) and stored case count (what
    // the page reports as the file's row count).
    const stored = async () =>
      (await db.query("select id, xmin::text as version, jsonb_array_length(rows)::int as row_count from document_tables where run_id=$1", [run.id])).rows;
    // Downloads of this run's stored file(s) from the storage stand-in.
    const downloads = async () => {
      const paths = (await db.query("select storage_path from documents where run_id=$1", [run.id])).rows.map((r) => r.storage_path);
      const reads = await (await fetch(target.storageReadsUrl)).json();
      return Object.entries(reads).filter(([key]) => paths.some((sp) => key === sp || key.endsWith(`/${sp}`))).reduce((n, [, c]) => n + c, 0);
    };
    await expect.poll(async () => (await stored()).length, { timeout: 120_000 }).toBe(1);
    await expect.poll(async () => (await db.query("select data_setup->>'accepted' as a from documents where run_id=$1 and kind='table'", [run.id])).rows[0]?.a, { timeout: 120_000 }).toBe("true");
    // Let the first read and the one-time work after it finish before measuring a reopen. The first
    // view of the file also builds what is kept afterwards (its data audit reads the stored file a
    // few times, once), so the file is viewed once here, unmeasured; then the table row and the
    // download count must stay the same across three quiet intervals in a row. A single quiet
    // interval was not enough: a fast run could measure before that one-time work had started and
    // then count it against the first reopen (seen 2026-10-20: 1 download before, 4 after).
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    await openSource(page, "wide-tall.csv", "Data quality");
    await page.waitForLoadState("networkidle");
    const snapshot = async () => JSON.stringify([await stored(), await downloads()]);
    let settled = await snapshot();
    for (let i = 0, quiet = 0; i < 40 && quiet < 3; i++) {
      await page.waitForTimeout(3_000);
      const now = await snapshot();
      quiet = now === settled ? quiet + 1 : 0;
      settled = now;
    }
    const before = await stored();
    const downloadsBefore = await downloads();
    expect(before[0].row_count).toBe(5000);
    expect(downloadsBefore, "the first read downloaded the file").toBeGreaterThan(0);

    for (let reopen = 1; reopen <= 2; reopen++) {
      const offset = readFileSync(appLog, "utf8").length;
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Import data/ }).first().click();
      const preview = await openSource(page, "wide-tall.csv", "Preview");
      await expect(preview.getByText("Table 1: 5,000 rows, 301 columns")).toBeVisible({ timeout: 60_000 });
      await expect(preview.getByText(/Showing the first \d+ of 5,000 rows and \d+ of 301 columns/)).toBeVisible();
      const quality = await openSourceTab(page, "Data quality");
      await expect(quality.getByText("5000 cases.").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2_000);
      const during = readFileSync(appLog, "utf8").slice(offset);
      // Only meaningful where the server logs actions by name (next dev); always false otherwise.
      expect(during.includes(`readDataFileAction("${run.id}"`), `reopen ${reopen} re-read the file`).toBe(false);
      expect(await downloads(), `reopen ${reopen} downloaded the file again`).toBe(downloadsBefore);
      expect(await stored(), `reopen ${reopen} rewrote the stored table`).toEqual(before);
    }

    // 3. Positive control: a layout change reads the file again, and both signals move.
    await openSourceTab(page, "Setup");
    const layout = page.getByLabel(/^How the file is laid out: wide-tall\.csv$/).first();
    const current = await layout.inputValue();
    const other = await layout.locator("option").evaluateAll((os, cur) => os.map((o) => o.value).find((v) => v && v !== cur), current);
    await layout.selectOption(other);
    await expect.poll(downloads, { timeout: 120_000, message: "a layout change downloads the file" }).toBeGreaterThan(downloadsBefore);
    await expect.poll(async () => (await stored())[0]?.version, { timeout: 120_000, message: "a layout change rewrites the table" }).not.toBe(before[0].version);
  } finally {
    await db.end();
  }
});
