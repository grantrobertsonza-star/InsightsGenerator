// The one reader for CSV, TSV and Excel (batch 26; Codex TP500/IP1000), in a real browser on the
// disposable stack with the actual engine:
//   1. A CSV with an unterminated quoted value is refused with the reason, still shown after reload,
//      and no table is stored (IP1000-F04).
//   2. A Windows-1252 CSV with codes 001, 1 and 0001 is stored with the accents and the three codes
//      intact, and its Data quality tab says it was read as Windows-1252 (IP1000-F01, F03).
//   3. An Excel file with a date-formatted column is stored as calendar dates and its Data quality tab
//      says so (IP1000-F02).
//   4. A stored table the retired reader wrote differently (codes as numbers, no read provenance) is
//      withheld on its Preview tab; "Read the file again" replaces it and the notice goes.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { openSource, openSourceTab } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;

test.use({ viewport: { width: 1440, height: 900 } });

test("the one reader refuses malformed CSV, keeps codes, text and dates, and replaces a table the old reader stored", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "one-reader-"));
  writeFileSync(path.join(dir, "malformed.csv"), 'a,b\n1,"unterminated\n2,3\n');
  writeFileSync(path.join(dir, "legacy-codes.csv"), Buffer.from("name,code,score\nCaf\xe9,001,1\nNa\xefve,1,2\nZo\xeb,0001,3\n", "latin1"));
  execFileSync("python3", ["-I", "-c", String.raw`
import sys, openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Data"
ws.append(["Observation date", "score"])
for serial, score in ((61, 1), (25569, 2), (45292, 3)):
    ws.append([serial, score]); ws.cell(ws.max_row, 1).number_format = "yyyy-mm-dd"
wb.save(sys.argv[1])
`, path.join(dir, "dated.xlsx")]);

  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const openImport = async (run) => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Import data/ }).first().click();
    };
    const stored = async (runId) => (await db.query(
      "select t.headers, t.rows, t.read_provenance, d.id from document_tables t join documents d on d.id = t.document_id where d.run_id = $1 and t.table_index = 0",
      [runId],
    )).rows[0];

    // 1. Malformed CSV.
    const bad = await ui.createRun({ name: `one-reader-malformed-${Date.now()}` });
    await ui.upload(bad, path.join(dir, "malformed.csv"), "table");
    await openImport(bad);
    await expect(page.getByText(/^Could not read this file:.*closing quotation mark/).first()).toBeVisible({ timeout: 90_000 });
    await openImport(bad);
    await expect(page.getByText(/^Could not read this file:.*closing quotation mark/).first()).toBeVisible({ timeout: 60_000 });
    expect(await stored(bad.id)).toBeUndefined();

    // 2. Windows-1252 CSV with distinct codes.
    const legacy = await ui.createRun({ name: `one-reader-legacy-${Date.now()}` });
    await ui.upload(legacy, path.join(dir, "legacy-codes.csv"), "table");
    await openImport(legacy);
    await expect.poll(async () => (await stored(legacy.id))?.rows?.length ?? 0, { timeout: 90_000 }).toBe(3);
    const legacyTable = await stored(legacy.id);
    expect(legacyTable.rows.map((r) => r.name)).toEqual(["Café", "Naïve", "Zoë"]);
    expect(legacyTable.rows.map((r) => r.code)).toEqual(["001", "1", "0001"]);
    expect(legacyTable.read_provenance).toMatchObject({ encoding: "windows-1252", layout: "rows_are_cases" });
    await openImport(legacy);
    const quality = await openSource(page, "legacy-codes.csv", "Data quality");
    await expect(quality.getByTestId("read-encoding")).toContainText("Windows-1252");
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-encoding.png") });

    // 3. Excel dates.
    const dated = await ui.createRun({ name: `one-reader-dates-${Date.now()}` });
    await ui.upload(dated, path.join(dir, "dated.xlsx"), "table");
    await openImport(dated);
    await expect.poll(async () => (await stored(dated.id))?.rows?.length ?? 0, { timeout: 90_000 }).toBe(3);
    expect((await stored(dated.id)).rows.map((r) => r["Observation date"])).toEqual(["1900-03-01", "1970-01-01", "2024-01-01"]);
    await openImport(dated);
    const datedQuality = await openSource(page, "dated.xlsx", "Data quality");
    await expect(datedQuality.getByTestId("read-dates")).toContainText('"Observation date"');
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-dates.png") });

    // 3b. Country codes with NA (Grant's decision 5): read as missing, and the Data quality tab says so.
    writeFileSync(path.join(dir, "countries.csv"), "id,country,score\n1,ZA,3\n2,NA,4\n3,NG,5\n4,US,2\n5,KE,1\n");
    const coded = await ui.createRun({ name: `one-reader-na-${Date.now()}` });
    await ui.upload(coded, path.join(dir, "countries.csv"), "table");
    await openImport(coded);
    await expect.poll(async () => (await stored(coded.id))?.rows?.length ?? 0, { timeout: 90_000 }).toBe(5);
    await openImport(coded);
    const codedQuality = await openSource(page, "countries.csv", "Data quality");
    await expect(codedQuality.getByTestId("read-na-codes")).toContainText('"country"');
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-na-codes.png") });

    // 3c. Title rows above the header (decision 9): left out of the table, and named on the Data quality tab.
    writeFileSync(path.join(dir, "titled.csv"), "Brand tracker wave 1\nExported 1 October 2026\n\nid,q1,q2\n1,2,3\n2,3,4\n");
    const titled = await ui.createRun({ name: `one-reader-title-${Date.now()}` });
    await ui.upload(titled, path.join(dir, "titled.csv"), "table");
    await openImport(titled);
    await expect.poll(async () => (await stored(titled.id))?.rows?.length ?? 0, { timeout: 90_000 }).toBe(2);
    expect((await stored(titled.id)).headers).toEqual(["id", "q1", "q2"]);
    await openImport(titled);
    const titledQuality = await openSource(page, "titled.csv", "Data quality");
    await expect(titledQuality.getByTestId("read-title-rows")).toContainText("Brand tracker wave 1");
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-title-rows.png") });

    // 4. A table the retired reader stored: codes as numbers, no provenance.
    await db.query(
      `update document_tables set read_provenance = null,
         rows = '[{"name":"Café","code":1,"score":1},{"name":"Naïve","code":1,"score":2},{"name":"Zoë","code":1,"score":3}]'::jsonb
       where document_id = $1 and table_index = 0`,
      [legacyTable.id],
    );
    await openImport(legacy);
    await openSource(page, "legacy-codes.csv");
    const preview = await openSourceTab(page, "Preview");
    const notice = preview.getByTestId("import-preview-recovery");
    await expect(notice).toContainText("differs from what the file holds now");
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-withheld.png") });
    await notice.getByTestId("read-file-again").click();
    await expect.poll(async () => (await stored(legacy.id)).rows.map((r) => r.code), { timeout: 90_000 }).toEqual(["001", "1", "0001"]);
    await expect(page.getByTestId("import-preview-recovery")).toHaveCount(0, { timeout: 60_000 });
    expect((await stored(legacy.id)).read_provenance).toMatchObject({ encoding: "windows-1252" });
  } finally {
    await db.end();
  }
});
