// IMP-017 remainder: a file one unit over each supported limit is refused visibly and truthfully,
// the refusal survives a reload, nothing usable is left half-imported, and the corrected file then
// imports. Limits come from api/import-limits.json (100,000,000 bytes since 2026-10-19; 100,000 cases).
// Real browser, server, engine and database on the disposable stack, with the local storage
// stand-in (its complete inventory is checked). Synthetic CSV fixtures generated here.
//   1. Bytes: a file one byte over the limit is refused with the limit message; no document row, no
//      cleanup record, no stored object; after a reload nothing is listed for it. The corrected
//      file exactly at the limit then imports (its document and table exist).
//   2. Cases: a 100,001-case file (well under the byte limit) is refused with the 100,000-case
//      message; the refusal is still shown after a reload; no table is stored for it. After the
//      file is deleted, the corrected 100,000-case file imports with 100,000 stored rows.
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname) || !target.storageInventoryUrl) {
  throw new Error(`${manifestPath} does not describe a disposable stack with the storage inventory; refusing to run.`);
}
const limits = JSON.parse(readFileSync(path.resolve("api/import-limits.json"), "utf8"));

/** A one-column CSV of exactly `bytes` bytes with `cases` answers: padding goes into the header. */
function csv(bytes, cases) {
  const body = "Yes\n".repeat(cases);
  const header = "q" + " ".repeat(bytes - body.length - 2) + "\n";
  const b = Buffer.from(header + body);
  if (b.length !== bytes) throw new Error(`fixture is ${b.length} bytes, wanted ${bytes}`);
  return b;
}

test("one byte and one case over the limits are refused visibly, stay refused after reload, and the corrected files import", async ({ page }, testInfo) => {
  test.setTimeout(15 * 60_000);
  page.on("dialog", (d) => d.accept());
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const docs = async (run) => (await db.query("select id, source_filename from documents where run_id=$1", [run.id])).rows;
    const tables = async (run) => (await db.query("select jsonb_array_length(rows)::int as n from document_tables where run_id=$1", [run.id])).rows;
    const cleanup = async (run) => Number((await db.query("select count(*) from trace where run_id=$1 and event='document_storage_cleanup_pending'", [run.id])).rows[0].count);
    const objects = async (run) => (await (await fetch(target.storageInventoryUrl)).json()).filter((k) => k.includes(`/${run.id}/`));
    const openImport = async (run) => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Import data/ }).first().click();
      await expect(page.locator('input[name="rawTableFiles"]').first()).toBeAttached({ timeout: 60_000 });
    };
    // Written to disk first: Playwright refuses an in-memory file over 50 MB, and the byte limit is
    // 100 MB since 2026-10-19.
    const dir = mkdtempSync(path.join(tmpdir(), "limits-"));
    const upload = async (name, buffer) => {
      const form = page.locator("form", { has: page.locator('input[name="rawTableFiles"]') });
      const file = path.join(dir, name);
      writeFileSync(file, buffer);
      await form.locator('input[name="rawTableFiles"]').setInputFiles(file);
      await form.getByRole("button", { name: "Upload", exact: true }).click();
    };

    // 1. One byte over.
    const bytesRun = await ui.createRun({ name: `over-bytes-${Date.now()}` });
    await openImport(bytesRun);
    await upload("one-byte-over.csv", csv(limits.maxFileBytes + 1, 1000));
    await expect(page.getByText(new RegExp(`exceeds the supported ${Math.round(limits.maxFileBytes / 1e6)} MB limit \\(${limits.maxFileBytes.toLocaleString("en-GB")} bytes\\)`)).first()).toBeVisible({ timeout: 120_000 });
    expect(await docs(bytesRun)).toEqual([]);
    expect(await cleanup(bytesRun)).toBe(0);
    expect(await objects(bytesRun)).toEqual([]);
    await openImport(bytesRun);
    await expect(page.getByText("one-byte-over.csv", { exact: true })).toHaveCount(0);
    await upload("at-the-limit.csv", csv(limits.maxFileBytes, 1000));
    await expect.poll(async () => (await docs(bytesRun)).map((d) => d.source_filename), { timeout: 180_000 }).toEqual(["at-the-limit.csv"]);
    await expect.poll(async () => (await tables(bytesRun)).map((t) => t.n), { timeout: 180_000 }).toEqual([1000]);

    // 2. One case over.
    const casesRun = await ui.createRun({ name: `over-cases-${Date.now()}` });
    await openImport(casesRun);
    await upload("one-case-over.csv", csv(500_000, limits.maxCases + 1));
    const caseMessage = page.getByText(/exceeds the supported 100,000 case limit/).first();
    await expect(caseMessage).toBeVisible({ timeout: 180_000 });
    await openImport(casesRun);
    await expect(caseMessage).toBeVisible({ timeout: 120_000 });
    expect(await tables(casesRun)).toEqual([]);
    await page.getByRole("button", { name: "Delete document", exact: true }).first().click();
    await expect.poll(async () => (await docs(casesRun)).length, { timeout: 60_000 }).toBe(0);
    await openImport(casesRun);
    await upload("at-the-case-limit.csv", csv(500_000, limits.maxCases));
    await expect.poll(async () => (await tables(casesRun)).map((t) => t.n), { timeout: 240_000 }).toEqual([limits.maxCases]);
    await openImport(casesRun);
    await expect(page.getByText(/exceeds the supported 100,000 case limit/)).toHaveCount(0);
  } finally {
    await db.end();
  }
});
