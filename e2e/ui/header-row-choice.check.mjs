// The header row chosen on the Import screen (Grant's decision 9, second part), in a real browser on the disposable
// stack with the actual engine. A CSV whose preamble holds a two-value line ("Prepared by,Acme Research") is misread
// by detection, which takes that line for the header and refuses the rows below it:
//   1. the file is added through Add files as raw data and its read fails with the reason;
//   2. on its Setup tab the researcher chooses "Row 4" as the header row; "saved" shows only after the save, the set-up
//      asks for acceptance again, and the file is read again;
//   3. the stored table and the dictionary name id, brand and score; Data quality names the three title rows;
//   4. the researcher accepts the data again; after a reload the choice and the acceptance are still there.
// Written with the change (batch HR); first run in the T2 package's full suite, where the preview header was found by its cells.
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { addFiles } from "./helpers/addFiles.mjs";
import { openSource, openSourceTab } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;

test.use({ viewport: { width: 1440, height: 900 } });

test("a header row chosen on Import reads a file whose preamble detection misses, asks for acceptance again and is kept", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "header-row-"));
  const file = path.join(dir, "preamble.csv");
  writeFileSync(file, "Brand survey 2026\nPrepared by,Acme Research\nNote: weighted\nid,brand,score\n1,1,5\n2,2,6\n3,1,4\n");
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `header-row-${Date.now()}` });
    const document = async () => (await db.query(
      `select d.data_setup, t.headers, t.read_provenance from documents d
         left join document_tables t on t.document_id = d.id and t.table_index = 0
       where d.run_id = $1 and d.source_filename = 'preamble.csv'`,
      [run.id],
    )).rows[0];

    // 1. Added as raw data: detection takes the two-value line for the header, so the read is refused with the line.
    await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
    await addFiles(page, file, "Raw data");
    await expect(page.getByTestId("add-files-error")).toHaveCount(0);
    await expect(page.getByText(/^Could not read this file:.*header row has 2 columns/).first()).toBeVisible({ timeout: 90_000 });
    expect((await document())?.headers ?? null).toBeNull();

    // 2. The header row chosen on the Setup tab.
    await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
    const setup = await openSource(page, "preamble.csv", "Setup");
    const choice = setup.getByLabel("Header row: preamble.csv");
    await expect(choice).toBeEnabled({ timeout: 60_000 });
    await expect(choice).toHaveValue("");
    await choice.selectOption({ label: "Row 4" });
    await expect(setup.getByTestId("header-row-status")).toContainText("Header row saved", { timeout: 60_000 });
    await expect.poll(async () => (await document())?.data_setup?.headerRowsSkipped, { timeout: 60_000 }).toBe(3);
    expect((await document()).data_setup.accepted).toBe(false);
    await expect(setup.getByText("The set-up changed. Check the structure, the preview and the data quality, then accept the data again.")).toBeVisible();

    // 3. Read again under the chosen row: the variables are named by row 4, and the rows above it are named.
    await expect.poll(async () => (await document())?.headers ?? null, { timeout: 90_000 }).toEqual(["id", "brand", "score"]);
    expect((await document()).read_provenance).toMatchObject({ headerRowsSkipped: 3, titleRows: ["Brand survey 2026", "Prepared by Acme Research", "Note: weighted"] });
    await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
    const quality = await openSource(page, "preamble.csv", "Data quality");
    await expect(quality.getByTestId("read-title-rows")).toContainText("Prepared by Acme Research");
    const preview = await openSourceTab(page, "Preview");
    // The preview table's header cells, as the researcher reads them (the stored headers, read by row 4).
    const head = preview.locator("table thead").first();
    await expect(head).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await head.locator("th, td").allInnerTexts()).map((t) => t.trim())).toEqual(["id", "brand", "score"]);
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-chosen.png") });

    // 4. Accepted again; the choice and the acceptance survive a reload.
    const setupAgain = await openSourceTab(page, "Setup");
    await setupAgain.getByRole("button", { name: "Accept data" }).click();
    await expect.poll(async () => (await document())?.data_setup?.accepted, { timeout: 60_000 }).toBe(true);
    await page.reload({ waitUntil: "networkidle" });
    const reloaded = await openSource(page, "preamble.csv", "Setup");
    await expect(reloaded.getByLabel("Header row: preamble.csv")).toHaveValue("3", { timeout: 60_000 });
    await expect(reloaded.getByRole("button", { name: "Undo accept" })).toBeVisible();
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-accepted.png") });
  } finally {
    await db.end();
    rmSync(dir, { recursive: true, force: true });
  }
});
