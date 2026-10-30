// Which data files a codebook belongs to, in a real browser on the disposable stack. Grant, 27 October 2026: never
// "Linked to" a file before any match. Grant, 29 October 2026 (CB1): "a link of codebook is manual for each wave,
// i think it should be automatic". Two waves of the same poll (same variables) are uploaded, then a codebook:
//   1. it is matched to both waves without a click, each wave's outcome on the card; party_reg, whose listed
//      answers cover every code in the data, is confirmed automatically; ID and the weight stay suggestions;
//   2. a third wave uploaded later is matched to the codebook by itself, and every wave's tab shows the codebook;
//   3. the review lists one data file's links at a time (Grant, 29 October 2026: ID was listed three times, once per
//      wave, under one file's heading), says the other files have links too, and its panel is the taller one.
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
  writeFileSync(path.join(dir, "aug2026.txt"), "ID\tparty_reg\tw1\n1\t3\t1.1\n2\t1\t0.9\n3\t2\t1.0\n");
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

test("a codebook shared by waves is matched to every wave, and to a wave added later, without a click", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
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

  // 1. Read, then matched to both waves; party_reg confirmed by the codes rule.
  await selectSource(page, "Poll_codebook.xlsx");
  const card = page.getByRole("tabpanel", { name: "Codebook links", exact: true });
  await expect(card.getByText("Variables read")).toBeVisible({ timeout: 3 * 60_000 });
  await expect(card).toContainText("confirmed automatically", { timeout: 2 * 60_000 });
  await expect(card).toContainText("may2026.txt: 1 confirmed, 2 suggested");
  await expect(card).toContainText("jun2026.txt: 1 confirmed, 2 suggested");
  if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-both.png") });
  await page.reload({ waitUntil: "networkidle" });
  await selectSource(page, "Poll_codebook.xlsx");
  await expect(page.getByText("Linked to may2026.txt and jun2026.txt").first()).toBeVisible({ timeout: 60_000 });

  // 2. A wave added later is matched by itself: the Import screen's background reader matches it as soon as the new
  //    file is listed (its note may come and go before this check looks), so the check waits for the result, reloading
  //    until the codebook names all three files.
  await ui.upload(run, path.join(dir, "aug2026.txt"), "table");
  await expect
    .poll(
      async () => {
        // run.url opens the project's overview; the sources are under Import data. A load that is not ready yet
        // counts as "not yet" and is tried again.
        try {
          await page.goto(run.url, { waitUntil: "networkidle" });
          await page.getByRole("button", { name: /^Import data/ }).first().click();
          await selectSource(page, "Poll_codebook.xlsx");
          return await page.getByText(/Linked to may2026\.txt, jun2026\.txt and aug2026\.txt/).count();
        } catch {
          return 0;
        }
      },
      { timeout: 3 * 60_000, intervals: [5_000, 10_000, 15_000] },
    )
    .toBeGreaterThan(0);
  if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-later-wave.png") });
  for (const name of ["may2026.txt", "jun2026.txt", "aug2026.txt"]) {
    // Each data file names its codebook on its Labels and documentation tab (as import-file-detail reads it).
    await selectSource(page, name);
    const links = await openSourceTab(page, "Labels and documentation");
    await expect(links.getByTestId("attached-instrument").filter({ hasText: "Poll_codebook.xlsx" })).toHaveCount(1);
  }

  // 3. One wave's links at a time.
  await selectSource(page, "Poll_codebook.xlsx");
  const review = page.getByRole("tabpanel", { name: "Codebook links", exact: true });
  await review.getByLabel("Data file").selectOption({ label: "jun2026.txt (linked)" });
  await review.getByRole("button", { name: "Review matches" }).click();
  await review.getByRole("button", { name: "All", exact: true }).click();
  await expect(review.getByTestId("links-variable-heading")).toContainText("jun2026.txt");
  const idLinks = review.locator('[data-testid="item-links"][data-item-code="ID"]');
  await expect(idLinks.getByTestId("link-row")).toHaveCount(1);
  await expect(review.getByTestId("links-other-files")).toContainText("2 other data files");
  if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-one-wave.png") });
  await review.getByLabel("Data file").selectOption({ label: "aug2026.txt (linked)" });
  await expect(review.getByTestId("links-variable-heading")).toContainText("aug2026.txt");
  await expect(idLinks.getByTestId("link-row")).toHaveCount(1);
});
