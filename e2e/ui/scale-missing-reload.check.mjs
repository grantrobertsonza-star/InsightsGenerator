// IMP-004 remainder: declared zero categories and the missing-value audit survive a reload in saved
// tables, for labelled, unlabelled and sparse scales, with the numbered-scale mean from the owner
// decision of 2026-10-17. One synthetic SPSS file (pyreadstat), 45 cases:
//   lab  worded 1-5 scale; answers 1,2,3,4 x 10 each; 5 "Very good" declared but never chosen;
//        9 "Don't know" x 5, declared user-missing
//        -> base 40 (missing excluded), mean (10+20+30+40)/40 = 2.5, top two (4,5) = 10/40 = 25%,
//           code 5 shown with a count of 0
//   unl  the same answers with no value labels, 9 declared user-missing -> base 40
//   rec  sparse 0-10 scale with bare numeric labels; answers 3 x 18, 7 x 18, 9 x 9
//        -> mean 261/45 = 5.8; unchosen declared points (code 0) shown with a count of 0
// Each table is built in the Crosstab workspace, then reopened from the saved tables after a page
// reload and read again; the import's data audit must still report both user-missing declarations
// after the reload. Real browser, engine and database on the disposable stack. No model calls.
import { expect, test } from "@playwright/test";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

function fixture() {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "scale-missing-")), "scales.sav");
  const script = String.raw`
import sys, pandas as pd, pyreadstat
lab = [1.0]*10 + [2.0]*10 + [3.0]*10 + [4.0]*10 + [9.0]*5
rec = [3.0]*18 + [7.0]*18 + [9.0]*9
df = pd.DataFrame({"id": [float(i) for i in range(45)], "lab": lab, "unl": list(lab), "rec": rec})
labels = {"lab": {1.0: "Very poor", 2.0: "Poor", 3.0: "Fair", 4.0: "Good", 5.0: "Very good", 9.0: "Don't know"},
          "rec": {float(k): str(k) for k in range(11)}}
pyreadstat.write_sav(df, sys.argv[1], variable_value_labels=labels, missing_ranges={"lab": [9.0], "unl": [9.0]})
`;
  execFileSync("python3", ["-I", "-c", script, file]);
  return file;
}

async function reopenSaved(page, run, row) {
  await page.goto(run.url, { waitUntil: "networkidle" });
  const dialog = page.getByRole("dialog", { name: "Crosstab workspace" });
  await page.getByRole("button", { name: /^Cross tabs/ }).first().click();
  await page.getByRole("button", { name: /^Crosstabs/ }).click();
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  const matching = dialog.locator(`table[data-testid="crosstab-result-table"][data-question-keys*='"${row}"']`);
  await expect
    .poll(
      async () => {
        const collapsed = dialog.getByRole("button", { name: /^▸ / });
        for (let i = (await collapsed.count()) - 1; i >= 0; i--) await collapsed.nth(i).click().catch(() => {});
        return matching.count();
      },
      { timeout: 60_000, message: `no saved table for ${row} after reload` },
    )
    .toBeGreaterThan(0);
  await expect(matching.first()).toBeVisible();
  return { run, rowVariable: row, columnVariable: null, dialog, table: matching.first() };
}

test("zero categories, missing-value exclusions and scale means read the same from saved tables after reload", async ({ page }, testInfo) => {
  test.setTimeout(20 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `scale-missing-${Date.now()}` });
  await ui.upload(run, fixture(), "table");

  const reads = {
    lab: [
      ["mean", { variable: "lab", statistic: "mean" }, 2.5],
      ["top two", { variable: "lab", statistic: "favourable_percent", rawCodes: ["4", "5"] }, 25],
      ["declared zero (5)", { variable: "lab", rawCode: "5", statistic: "category_count" }, 0],
      ["code 1 count", { variable: "lab", rawCode: "1", statistic: "category_count" }, 10],
    ],
    unl: [["code 4 count", { variable: "unl", rawCode: "4", statistic: "category_count" }, 10]],
    rec: [
      ["mean", { variable: "rec", statistic: "mean" }, 5.8],
      ["declared zero (0)", { variable: "rec", rawCode: "0", statistic: "category_count" }, 0],
      ["code 9 count", { variable: "rec", rawCode: "9", statistic: "category_count" }, 9],
    ],
  };
  // The base row reads "Base: answered this question" then its count (a hide control comes first).
  const base = async (t) => Number((await t.table.locator("tr", { hasText: "Base: answered this question" }).first().innerText()).match(/(\d+)\s*$/)?.[1]);
  for (const [row, checks] of Object.entries(reads)) {
    const built = await ui.buildTable(run, { row });
    const saved = async (t) => {
      for (const [name, spec, want] of checks) expect(await ui.readStatistic(t, spec), `${row} ${name}`).toBeCloseTo(want, 1);
      if (row !== "rec") expect(await base(t), `${row} base excludes the 5 user-missing answers`).toBe(40);
    };
    await saved(built);
    await saved(await reopenSaved(page, run, row));
  }

  // The import's data audit still reports both user-missing declarations after a reload.
  await page.goto(run.url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Import data/ }).first().click();
  // The audit sits inside the import's collapsed "Data quality" section.
  await page.getByText("Data quality", { exact: true }).first().click();
  await page.getByText("Weights and missing codes", { exact: true }).first().click();
  await expect(page.getByText(/2 variable\(s\) declare user-missing values/).first()).toBeVisible({ timeout: 60_000 });
});
