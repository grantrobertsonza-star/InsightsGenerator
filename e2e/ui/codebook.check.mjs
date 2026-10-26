// A codebook added beside a data file (Grant, 26 October 2026), in a real browser on the disposable
// stack: a tab-delimited data file and a codebook laid out as the Berkeley IGS Poll's (a header whose
// name and label columns are swapped, section rows, "1=Democrat, 2=..." values). The Add files panel
// suggests Codebook from the file name; the codebook is read and matched by itself; "Confirm
// same-code matches" confirms every variable; a table of party_reg then shows the codebook's labels.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as XLSX from "xlsx";
import { openAddFiles } from "./helpers/addFiles.mjs";
import { selectSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;

function fixtures() {
  const dir = mkdtempSync(path.join(tmpdir(), "codebook-"));
  writeFileSync(path.join(dir, "may2026.txt"), "ID\tparty_reg\tw1\n1\t1\t0.9\n2\t4\t1.1\n3\t1\t1.0\n4\t2\t1.0\n");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["VARIABLE LABEL", "VARIABLE NAME", "VALUES"],
    [],
    ["ESSENTIAL VARIABLES FROM PDI RECORD"],
    ["party_reg", "Party registration", "1=Democrat, 2=No Party Preference, 3=Other Party, 4=Republican"],
    ["METADATA VARIABLES"],
    ["ID", "Identification number assigned to respondent", "as is"],
    ["w1", "Statewide weights", "as is"],
  ]), "May26_codebook");
  writeFileSync(path.join(dir, "May26_codebook.xlsx"), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  return dir;
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("a codebook is read, matched by name and gives the data file its labels", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const dir = fixtures();
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `codebook-${Date.now()}` });
  await ui.upload(run, path.join(dir, "may2026.txt"), "table");

  // The panel suggests Codebook from the name.
  const panel = await openAddFiles(page);
  await panel.getByTestId("add-files-input").setInputFiles(path.join(dir, "May26_codebook.xlsx"));
  await expect(panel.getByTestId("add-files-row").first().getByRole("combobox")).toHaveValue("codebook");
  // Upload as suggested. (Closing the dialog keeps its chosen files, so adding the file again from
  // a fresh addFiles call would list it twice.)
  await panel.getByRole("button", { name: /^Upload/ }).click();
  await expect.poll(async () => (await page.getByTestId("add-files-error").count()) > 0 || !(await panel.isVisible()), { timeout: 5 * 60_000 }).toBe(true);
  await expect(page.getByTestId("add-files-error")).toHaveCount(0);

  await selectSource(page, "May26_codebook.xlsx");
  await expect(page.getByTestId("file-purpose-text")).toContainText(/^Codebook\. /);
  // The card is in the selected source's tab panel, not its header.
  const card = page.getByRole("tabpanel", { name: "Questionnaire links", exact: true });
  await expect(card.getByText("Variables read")).toBeVisible({ timeout: 3 * 60_000 });
  const confirm = card.getByRole("button", { name: "Confirm same-code matches" });
  await expect(confirm).toBeEnabled({ timeout: 3 * 60_000 });
  await confirm.click();
  await expect(card.getByText(/Confirmed 3 same-code matches/)).toBeVisible({ timeout: 60_000 });
  if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-codebook.png") });

  const table = await ui.buildTable(run, { row: "party_reg" });
  await expect(table.table).toContainText("Democrat");
  await expect(table.table).toContainText("Republican");
  expect(await ui.readStatistic(table, { variable: "party_reg", rawCode: "1", statistic: "category_count" })).toBe(2);
});
