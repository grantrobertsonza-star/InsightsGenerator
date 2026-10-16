// Saved-table content after a reload (IMP-004 scale summaries, IMP-015 conflicting labels).
//
// Earlier evidence counted saved tables after reload but did not read what they say. This check
// builds tables in the Crosstab workspace, reloads the page, reopens each saved table by its own
// identity (data-testid="crosstab-result-table" and data-question-keys, never by position) and
// reads it again through the same adapter reader:
//   1. Golden fixture: Satisfaction mean and top-two box (codes 4 and 5) and Purchase "Yes" share
//      match the fixture's independent references (fixtures/golden-thread-1/expected.json) before
//      and after reload, and do not change across the reload.
//   2. A workbook whose two label sheets give code 1 and 2 opposite meanings: the table's Excel
//      download carries both conflicting labels, and the saved table still shows both conflicting
//      labels and the same per-code counts after reload.
// Synthetic data only. No model calls.
import { expect, test } from "@playwright/test";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import JSZip from "jszip";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const GOLDEN = path.resolve("fixtures/golden-thread-1/golden-survey-documented.xlsx");
const REFERENCES = JSON.parse(readFileSync(path.resolve("fixtures/golden-thread-1/expected.json"), "utf8"));
const reference = (id) => {
  const list = Object.values(REFERENCES).find(Array.isArray);
  const found = list.find((a) => a.id === id);
  if (!found) throw new Error(`no reference ${id} in the golden expected.json`);
  return found;
};

async function adapter(page, testInfo) {
  const mod = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  return mod.bind({ page, target, testInfo });
}

// After a reload: open the Crosstab workspace and return the saved result table for `row`.
async function reopenSaved(page, run, row) {
  await page.goto(run.url, { waitUntil: "networkidle" });
  const dialog = page.getByRole("dialog", { name: "Crosstab workspace" });
  await page.getByRole("button", { name: /^Analytics/ }).first().click();
  await page.getByRole("button", { name: /^Crosstabs/ }).click();
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  // Every saved table for this question (the same question can be saved more than once; each
  // copy is read the same way).
  const matching = dialog.locator(`table[data-testid="crosstab-result-table"][data-question-keys*='"${row}"']`);
  // Saved tables are listed collapsed ("▸ <question>, … draft"): expand them as they render.
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

function conflictWorkbook(dir) {
  const script = String.raw`
import sys
from openpyxl import Workbook
wb = Workbook(); ws = wb.active; ws.title = "Data"
for r in [["id","q"],["001",1],["002",1],["003",1],["004",2]]: ws.append(r)
for name, labels in [("Labels A", ["Yes","No"]), ("Labels B", ["No","Yes"])]:
    s = wb.create_sheet(name)
    for r in [["variable","value","value label"],["q",1,labels[0]],["q",2,labels[1]]]: s.append(r)
wb.save(sys.argv[1])
`;
  const file = path.join(dir, "conflicting-labels.xlsx");
  execFileSync("python3", ["-I", "-c", script, file]);
  return file;
}

test("golden scale and share figures read the same from saved tables after reload, and match the references", async ({ page }, testInfo) => {
  const ui = await adapter(page, testInfo);
  const run = await ui.createRun({ name: `saved-reload-${Date.now()}` });
  await ui.upload(run, GOLDEN, "table");

  const reads = [
    { row: "Satisfaction", ref: "satisfaction-None", spec: { variable: "Satisfaction", statistic: "mean" } },
    { row: "Satisfaction", ref: "satisfaction-top-two", spec: { variable: "Satisfaction", statistic: "favourable_percent", rawCodes: ["4", "5"] } },
    { row: "Purchase", ref: "purchase-None", spec: { variable: "Purchase", statistic: "selection_percentage", rawCode: "Yes" } },
  ];
  const before = [];
  for (const r of reads) {
    const table = await ui.buildTable(run, { row: r.row });
    before.push(await ui.readStatistic(table, r.spec));
  }
  for (const [i, r] of reads.entries()) {
    const ref = reference(r.ref);
    expect(Math.abs(before[i] - ref.expectedValue), `${r.ref} before reload: app ${before[i]} vs reference ${ref.expectedValue}`).toBeLessThanOrEqual(ref.tolerance.value);
    const saved = await reopenSaved(page, run, r.row);
    const after = await ui.readStatistic(saved, r.spec);
    expect(after, `${r.ref} after reload`).toBe(before[i]);
  }
});

test("a saved table with conflicting value labels keeps both labels and its counts after reload", async ({ page }, testInfo) => {
  const ui = await adapter(page, testInfo);
  const run = await ui.createRun({ name: `saved-conflict-${Date.now()}` });
  await ui.upload(run, conflictWorkbook(mkdtempSync(path.join(tmpdir(), "conflict-"))), "table");
  const built = await ui.buildTable(run, { row: "q" });
  await expect(built.table).toContainText('conflicting labels: "Yes" / "No"');
  await expect(built.table).toContainText('conflicting labels: "No" / "Yes"');
  const counts = async (t) => [
    await ui.readStatistic(t, { variable: "q", rawCode: "1", statistic: "category_count" }),
    await ui.readStatistic(t, { variable: "q", rawCode: "2", statistic: "category_count" }),
  ];
  const before = await counts(built);
  expect(before).toEqual([3, 1]);
  // The table's Excel download keeps the conflict visible (IMP-015 export, current tree).
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120_000 }),
    built.dialog.getByRole("link", { name: "Download Excel", exact: true }).first().click(),
  ]);
  const zip = await JSZip.loadAsync(readFileSync(await download.path()));
  const xml = (await Promise.all(Object.values(zip.files).filter((f) => !f.dir && f.name.endsWith(".xml")).map((f) => f.async("string")))).join(" ");
  expect(xml).toContain("conflicting labels: &quot;Yes&quot; / &quot;No&quot;");
  expect(xml).toContain("conflicting labels: &quot;No&quot; / &quot;Yes&quot;");
  const saved = await reopenSaved(page, run, "q");
  await expect(saved.table).toContainText('conflicting labels: "Yes" / "No"');
  await expect(saved.table).toContainText('conflicting labels: "No" / "Yes"');
  expect(await counts(saved)).toEqual(before);
});
