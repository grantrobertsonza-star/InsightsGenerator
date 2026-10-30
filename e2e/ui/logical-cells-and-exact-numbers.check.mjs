// Batch 28, in a real browser on the disposable stack with the actual engine:
//   1. Codex B26-F02: an Excel workbook with genuine logical cells (TRUE, FALSE, blank) is stored as
//      true/false/null, and its Preview tab shows TRUE and FALSE (and a zero) as text, before and after a
//      reload; the blank cell stays blank.
//   2. Codex B26-F01: a CSV whose values are decimal and exponent spellings of numbers beyond a double's
//      exact range is stored and previewed as the text written, four distinct values.
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

test("logical cells show as TRUE/FALSE and exact-range numbers keep their written text in the Preview", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "logical-"));
  execFileSync("python3", ["-I", "-c", String.raw`
import sys, openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Data"
ws.append(["respondent", "agreed", "score", "count"])
ws.append(["r1", True, 1, 0])
ws.append(["r2", False, 2, 5])
ws.append(["r3", None, 3, 7])
wb.save(sys.argv[1])
`, path.join(dir, "logical.xlsx")]);
  const big = ["9007199254740992.0", "9007199254740993.0", "9007199254740992e0", "9007199254740993e0"];
  writeFileSync(path.join(dir, "big.csv"), `id,big\n${big.map((v, i) => `r${i + 1},${v}`).join("\n")}\n`);

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
      "select t.rows from document_tables t join documents d on d.id = t.document_id where d.run_id = $1 and t.table_index = 0",
      [runId],
    )).rows[0];
    /** The Preview tab's body cells, row by row, as the researcher sees them. */
    const previewCells = async (filename) => {
      await openSource(page, filename);
      const preview = await openSourceTab(page, "Preview");
      const body = preview.locator("table tbody tr");
      await expect(body.first()).toBeVisible({ timeout: 60_000 });
      return body.evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent ?? "")));
    };

    // 1. Logical cells.
    const logical = await ui.createRun({ name: `logical-cells-${Date.now()}` });
    await ui.upload(logical, path.join(dir, "logical.xlsx"), "table");
    await openImport(logical);
    await expect.poll(async () => (await stored(logical.id))?.rows?.length ?? 0, { timeout: 90_000 }).toBe(3);
    expect((await stored(logical.id)).rows).toEqual([
      { respondent: "r1", agreed: true, score: 1, count: 0 },
      { respondent: "r2", agreed: false, score: 2, count: 5 },
      { respondent: "r3", agreed: null, score: 3, count: 7 },
    ]);
    const expected = [["r1", "TRUE", "1", "0"], ["r2", "FALSE", "2", "5"], ["r3", "", "3", "7"]];
    await openImport(logical);
    expect(await previewCells("logical.xlsx")).toEqual(expected);
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-logical.png") });
    await page.reload({ waitUntil: "networkidle" });
    await openImport(logical);
    expect(await previewCells("logical.xlsx")).toEqual(expected);
    // The stored values are unchanged by showing them.
    expect((await stored(logical.id)).rows.map((r) => r.agreed)).toEqual([true, false, null]);

    // 2. Numbers beyond exact range keep their written text.
    const exact = await ui.createRun({ name: `exact-numbers-${Date.now()}` });
    await ui.upload(exact, path.join(dir, "big.csv"), "table");
    await openImport(exact);
    await expect.poll(async () => (await stored(exact.id))?.rows?.length ?? 0, { timeout: 90_000 }).toBe(4);
    expect((await stored(exact.id)).rows.map((r) => r.big)).toEqual(big);
    await openImport(exact);
    expect((await previewCells("big.csv")).map((r) => r[1])).toEqual(big);
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-exact.png") });
  } finally {
    await db.end();
  }
});
