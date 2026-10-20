// Check that the flipped-workbook guard reaches the researcher (IMP-009 / Task B exclusion).
//
// The engine refuses a workbook laid out with one column per respondent whose separate Codebook
// sheet declares weights or multiple-response sets (that combination is excluded from the initial
// release pending verification). Engine tests prove the refusal; this checks, in a real browser
// against the disposable local stack, that:
//   1. after choosing "one column per respondent", the refusal, with its re-export guidance, is
//      shown once for the file in its Variables panel (not repeated per variable, and not framed
//      as an SPSS/Stata/SAS read failure);
//   2. the refusal survives a reload;
//   3. recovery works: the same data re-exported one row per respondent, uploaded as a new file,
//      reads normally (default layout, no refusal for it). After the refused file is deleted, the
//      recovered file's Codebook multiple-response definition is applied (Opt_A and Opt_B show as
//      Multiple response) and a table computes from it (Gender counts 2 and 2).
// Not covered: whether Cross tabs or Drivers produce output for the refused file (engine tests in
// columnsAsCases.test.ts cover dictionary, categories, crosstab and driver refusal).
// Synthetic data only. No model calls.
import { expect, test } from "@playwright/test";
import { addFiles } from "./helpers/addFiles.mjs";
import { deleteSource, openSource } from "./helpers/sources.mjs";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const appUrl = new URL(target.appUrl);
const REFUSAL = /Unsupported flipped workbook/;

function workbooks(dir) {
  const script = String.raw`
import sys
from openpyxl import Workbook
out = sys.argv[1]
codebook = [["Variable","Variable label","Value labels","Multiple response set"],
            ["Gender","Gender","1=Male; 2=Female",None],
            ["Opt_A","Option A","0=No; 1=Yes","Options"],
            ["Opt_B","Option B","0=No; 1=Yes","Options"]]
data = {"ID":["001","002","003","004"],"Gender":[1,2,1,2],"Opt_A":[1,0,1,1],"Opt_B":[0,1,1,0]}
def save(name, rows):
    wb = Workbook(); ws = wb.active; ws.title = "Data"
    for r in rows: ws.append(r)
    cb = wb.create_sheet("Codebook")
    for r in codebook: cb.append(r)
    wb.save(out + "/" + name)
save("flipped-guard.xlsx", [["Variable","R1","R2","R3","R4"]] + [[k] + v for k, v in data.items()])
save("rows-recovered.xlsx", [list(data)] + [list(t) for t in zip(*data.values())])
`;
  execFileSync("python3", ["-I", "-c", script, dir]);
  return { flipped: path.join(dir, "flipped-guard.xlsx"), recovered: path.join(dir, "rows-recovered.xlsx") };
}

async function openSection(page, name) {
  const button = page.getByRole("button", { name }).first();
  await button.click();
}

async function upload(page, file) {
  await openSection(page, /Import data/);
  await addFiles(page, file, "Raw data");
}

test("a flipped workbook with Codebook MR is refused visibly; a rows-per-respondent re-export recovers", async ({ page }) => {
  const files = workbooks(mkdtempSync(path.join(tmpdir(), "flipped-guard-")));
  await page.goto(appUrl.href, { waitUntil: "networkidle" });
  await page.locator('a[href="/?entry=generate"]').click();
  await page.getByLabel("Project name").fill(`Flipped guard check ${Date.now()}`);
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}/);
  const runUrl = page.url();

  await upload(page, files.flipped);
  const layout = () => page.getByLabel(/How the file is laid out: flipped-guard\.xlsx/);
  await openSource(page, "flipped-guard.xlsx", "Setup");
  await expect(layout()).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByTestId("source-acceptance")).toHaveText("Setup: Accepted", { timeout: 60_000 });
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"]);
  await layout().selectOption("columns_are_cases");
  expect((await saved).status()).toBe(200);

  const notice = () => page.getByRole("alert").filter({ hasText: REFUSAL });
  // The selected data file's Variables tab (the refused file is listed first, as the newest, until
  // the recovered file is added; then the check names the file it means).
  const showVariables = async (name = "flipped-guard.xlsx") => {
    await openSource(page, name, "Variables");
  };

  // 1. The file's Variables panel shows the refusal once, with its recovery guidance.
  await showVariables();
  await expect(notice().first()).toBeVisible({ timeout: 90_000 });
  await expect(notice()).toHaveCount(1);
  await expect(notice().first()).toContainText("Re-export as one row per respondent");
  await expect(notice().first()).not.toContainText("SPSS/Stata/SAS");

  // 2. It survives a reload.
  await page.goto(runUrl, { waitUntil: "networkidle" });
  await openSection(page, /Import data/);
  await showVariables();
  await expect(notice().first()).toBeVisible({ timeout: 90_000 });
  await expect(notice()).toHaveCount(1);

  // 3. Recovery: the rows-per-respondent re-export reads normally.
  await upload(page, files.recovered);
  const recoveredLayout = page.getByLabel(/How the file is laid out: rows-recovered\.xlsx/);
  await openSource(page, "rows-recovered.xlsx", "Setup");
  await expect(recoveredLayout).toBeEnabled({ timeout: 60_000 });
  await expect(recoveredLayout).toHaveValue("rows_are_cases");
  await showVariables();
  await expect(notice().first()).toBeVisible({ timeout: 90_000 });
  await expect(notice()).toHaveCount(1);

  // Delete the refused file; the recovered one carries the analysis.
  page.on("dialog", (d) => d.accept());
  await deleteSource(page, "flipped-guard.xlsx");
  await expect(page.getByText("flipped-guard.xlsx", { exact: true })).toHaveCount(0, { timeout: 60_000 });
  await page.goto(runUrl, { waitUntil: "networkidle" });
  await openSection(page, /Import data/);
  await showVariables("rows-recovered.xlsx");
  await expect(notice()).toHaveCount(0);
  for (const v of ["Opt_A", "Opt_B"]) await expect(page.getByLabel(`Question type: ${v}`, { exact: true })).toHaveValue("multi", { timeout: 60_000 });

  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo: test.info() });
  const run = { id: /\/runs\/([0-9a-f-]{36})/.exec(runUrl)[1], url: runUrl };
  const gender = await ui.buildTable(run, { row: "Gender" });
  expect(await ui.readStatistic(gender, { variable: "Gender", rawCode: "1", statistic: "category_count" })).toBe(2);
  expect(await ui.readStatistic(gender, { variable: "Gender", rawCode: "2", statistic: "category_count" })).toBe(2);
});
