// Grid (battery) questions (batch 53; Grant, 28 October 2026, May 2026 IGS Poll). Real browser on the
// disposable stack. The data file has no labels; the codebook's entries Q5_1 to Q5_3 are the grid's stem, a
// note, a dash and the row, and are confirmed by name (automatically since CB1: their answer lists cover the data); the questionnaire's question q5a is the stem with a
// code that names no column, and its rows are listed in a randomised order in the form.
//   1. q5a's suggestions are the three columns, each "Grid row", in the data file's column order.
//   2. "Confirm all 3 for q5a" confirms them in one action, and says so; the summary column is not offered.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as XLSX from "xlsx";
import { addFiles } from "./helpers/addFiles.mjs";
import { selectSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;

const STEM = "Regardless of whom you supported for Governor, is your opinion of each of the top candidates generally favorable or unfavorable, or do you not know enough about them to say?";
const ROWS = ["Tony Thurmond, California State Superintendent of Public Instruction", "Antonio Villaraigosa, Housing Affordability Advocate", "Xavier Becerra, Former U.S. Secretary"];

function fixtures() {
  const dir = mkdtempSync(path.join(tmpdir(), "grid-"));
  writeFileSync(path.join(dir, "poll.txt"), "ID\tQ5_1\tQ5_2\tQ5_3\tQ5_1_summary\n1\t1\t2\t3\t1\n2\t2\t1\t1\t2\n3\t3\t2\t2\t3\n4\t1\t1\t2\t1\n");
  const cb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(cb, XLSX.utils.aoa_to_sheet([
    ["VARIABLE NAME", "VARIABLE LABEL", "VALUES"],
    ...ROWS.map((row, i) => [`Q5_${i + 1}`, `Q5_${i + 1} ${STEM} (already voted) – ${row}`, "1=Favorable, 2=Unfavorable, 3=Don't know/no opinion"]),
    ["Q5_1_summary", "Q5_1 (summary) Combines Q5_1 and Q5b_1", "1=Favorable, 2=Unfavorable, 3=No opinion"],
  ]), "Codebook");
  writeFileSync(path.join(dir, "poll_codebook.xlsx"), XLSX.write(cb, { type: "buffer", bookType: "xlsx" }));
  const form = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(form, XLSX.utils.aoa_to_sheet([
    ["type", "name", "label"],
    ["select_one fav", "q5a", STEM],
  ]), "survey");
  XLSX.utils.book_append_sheet(form, XLSX.utils.aoa_to_sheet([
    ["list_name", "name", "label"],
    ["fav", "1", "Favorable"], ["fav", "2", "Unfavorable"], ["fav", "3", "Don't know"],
  ]), "choices");
  writeFileSync(path.join(dir, "poll_questionnaire.xlsx"), XLSX.write(form, { type: "buffer", bookType: "xlsx" }));
  return dir;
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("a grid question's rows are suggested from the codebook's stem and confirmed with one action", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const dir = fixtures();
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `grid-${Date.now()}` });
  await ui.upload(run, path.join(dir, "poll.txt"), "table");

  await addFiles(page, path.join(dir, "poll_codebook.xlsx"), "Codebook");
  await selectSource(page, "poll_codebook.xlsx");
  const cbCard = page.getByRole("tabpanel", { name: "Codebook links", exact: true });
  // CB1: every entry's answer list covers the codes in the data, so all four are confirmed without a click and
  // nothing is left for Confirm same-code matches.
  await expect(cbCard).toContainText("4 confirmed automatically", { timeout: 3 * 60_000 });
  await expect(cbCard.getByRole("button", { name: "Confirm same-code matches" })).toHaveCount(0);

  await addFiles(page, path.join(dir, "poll_questionnaire.xlsx"), "Questionnaire");
  await selectSource(page, "poll_questionnaire.xlsx");
  const qCard = page.getByRole("tabpanel", { name: "Questionnaire links", exact: true });
  await expect(qCard.getByText("Items read")).toBeVisible({ timeout: 3 * 60_000 });
  await qCard.getByRole("button", { name: "Review matches" }).click();
  const row = qCard.locator('[data-testid="item-links"][data-item-code="q5a"]');
  await expect(row.getByTestId("link-method")).toHaveCount(3, { timeout: 60_000 });
  await expect(row.getByTestId("link-method").first()).toContainText("Grid row, 92%");
  await expect(row.getByTestId("link-variable").locator("span").first()).toHaveText("Q5_1");
  const names = await row.getByTestId("link-variable").evaluateAll((els) => els.map((e) => e.querySelector("span")?.textContent));
  expect(names).toEqual(["Q5_1", "Q5_2", "Q5_3"]);
  await expect(qCard.getByText("Q5_1_summary")).toHaveCount(0);
  if (SHOT) await qCard.screenshot({ path: SHOT });

  await row.getByTestId("item-confirm-all").click();
  await expect(qCard.getByText("Confirmed 3 links for q5a.")).toBeVisible({ timeout: 60_000 });
  await qCard.getByRole("button", { name: "Confirmed", exact: true }).click();
  await expect(row.getByTestId("link-method")).toHaveCount(3);
  for (const m of await row.getByTestId("link-method").allInnerTexts()) expect(m).toContain("Confirmed");
  await expect(row.getByTestId("item-confirm-all")).toHaveCount(0);
});
