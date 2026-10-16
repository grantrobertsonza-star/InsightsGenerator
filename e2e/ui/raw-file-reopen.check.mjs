// IMP-010: reopening a ready raw data file shows a bounded preview with its true size and does not
// read the file again. Fixture: 5,000 cases by 301 columns (generated; synthetic).
//   1. After import has finished (stored table present, first read done, setup accepted), the
//      project is reopened twice.
//   2. Each reopen: the preview states the true size ("5,000 rows, 301 columns") and that it shows
//      only a bounded part ("Showing the first N of 5,000 rows and M of 301 columns"); Data quality
//      reports 5000 cases; the stored table keeps its id, creation time and 5,000 stored rows (a
//      re-read replaces it); and, on a dev server, whose log names each server action, the log for
//      the reopen contains no readDataFileAction (the action that parses the stored file).
// Real browser on the disposable stack; row_count and table identity are read from the database.
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
    // Identity (id, created_at) and the stored case count (the length of the stored rows, which is
    // what the page reports as the file's row count).
    const stored = async () => (await db.query("select id, created_at, jsonb_array_length(rows)::int as row_count from document_tables where run_id=$1", [run.id])).rows;
    await expect.poll(async () => (await stored()).length, { timeout: 120_000 }).toBe(1);
    await expect.poll(async () => (await db.query("select data_setup->>'accepted' as a from documents where run_id=$1 and kind='table'", [run.id])).rows[0]?.a, { timeout: 120_000 }).toBe("true");
    // Let the first read and its refresh finish before measuring a reopen: the stored table must
    // stay the same across a quiet interval. (A dev server also logs each server action by name;
    // a production server does not, so the table's identity is the mode-independent evidence.)
    await page.waitForLoadState("networkidle");
    let settled = JSON.stringify(await stored());
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(3_000);
      const now = JSON.stringify(await stored());
      if (now === settled) break;
      settled = now;
    }
    const before = await stored();
    expect(before[0].row_count).toBe(5000);

    for (let reopen = 1; reopen <= 2; reopen++) {
      const offset = readFileSync(appLog, "utf8").length;
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Import data/ }).first().click();
      for (const name of ["Preview what was read", "Data quality"]) {
        const summary = page.getByText(name, { exact: true }).first();
        await expect(summary).toBeVisible({ timeout: 60_000 });
        await summary.click();
      }
      await expect(page.getByText("Table 1: 5,000 rows, 301 columns").first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(/Showing the first \d+ of 5,000 rows and \d+ of 301 columns/).first()).toBeVisible();
      await expect(page.getByText("5000 cases.").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2_000);
      const during = readFileSync(appLog, "utf8").slice(offset);
      // Only meaningful where the server logs actions by name (next dev); always false otherwise.
      expect(during.includes(`readDataFileAction("${run.id}"`), `reopen ${reopen} re-read the file`).toBe(false);
      expect(await stored(), `reopen ${reopen} replaced the stored table`).toEqual(before);
    }
  } finally {
    await db.end();
  }
});
