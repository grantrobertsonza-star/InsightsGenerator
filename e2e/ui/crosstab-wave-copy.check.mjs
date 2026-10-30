// "Copy here" in Cross tabs (Grant, 29 October 2026: "i tried to copy a table from one wave to the next and it didnt
// seem to work"), in a real browser on the disposable stack. Two waves of one tracker, labelled under Import data:
//   1. copying from a wave with no tables says so;
//   2. a table added on wave 1 is copied to wave 2: the note names it, and All tables lists it as a draft;
//   3. a second click copies nothing more, and says the table is already there;
//   4. Edit in Build table loads the copy's choices; a column added and Update table replaces the draft, still one
//      table (Grant: "just change what i wanted for that wave");
//   5. Export all downloads the listed tables in one workbook (Grant: "export all tables not just one at a time").
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as XLSX from "xlsx";
import { openSource } from "./helpers/sources.mjs";
import { openCrosstabs } from "./helpers/crosstabs.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;

test.use({ viewport: { width: 1600, height: 1000 } });

test("Copy here rebuilds a wave's table on another wave, once, and says so", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "wave-copy-"));
  const rows = (seed) => Array.from({ length: 40 }, (_, i) => `${i + 1},${((i + seed) % 3) + 1},${((i * 7 + seed) % 11)}`).join("\n");
  const files = [
    { name: "brand-w1.csv", wave: "Wave 1", month: "2026-03" },
    { name: "brand-w2.csv", wave: "Wave 2", month: "2026-06" },
  ];
  for (const [i, f] of files.entries()) writeFileSync(path.join(dir, f.name), `ID,Region,NPS\n${rows(i)}\n`);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `wave-copy-${Date.now()}` });
  for (const f of files) await ui.upload(run, path.join(dir, f.name), "table");
  await page.goto(run.url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Import data/ }).first().click();
  for (const f of files) {
    const setup = await openSource(page, f.name, "Setup");
    const wave = setup.getByLabel(`Wave: ${f.name}`);
    await wave.fill(f.wave);
    await wave.blur();
    const month = setup.getByLabel(`Fieldwork month: ${f.name}`);
    await expect(month).toBeVisible({ timeout: 30_000 });
    await month.fill(f.month);
    await page.waitForLoadState("networkidle");
  }
  await page.reload({ waitUntil: "networkidle" });

  // 1. Wave 1 has no tables yet.
  let ws = await openCrosstabs(page, "brand-w2.csv");
  const copyFrom = ws.getByTestId("crosstab-copy-from");
  await copyFrom.selectOption({ label: "Wave 1: brand-w1.csv" });
  await ws.getByRole("button", { name: "Copy here" }).click();
  await expect(ws.getByText("Wave 1 (brand-w1.csv) has no saved tables to copy.")).toBeVisible({ timeout: 60_000 });

  // 2. A table on wave 1, copied to wave 2.
  ws = await openCrosstabs(page, "brand-w1.csv");
  await ws.getByPlaceholder("Search name or label").fill("Region");
  await ws.locator('div.grid:has(> span[title="Region"])').first().getByRole("button", { name: "Row", exact: true }).click();
  await ws.getByRole("button", { name: /Add table to set/ }).click();
  await expect(ws.locator('table[data-testid="crosstab-result-table"]').last()).toBeVisible({ timeout: 60_000 });
  ws = await openCrosstabs(page, "brand-w2.csv");
  await ws.getByTestId("crosstab-copy-from").selectOption({ label: "Wave 1: brand-w1.csv" });
  await ws.getByRole("button", { name: "Copy here" }).click();
  await expect(ws.getByText("Copied 1 table from Wave 1 (brand-w1.csv) as a draft, listed under All tables.")).toBeVisible({ timeout: 120_000 });
  await expect(ws.getByRole("tab", { name: /^View tables 1$/ })).toHaveAttribute("aria-selected", "true");
  // The list shows the copy (cards start closed, so the card, not its table, is counted).
  await expect(ws.getByTestId("crosstab-edit-table")).toHaveCount(1);
  if (SHOT) await page.screenshot({ path: SHOT });

  // 3. Again: nothing more.
  await ws.getByRole("button", { name: "Copy here" }).click();
  await expect(ws.getByText("1 table was already copied here, so it was not copied again.")).toBeVisible({ timeout: 120_000 });
  await expect(ws.getByRole("tab", { name: /^View tables 1$/ })).toBeVisible();

  // 4. Edit the copy for this wave: add a column, then Update table.
  await ws.getByTestId("crosstab-edit-table").first().click();
  await expect(ws.getByRole("tab", { name: "Build table" })).toHaveAttribute("aria-selected", "true");
  await expect(ws.locator('[data-row-key="Region"]')).toBeVisible();
  await expect(ws.getByTestId("crosstab-editing")).toContainText("Editing");
  await ws.getByPlaceholder("Search name or label").fill("NPS");
  await ws.locator('div.grid:has(> span[title="NPS"])').first().getByRole("button", { name: "Column", exact: true }).click();
  await ws.getByPlaceholder("Search name or label").fill("");
  if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-editing.png") });
  await ws.getByTestId("crosstab-update-table").click();
  await expect(ws.getByText(/^Updated the table/)).toBeVisible({ timeout: 120_000 });
  await expect(ws.getByRole("tab", { name: /^View tables 1$/ })).toBeVisible();
  await expect(ws.getByTestId("crosstab-editing")).toHaveCount(0);
  if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-updated.png") });

  // 5. Export all: wave 1 gets a second table, then both are exported in one workbook from its list.
  ws = await openCrosstabs(page, "brand-w1.csv");
  await ws.getByPlaceholder("Search name or label").fill("NPS");
  await ws.locator('div.grid:has(> span[title="NPS"])').first().getByRole("button", { name: "Row", exact: true }).click();
  await ws.getByRole("button", { name: /Add table to set/ }).click();
  await expect(ws.getByRole("tab", { name: /^View tables 2$/ })).toHaveAttribute("aria-selected", "true", { timeout: 120_000 });
  const exportAll = ws.getByTestId("crosstab-export-all");
  await expect(exportAll).toContainText("Export these 2:");
  const [download] = await Promise.all([page.waitForEvent("download"), exportAll.getByRole("link", { name: "Export all to Excel", exact: true }).click()]);
  const wb = XLSX.read(readFileSync(await download.path()), { type: "buffer" });
  expect(wb.SheetNames.length).toBe(3);
  expect(wb.SheetNames[0]).toBe("Contents");
  if (SHOT) await exportAll.screenshot({ path: SHOT.replace(".png", "-export-all.png") });
});
