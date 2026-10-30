// Delimited text (.txt) and SAS data files through the real browser and engine (Grant, 26 October
// 2026). Fixtures: a tab-delimited .txt in the shape of the Berkeley IGS Poll export ("NA" for
// missing), and the published SAS reference file fixtures/sas/test1.sas7bdat (counts taken from its
// reference CSV, fixtures/sas/test_sas7bdat_1.csv). A damaged file is the first third of a valid one.
//   .txt: the Add files panel suggests Raw data once it has read the file's first lines; the upload
//     imports and a table of party_reg reads 1 = 3 and 2 = 2 by raw code.
//   .sas7bdat: uploaded as Raw data, a table of Column2 reads pear 4, dog 3, crocodile 2 (blanks are
//     missing, not an answer).
//   R .rds (written by R itself, fixtures/r): a table of region reads North 2, South 2, East 1 by its
//     factor labels, in R's level order.
//   damaged .sas7bdat: "Could not read this file:" is shown, no table is stored, and the valid file
//     uploaded instead calculates.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { openAddFiles } from "./helpers/addFiles.mjs";
import { deleteFirstSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;

function fixtures() {
  const dir = mkdtempSync(path.join(tmpdir(), "data-file-formats-"));
  const rows = [["ID", "AGE", "party_reg", "Q1", "w1"], [1, 26, 1, "NA", 0.84], [2, 18, 2, 3, 1.21], [3, 44, 1, 3, 0.95], [4, 61, 2, 1, 1.02], [5, 33, 1, 2, 0.98]];
  writeFileSync(path.join(dir, "may2026.txt"), rows.map((r) => r.join("\t")).join("\r\n") + "\r\n");
  const sas = readFileSync(path.resolve("fixtures/sas/test1.sas7bdat"));
  writeFileSync(path.join(dir, "test1.sas7bdat"), sas);
  writeFileSync(path.join(dir, "damaged.sas7bdat"), sas.subarray(0, Math.floor(sas.length / 3)));
  return dir;
}

test.use({ viewport: { width: 1440, height: 1000 } });

test(".txt and SAS data files import and calculate; a damaged SAS file fails visibly and recovers", async ({ page }, testInfo) => {
  test.setTimeout(12 * 60_000);
  page.on("dialog", (d) => d.accept());
  const dir = fixtures();
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const openImport = async (run) => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Import data/ }).first().click();
    };
    const count = (table, variable, rawCode) => ui.readStatistic(table, { variable, rawCode, statistic: "category_count" });

    // .txt: the panel reads the first lines and suggests Raw data.
    const txtRun = await ui.createRun({ name: `txt-${Date.now()}` });
    await openImport(txtRun);
    const panel = await openAddFiles(page);
    await panel.getByTestId("add-files-input").setInputFiles(path.join(dir, "may2026.txt"));
    const row = panel.getByTestId("add-files-row").first();
    await expect(row.getByRole("combobox")).toHaveValue("raw", { timeout: 30_000 });
    await expect(row).toContainText("read like a data table");
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-txt-suggested.png") });
    await page.keyboard.press("Escape");
    await page.goto(txtRun.url, { waitUntil: "networkidle" });
    await ui.upload(txtRun, path.join(dir, "may2026.txt"), "table");
    const party = await ui.buildTable(txtRun, { row: "party_reg" });
    expect([await count(party, "party_reg", "1"), await count(party, "party_reg", "2")]).toEqual([3, 2]);

    // SAS reference file.
    const sasRun = await ui.createRun({ name: `sas-${Date.now()}` });
    await ui.upload(sasRun, path.join(dir, "test1.sas7bdat"), "table");
    const fruit = await ui.buildTable(sasRun, { row: "Column2" });
    expect([await count(fruit, "Column2", "pear"), await count(fruit, "Column2", "dog"), await count(fruit, "Column2", "crocodile")]).toEqual([4, 3, 2]);
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-sas-table.png") });

    // R data file: factor levels are its labels.
    const rRun = await ui.createRun({ name: `r-${Date.now()}` });
    await ui.upload(rRun, path.resolve("fixtures/r/survey.rds"), "table");
    const region = await ui.buildTable(rRun, { row: "region" });
    await expect(region.table).toContainText("North");
    await expect(region.table).toContainText("East");
    expect([await count(region, "region", "1"), await count(region, "region", "2"), await count(region, "region", "3")]).toEqual([2, 2, 1]);

    // Damaged SAS file: visible failure, nothing stored; replaced by the valid file.
    const badRun = await ui.createRun({ name: `sas-damaged-${Date.now()}` });
    await ui.upload(badRun, path.join(dir, "damaged.sas7bdat"), "table");
    await openImport(badRun);
    await expect(page.getByText(/^Could not read this file:/).first()).toBeVisible({ timeout: 90_000 });
    const doc = (await db.query("select id from documents where run_id=$1", [badRun.id])).rows[0].id;
    expect(Number((await db.query("select count(*) from document_tables where document_id=$1", [doc])).rows[0].count)).toBe(0);
    await deleteFirstSource(page);
    await expect.poll(async () => Number((await db.query("select count(*) from documents where id=$1 and run_id=$2", [doc, badRun.id])).rows[0].count), { timeout: 30_000 }).toBe(0);
    badRun.files = [];
    await page.goto(badRun.url, { waitUntil: "networkidle" });
    await ui.upload(badRun, path.join(dir, "test1.sas7bdat"), "table");
    const recovered = await ui.buildTable(badRun, { row: "Column2" });
    expect(await count(recovered, "Column2", "pear")).toBe(4);
  } finally {
    await db.end();
  }
});
