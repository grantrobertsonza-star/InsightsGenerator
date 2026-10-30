// IMP-018: advertised native formats (SPSS .sav, Stata .dta) import, calculate and recover through
// the real browser and engine, in one retained invocation on the current tree. Ported from Codex's
// completion/native-formats.mjs (whose valid-SAV pass came from an earlier, later-failed
// invocation). Fixtures are generated here with pyreadstat: q has value labels 1=Yes, 2=No and the
// data hold three 1s and one 2. A truncated file is the first half of a valid file's bytes.
//   valid .sav / .dta: imported, and a table of q reads Yes = 3 and No = 2's count 1 by raw code.
//   truncated .sav / .dta: "Could not read this file:" is shown and still shown after reload, no
//     table is stored, the file can be deleted, and the valid file uploaded instead calculates
//     with no error shown after reload.
// SAS is covered by data-file-formats.check.mjs. processing_status is not used as a readiness
// signal (it stays null for raw files).
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { deleteFirstSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

function fixtures() {
  const dir = mkdtempSync(path.join(tmpdir(), "native-formats-"));
  const script = String.raw`
import sys, pandas as pd, pyreadstat
out = sys.argv[1]
df = pd.DataFrame({"id": [1.0, 2.0, 3.0, 4.0], "q": [1.0, 1.0, 1.0, 2.0]})
labels = {"q": {1.0: "Yes", 2.0: "No"}}
pyreadstat.write_sav(df, out + "/valid.sav", variable_value_labels=labels)
pyreadstat.write_dta(df, out + "/valid.dta", variable_value_labels=labels)
for ext in ("sav", "dta"):
    data = open(out + "/valid." + ext, "rb").read()
    open(out + "/truncated." + ext, "wb").write(data[: len(data) // 2])
`;
  execFileSync("python3", ["-I", "-c", script, dir]);
  return dir;
}

test("SAV and DTA: valid files calculate; truncated files fail visibly and recover by replacement", async ({ page }, testInfo) => {
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
    const counts = async (table) => [
      await ui.readStatistic(table, { variable: "q", rawCode: "1", statistic: "category_count" }),
      await ui.readStatistic(table, { variable: "q", rawCode: "2", statistic: "category_count" }),
    ];

    for (const ext of ["sav", "dta"]) {
      // Valid file.
      const validRun = await ui.createRun({ name: `valid-${ext}-${Date.now()}` });
      await ui.upload(validRun, path.join(dir, `valid.${ext}`), "table");
      const validTable = await ui.buildTable(validRun, { row: "q" });
      await expect(validTable.table).toContainText("Yes");
      await expect(validTable.table).toContainText("No");
      expect(await counts(validTable), `valid .${ext} counts`).toEqual([3, 1]);

      // Truncated file: visible failure, survives reload, nothing stored; replace and recover.
      const badRun = await ui.createRun({ name: `truncated-${ext}-${Date.now()}` });
      await ui.upload(badRun, path.join(dir, `truncated.${ext}`), "table");
      await openImport(badRun);
      await expect(page.getByText(/^Could not read this file:/).first(), `truncated .${ext} error`).toBeVisible({ timeout: 90_000 });
      await openImport(badRun);
      await expect(page.getByText(/^Could not read this file:/).first(), `truncated .${ext} error after reload`).toBeVisible({ timeout: 60_000 });
      const doc = (await db.query("select id from documents where run_id=$1", [badRun.id])).rows[0].id;
      expect(Number((await db.query("select count(*) from document_tables where document_id=$1", [doc])).rows[0].count)).toBe(0);
      await deleteFirstSource(page);
      // Removal moves the file to the project's bin (batch 25), so it leaves this project.
      await expect.poll(async () => Number((await db.query("select count(*) from documents where id=$1 and run_id=$2", [doc, badRun.id])).rows[0].count), { timeout: 30_000 }).toBe(0);
      badRun.files = [];
      await page.goto(badRun.url, { waitUntil: "networkidle" });
      await ui.upload(badRun, path.join(dir, `valid.${ext}`), "table");
      const recovered = await ui.buildTable(badRun, { row: "q" });
      expect(await counts(recovered), `recovered .${ext} counts`).toEqual([3, 1]);
      await openImport(badRun);
      await expect(page.getByText(/^Could not read this file:/)).toHaveCount(0);
    }
  } finally {
    await db.end();
  }
});
