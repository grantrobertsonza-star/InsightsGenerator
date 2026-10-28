// Cross tabs opens straight into the crosstab workspace (Grant's review, 2026-10-20), in a real
// browser on the disposable stack.
//   1. With no data file: an empty state that links to Sources, and no workspace.
//   2. With two: the workspace opens on its own (no tile, no Close), with the file chooser in its
//      header and the counts named for what they count; nothing is built by opening it.
//   3. Switching files keeps each file's unfinished table; after a reload the file used last opens.
//   4. The cell pane is not shown until a cell is chosen, and Close gives its room back. Adding a table
//      switches to View tables (full width, no inner scroll box), where the cell pane stays in view on
//      scrolling; Build table brings the variable list back (Grant, 27 October 2026).
//   5. The variable pane collapses and expands.
import { expect, test } from "@playwright/test";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { crosstabWorkspace, openCrosstabs } from "./helpers/crosstabs.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FIXTURE = path.resolve("fixtures/golden-thread-1");

test.use({ viewport: { width: 1600, height: 1000 } });

test("Cross tabs: direct entry, file chooser, kept state, contextual cell pane", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `crosstabs-entry-${Date.now()}` });
    const section = page.getByTestId("crosstabs-section").filter({ visible: true });

    // 1. Empty.
    await page.getByRole("button", { name: /^Cross tabs/ }).first().click();
    await expect(section).toContainText("No data files yet");
    await expect(section.getByRole("button", { name: "Go to Sources" })).toBeVisible();
    await expect(crosstabWorkspace(page)).toHaveCount(0);

    // 2. Two files; the workspace opens directly. Different content: an identical second upload is
    //    recognised as the same file and not read again.
    const dir = mkdtempSync(path.join(tmpdir(), "xt-"));
    copyFileSync(path.join(FIXTURE, "golden-survey-documented.xlsx"), path.join(dir, "wave-b.xlsx"));
    writeFileSync(path.join(dir, "wave-a.csv"), ["id,Gender,Purchase", ...Array.from({ length: 40 }, (_, i) => `${i + 1},${1 + (i % 2)},${1 + (i % 3 === 0 ? 1 : 0)}`)].join("\n"));
    for (const name of ["wave-a.csv", "wave-b.xlsx"]) await ui.upload(run, path.join(dir, name), "table");
    await expect.poll(async () => Number((await db.query("select count(distinct document_id) from document_tables where run_id=$1", [run.id])).rows[0].count), { timeout: 180_000 }).toBe(2);
    await page.goto(run.url, { waitUntil: "networkidle" });
    let ws = await openCrosstabs(page, "wave-b.xlsx");
    await expect(ws.getByRole("button", { name: "Close (Esc)" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Crosstab workspace" })).toHaveCount(0);
    await expect(ws.getByTestId("crosstab-file-meta")).toContainText(/\d[\d,]* cases · \d[\d,]* variables in the file/);
    await expect(ws.getByTestId("crosstab-list-count")).toContainText(/rows in the list/);
    await expect(ws.getByTestId("crosstab-settings-summary")).toContainText("Comparisons: false discovery rate correction");
    // Table settings is a closed card that says what is set (Grant, 2026-10-22; cards 2026-10-27);
    // Change settings opens its panel, and the card closes it again. One panel open at a time.
    const settings = ws.getByTestId("crosstab-table-settings");
    const settingsPanel = ws.getByRole("region", { name: "Table settings" });
    await expect(settings).toHaveAttribute("aria-expanded", "false");
    await expect(settingsPanel).toHaveCount(0);
    await expect(ws.getByTestId("crosstab-table-settings-summary")).toHaveText(/^unweighted · false discovery rate · no survey design · non-answers excluded$/);
    await ws.getByRole("button", { name: "Change settings" }).click();
    await expect(settings).toHaveAttribute("aria-expanded", "true");
    await expect(settingsPanel.getByText("Multiple comparisons")).toBeVisible();
    await ws.getByTestId("crosstab-display-section").click();
    await expect(settingsPanel).toHaveCount(0);
    await expect(ws.getByRole("region", { name: "Display and statistics" })).toBeVisible();
    await ws.getByTestId("crosstab-display-section").click();
    await expect(ws.getByRole("region", { name: "Display and statistics" })).toHaveCount(0);
    await expect(settings).toHaveAttribute("aria-expanded", "false");
    expect(Number((await db.query("select count(*) from document_tables where run_id=$1 and table_index >= 100", [run.id])).rows[0].count), "opening built a table").toBe(0);

    // 3. An unfinished table on wave-b survives a switch to wave-a and back.
    const pickRow = async (name) => {
      await ws.getByPlaceholder("Search name or label").fill(name);
      await ws.locator(`div.grid:has(> span[title="${name}"])`).first().getByRole("button", { name: "Row", exact: true }).click();
      await ws.getByPlaceholder("Search name or label").fill("");
    };
    await pickRow("Purchase");
    await expect(ws.locator('[data-row-key="Purchase"]')).toBeVisible();
    ws = await openCrosstabs(page, "wave-a.csv");
    await expect(ws.locator('[data-row-key="Purchase"]')).toHaveCount(0);
    ws = await openCrosstabs(page, "wave-b.xlsx");
    await expect(ws.locator('[data-row-key="Purchase"]')).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });
    ws = await openCrosstabs(page);
    const chosen = await page.getByTestId("crosstab-file-select").filter({ visible: true }).evaluate((s) => s.options[s.selectedIndex].text);
    expect(chosen).toMatch(/^wave-b\.xlsx/);

    // 4. The cell pane opens on a cell and closes.
    await expect(page.getByTestId("crosstab-cell-pane")).toHaveCount(0);
    await pickRow("Purchase");
    await ws.getByRole("button", { name: /Add table to set/ }).click();
    const table = ws.locator('table[data-testid="crosstab-result-table"]').last();
    await expect(table).toBeVisible({ timeout: 60_000 });
    //    Adding a table switches to View tables (Grant, 2026-10-27): the tables at full width with no
    //    variable list, and no scroll box of their own, so the page's scroll bar is the only one.
    await expect(ws.getByRole("tab", { name: /^View tables \d+$/ })).toHaveAttribute("aria-selected", "true");
    await expect(ws.getByPlaceholder("Search name or label")).toHaveCount(0);
    const tablesPane = ws.getByRole("region", { name: "Tables" });
    expect(await tablesPane.evaluate((el) => getComputedStyle(el).overflowY)).toBe("visible");
    const widths = await ws.evaluate((el) => ({ ws: el.getBoundingClientRect().width, tables: el.querySelector('section[aria-label="Tables"]').getBoundingClientRect().width }));
    expect(widths.tables).toBeGreaterThan(widths.ws * 0.95);
    await table.locator("td.cursor-pointer").first().click();
    const pane = page.getByTestId("crosstab-cell-pane").filter({ visible: true });
    await expect(pane).toContainText("Selected cell");
    // The cell pane stays in view while the page is scrolled down a long table set.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(async () => (await pane.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(".png", "-view-tables.png") });
    await pane.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByTestId("crosstab-cell-pane")).toHaveCount(0);
    // Build table brings the variable list back, with the table's selection cleared for the next one.
    await ws.getByRole("tab", { name: "Build table" }).click();
    await expect(ws.getByPlaceholder("Search name or label")).toBeVisible();
    await expect(ws.getByRole("button", { name: /Add table to set/ })).toBeVisible();

    // 5. The variable pane collapses and expands.
    await page.getByRole("button", { name: "Collapse left panel" }).filter({ visible: true }).click();
    await expect(ws.getByPlaceholder("Search name or label")).toBeHidden();
    await page.getByRole("button", { name: "Expand left panel" }).filter({ visible: true }).click();
    await expect(ws.getByPlaceholder("Search name or label")).toBeVisible();
    if (process.env.SHOT) await section.screenshot({ path: process.env.SHOT });
  } finally {
    await db.end();
  }
});
