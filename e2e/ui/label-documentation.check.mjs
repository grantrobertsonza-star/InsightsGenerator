// Labels and documentation (LBL-01, Grant, 26 October 2026), in a real browser on the disposable
// stack: a data file with a codebook and an XLSForm questionnaire that give party_reg different
// answer labels. Both documents confirm party_reg (before LBL-01 the second was refused as already
// confirmed); the data file's "Labels and documentation" tab shows each variable beside both
// documents, the codebook as the source of the labels, the disagreement, an undocumented variable
// and a codebook entry with no column; and a table uses the codebook's labels.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as XLSX from "xlsx";
import { addFiles } from "./helpers/addFiles.mjs";
import { selectSource, openSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;

function fixtures() {
  const dir = mkdtempSync(path.join(tmpdir(), "labeldoc-"));
  writeFileSync(path.join(dir, "poll.txt"), "ID\tparty_reg\tq_extra\n1\t1\t5\n2\t4\t3\n3\t1\t2\n4\t2\t5\n");
  const cb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(cb, XLSX.utils.aoa_to_sheet([
    ["VARIABLE NAME", "VARIABLE LABEL", "VALUES"],
    ["party_reg", "Party registration", "1=Democrat, 2=No Party Preference, 3=Other Party, 4=Republican"],
    ["ID", "Identification number assigned to respondent", "as is"],
    ["dropped_var", "A variable not in this release", "1=Yes, 2=No"],
  ]), "Codebook");
  writeFileSync(path.join(dir, "poll_codebook.xlsx"), XLSX.write(cb, { type: "buffer", bookType: "xlsx" }));
  const form = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(form, XLSX.utils.aoa_to_sheet([
    ["type", "name", "label"],
    ["select_one party", "party_reg", "With which party are you registered?"],
  ]), "survey");
  XLSX.utils.book_append_sheet(form, XLSX.utils.aoa_to_sheet([
    ["list_name", "name", "label"],
    ["party", "1", "Democratic"],
    ["party", "2", "Decline to state"],
    ["party", "3", "Other"],
    ["party", "4", "Republican"],
  ]), "choices");
  writeFileSync(path.join(dir, "poll_questionnaire.xlsx"), XLSX.write(form, { type: "buffer", bookType: "xlsx" }));
  return dir;
}

test.use({ viewport: { width: 1600, height: 1000 } });

async function confirmSameCode(page, filename) {
  await selectSource(page, filename);
  const card = page.getByRole("tabpanel", { name: "Questionnaire links", exact: true });
  const confirm = card.getByRole("button", { name: "Confirm same-code matches" });
  await expect(confirm).toBeEnabled({ timeout: 3 * 60_000 });
  await confirm.click();
  await expect(card.getByText(/Confirmed \d+ same-code match/)).toBeVisible({ timeout: 60_000 });
  // Nothing refused: the other document's confirmation does not hold this one back.
  await expect(card.getByText(/already confirmed for/)).toHaveCount(0);
}

test("a data file's codebook and questionnaire are documented side by side, the codebook's labels used", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const dir = fixtures();
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `labeldoc-${Date.now()}` });
  await ui.upload(run, path.join(dir, "poll.txt"), "table");
  // The questionnaire first, so upload order alone would favour it.
  await addFiles(page, path.join(dir, "poll_questionnaire.xlsx"), "Questionnaire");
  await addFiles(page, path.join(dir, "poll_codebook.xlsx"), "Codebook");
  await confirmSameCode(page, "poll_questionnaire.xlsx");
  await confirmSameCode(page, "poll_codebook.xlsx");

  const tab = await openSource(page, "poll.txt", "Labels and documentation");
  const panel = tab.getByTestId("label-documentation");
  await expect(panel.getByTestId("ld-table")).toBeVisible({ timeout: 3 * 60_000 });
  await expect(panel.getByTestId("ld-documents")).toContainText("Codebook: poll_codebook.xlsx");
  await expect(panel.getByTestId("ld-documents")).toContainText("Questionnaire: poll_questionnaire.xlsx");
  const party = panel.locator('tr[data-variable="party_reg"]');
  await expect(party).toContainText("Party registration");
  await expect(party).toContainText("With which party are you registered?");
  await expect(party).toContainText("Answers: Codebook");
  await expect(party).toContainText("disagree");
  await expect(panel.getByTestId("ld-conflicts")).toContainText("used from poll_codebook.xlsx");
  await expect(panel.getByTestId("ld-conflicts")).toContainText("2 = Decline to state");
  await expect(panel.getByTestId("ld-undocumented")).toContainText("1");
  await expect(panel.locator('tr[data-variable="q_extra"]')).toContainText("Name only");
  await panel.getByTestId("ld-unmatched").locator("summary").click();
  await expect(panel.getByTestId("ld-unmatched")).toContainText("dropped_var");
  await panel.getByLabel("Show").selectOption("undocumented");
  await expect(panel.locator("tbody tr")).toHaveCount(1);
  if (SHOT) await panel.screenshot({ path: SHOT });

  const table = await ui.buildTable(run, { row: "party_reg" });
  await expect(table.table).toContainText("No Party Preference");
  await expect(table.table).not.toContainText("Decline to state");
});
