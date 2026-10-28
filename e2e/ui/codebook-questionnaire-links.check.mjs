// Links through the codebook (batch 49, Grant 27 October 2026: questionnaire 1A and codebook Q1 have the
// same wording, yet 1A was offered to Q1 at 63% for a second confirmation). Real browser on the
// disposable stack. A data file with Q1 and Q2; a codebook whose entries are confirmed by name; then a
// questionnaire whose question q1a has the codebook's wording for Q1 (Grant's text, with his double
// space) and a code that matches no variable.
//   1. The questionnaire's q1a arrives confirmed through the codebook ("Identical to codebook Q1"), and
//      the match says so. Its tab is "Questionnaire links"; the codebook's is "Codebook links".
//   2. The links column names the data file; a suggestion's buttons say what is being confirmed
//      ("Confirm: Q1 is Q1", "Not Q1").
//   3. A codebook entry with no column reads "No variable named ... in poll.txt".
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

const Q1A = "California will be holding a statewide primary election on June 2nd.  Are you planning or not planning to vote in this election, or have you already voted early or by mail?";
const CODEBOOK_Q1 = "California will be holding a statewide primary election on June 2nd. Are you planning or not planning to vote in this election, or have you already voted early or by mail?";

function fixtures() {
  const dir = mkdtempSync(path.join(tmpdir(), "cbq-"));
  writeFileSync(path.join(dir, "poll.txt"), "ID\tQ1\tQ2\n1\t1\t2\n2\t2\t1\n3\t3\t2\n4\t1\t1\n");
  const cb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(cb, XLSX.utils.aoa_to_sheet([
    ["VARIABLE NAME", "VARIABLE LABEL", "VALUES"],
    ["Q1", CODEBOOK_Q1, "1=Planning to vote, 2=Not planning to vote, 3=Already voted"],
    ["Q2", "Gender of respondent recorded by the interviewer", "1=Male, 2=Female"],
    ["w2", "LA City weights", "as is"],
  ]), "Codebook");
  writeFileSync(path.join(dir, "poll_codebook.xlsx"), XLSX.write(cb, { type: "buffer", bookType: "xlsx" }));
  const form = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(form, XLSX.utils.aoa_to_sheet([
    ["type", "name", "label"],
    ["select_one vote", "q1a", Q1A],
    ["select_one sex", "gender_q", "Gender of the person answering, as the interviewer saw it"],
  ]), "survey");
  XLSX.utils.book_append_sheet(form, XLSX.utils.aoa_to_sheet([
    ["list_name", "name", "label"],
    ["vote", "1", "Planning to vote"], ["vote", "2", "Not planning to vote"], ["vote", "3", "Already voted"],
    ["sex", "1", "Male"], ["sex", "2", "Female"],
  ]), "choices");
  writeFileSync(path.join(dir, "poll_questionnaire.xlsx"), XLSX.write(form, { type: "buffer", bookType: "xlsx" }));
  return dir;
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("a questionnaire question worded like a confirmed codebook entry is linked through it, and the rows say what they link", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const dir = fixtures();
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `cbq-${Date.now()}` });
  await ui.upload(run, path.join(dir, "poll.txt"), "table");

  // The codebook first, its entries confirmed by name.
  await addFiles(page, path.join(dir, "poll_codebook.xlsx"), "Codebook");
  await selectSource(page, "poll_codebook.xlsx");
  const cbCard = page.getByRole("tabpanel", { name: "Codebook links", exact: true });
  const confirm = cbCard.getByRole("button", { name: "Confirm same-code matches" });
  await expect(confirm).toBeEnabled({ timeout: 3 * 60_000 });
  // The rows are listed under Review matches (the card opens on its counts).
  await cbCard.getByRole("button", { name: "Review matches" }).click();
  // A suggestion's buttons say what is being confirmed.
  const q1Row = cbCard.locator('[data-item-code="Q1"]');
  await expect(q1Row.getByRole("button", { name: "Confirm: Q1 is Q1", exact: true })).toBeVisible();
  await expect(q1Row.getByRole("button", { name: "Not Q1", exact: true })).toBeVisible();
  await confirm.click();
  await expect(cbCard.getByText(/Confirmed \d+ same-code match/)).toBeVisible({ timeout: 60_000 });
  await expect(cbCard.getByTestId("links-variable-heading")).toHaveText("Variable in poll.txt");
  await cbCard.getByRole("button", { name: "No match", exact: true }).click();
  await expect(cbCard.locator('[data-item-code="w2"]').getByTestId("item-no-match")).toHaveText("No variable named w2 in poll.txt");
  if (SHOT) await cbCard.screenshot({ path: SHOT.replace(".png", "-codebook.png") });

  // Then the questionnaire: q1a arrives confirmed through the codebook.
  await addFiles(page, path.join(dir, "poll_questionnaire.xlsx"), "Questionnaire");
  await selectSource(page, "poll_questionnaire.xlsx");
  const qCard = page.getByRole("tabpanel", { name: "Questionnaire links", exact: true });
  await expect(qCard.getByText("Items read")).toBeVisible({ timeout: 3 * 60_000 });
  await expect(qCard).toContainText("1 confirmed through the codebook", { timeout: 60_000 });
  await qCard.getByRole("button", { name: "Review matches" }).click();
  await qCard.getByRole("button", { name: "Confirmed", exact: true }).click();
  const q1a = qCard.locator('[data-item-code="q1a"]');
  await expect(q1a.getByTestId("link-method")).toContainText("Identical to codebook Q1");
  await expect(q1a.getByTestId("link-method")).toContainText("Confirmed");
  await expect(q1a.getByTestId("link-basis-withdrawn")).toHaveCount(0);
  await expect(qCard.getByTestId("links-variable-heading")).toHaveText("Variable in poll.txt");
  if (SHOT) await qCard.screenshot({ path: SHOT.replace(".png", "-questionnaire.png") });

});
