// Which data file a codebook belongs to (Grant, 27 October 2026), in a real browser on the disposable
// stack: two waves of the same poll (same variables) are uploaded, then a codebook. Before: the codebook
// was matched to the first data file and listed as "Linked to" it before any match. Now:
//   1. the waves fit equally, so nothing is matched and nothing reads as linked; the card says why and
//      asks for the data file;
//   2. matched to one wave, then the other: the codebook lists both, and each wave's tab shows it.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as XLSX from "xlsx";
import { openAddFiles } from "./helpers/addFiles.mjs";
import { openSourceTab, selectSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;

function fixtures() {
  const dir = mkdtempSync(path.join(tmpdir(), "codebook-waves-"));
  writeFileSync(path.join(dir, "may2026.txt"), "ID\tparty_reg\tw1\n1\t1\t0.9\n2\t4\t1.1\n3\t1\t1.0\n4\t2\t1.0\n");
  writeFileSync(path.join(dir, "jun2026.txt"), "ID\tparty_reg\tw1\n1\t2\t1.0\n2\t1\t0.8\n3\t4\t1.2\n4\t1\t1.0\n");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["VARIABLE LABEL", "VARIABLE NAME", "VALUES"],
    ["party_reg", "Party registration", "1=Democrat, 2=No Party Preference, 3=Other Party, 4=Republican"],
    ["ID", "Identification number assigned to respondent", "as is"],
    ["w1", "Statewide weights", "as is"],
  ]), "Codebook");
  writeFileSync(path.join(dir, "Poll_codebook.xlsx"), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  return dir;
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("a codebook shared by two waves is not matched to either by default, and can be linked to both", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const dir = fixtures();
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `codebook-waves-${Date.now()}` });
  await ui.upload(run, path.join(dir, "may2026.txt"), "table");
  await ui.upload(run, path.join(dir, "jun2026.txt"), "table");

  const panel = await openAddFiles(page);
  await panel.getByTestId("add-files-input").setInputFiles(path.join(dir, "Poll_codebook.xlsx"));
  await expect(panel.getByTestId("add-files-row").first().getByRole("combobox")).toHaveValue("codebook");
  await panel.getByRole("button", { name: /^Upload/ }).click();
  await expect.poll(async () => (await page.getByTestId("add-files-error").count()) > 0 || !(await panel.isVisible()), { timeout: 5 * 60_000 }).toBe(true);
  await expect(page.getByTestId("add-files-error")).toHaveCount(0);

  // 1. Read, then not matched: both waves fit, so the card asks, and the list claims no link.
  await selectSource(page, "Poll_codebook.xlsx");
  const card = page.getByRole("tabpanel", { name: "Codebook links", exact: true });
  await expect(card.getByText("Variables read")).toBeVisible({ timeout: 3 * 60_000 });
  await expect(card).toContainText("More than one data file could be this one's", { timeout: 60_000 });
  await expect(card).toContainText("may2026.txt: 3 questions match");
  await expect(card).toContainText("jun2026.txt: 3 questions match");
  const picker = card.getByLabel("Data file");
  await expect(picker).toHaveValue("");
  await expect(page.getByText(/Linked to (may|jun)2026\.txt/)).toHaveCount(0);
  if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-choose.png") });

  // 2. Matched to each wave in turn: linked to both.
  for (const name of ["may2026.txt", "jun2026.txt"]) {
    await picker.selectOption({ label: name });
    await card.getByRole("button", { name: /^Match/ }).click();
    // Wait for THIS file's link to be saved (its option is marked linked), not for the message, which the
    // previous match already shows: reloading before the second match finished left only the first link.
    await expect(picker.locator("option", { hasText: `${name} (linked)` })).toHaveCount(1, { timeout: 60_000 });
    await expect(card).toContainText("links suggested", { timeout: 60_000 });
  }
  await page.reload({ waitUntil: "networkidle" });
  await selectSource(page, "Poll_codebook.xlsx");
  await expect(page.getByText("Linked to may2026.txt and jun2026.txt").first()).toBeVisible({ timeout: 60_000 });
  if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-both.png") });
  for (const name of ["may2026.txt", "jun2026.txt"]) {
    // Each data file names its questionnaire on its Labels and documentation tab (as import-file-detail reads it).
    await selectSource(page, name);
    const links = await openSourceTab(page, "Labels and documentation");
    await expect(links.getByTestId("attached-instrument").filter({ hasText: "Poll_codebook.xlsx" })).toHaveCount(1);
  }
});
