// Codex review of new areas (10,000 cases, 28 October 2026), real browser on the disposable stack:
//   NEW10K-F03: a published Indicator data file is "Read" in its source row and the selected-source header,
//     after the upload and after a reload, and the "Read failed" filter does not list it.
//   NEW10K-F02: a country whose every value in the series is withheld as confidential (OECD CONF_STATUS C,
//     no value) can still be chosen; the area heading counts it apart from the areas with values, and its
//     table cell says "Withheld (confidential)", never 0 and never "No value". A country with a value is
//     unchanged.
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openAddFiles } from "./helpers/addFiles.mjs";
import { openSourceTab, selectSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const shot = process.env.SHOT;

/** A two-country OECD SDMX-CSV built from the fixture's first row: ZAF = 50, KEN withheld (C, no value). */
function withheldFile() {
  const lines = readFileSync(path.resolve("fixtures/indicator-data/OECD_FDI_INC_AGGR_filtered_slice.csv"), "utf8").split("\n");
  const head = lines[0];
  const cols = head.split(",");
  const cellsOf = (l) => (l.match(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g) ?? []).map((c) => c.replace(/,$/, ""));
  const template = cellsOf(lines[1]).slice(0, cols.length);
  const row = (code, name, value, conf) => {
    const c = [...template];
    c[cols.indexOf("REF_AREA")] = code;
    c[cols.indexOf("Reference area")] = name;
    c[cols.indexOf("TIME_PERIOD")] = "2024-Q1";
    c[cols.indexOf("OBS_VALUE")] = value;
    c[cols.indexOf("CONF_STATUS")] = conf;
    return c.join(",");
  };
  const dir = mkdtempSync(path.join(tmpdir(), "ind-withheld-"));
  const file = path.join(dir, "oecd_withheld_country.csv");
  writeFileSync(file, [head, row("ZAF", "South Africa", "50", "F"), row("KEN", "Kenya", "", "C")].join("\n") + "\n");
  return file;
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("a published indicator file reads as Read, and a fully confidential country can be chosen", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  await ui.createRun({ name: `indicator-status-${Date.now()}` });
  await page.getByRole("button", { name: /^Import data/ }).first().click();
  const panel = await openAddFiles(page);
  await panel.getByTestId("add-files-input").setInputFiles(withheldFile());
  await expect(panel.getByLabel("Type of oecd_withheld_country.csv")).toHaveValue("indicator");
  await panel.getByRole("button", { name: /^Upload/ }).click();
  const name = "oecd_withheld_country.csv";
  const source = page.getByTestId("source-row").filter({ has: page.getByRole("button", { name: `Select ${name}`, exact: true }) });
  await expect(source).toContainText("Indicator data", { timeout: 3 * 60_000 });

  // F03: Read, not Read failed, in the row and the header; after a reload too; not under the failed filter.
  const checkRead = async () => {
    await expect(source).toContainText("Read");
    await expect(source).not.toContainText("Read failed");
    await selectSource(page, name);
    await expect(page.getByTestId("source-processing")).toHaveText("Processing: Read");
    await page.getByLabel("Filter by state").selectOption("failed");
    await expect(source).toHaveCount(0);
    await page.getByLabel("Filter by state").selectOption("all");
    await expect(source).toHaveCount(1);
  };
  await checkRead();
  await page.reload({ waitUntil: "networkidle" });
  await checkRead();

  // F02: Kenya is offered though every value is withheld; choosing it shows the withheld cell.
  const view = await openSourceTab(page, "Indicator data");
  await expect(view.getByTestId("indicator-summary")).toContainText("2 areas", { timeout: 60_000 });
  await expect(view.getByTestId("indicator-area-legend")).toHaveText(/1 with values, 1 with every value withheld as confidential for this series/);
  await view.getByRole("checkbox", { name: "Kenya (KEN)" }).check();
  await view.getByRole("checkbox", { name: "South Africa (ZAF)" }).check();
  const table = view.getByTestId("indicator-table");
  await expect(table.locator("thead th")).toHaveText(["Period", "Kenya (KEN)", "South Africa (ZAF)"], { timeout: 60_000 });
  const row = table.locator("tbody tr").filter({ has: page.getByRole("rowheader", { name: "2024-Q1", exact: true }) });
  await expect(row.locator("td").nth(0)).toHaveText("Withheld (confidential)");
  // The file states millions (UNIT_MULT 6), so 50 is shown as 50,000,000.
  await expect(row.locator("td").nth(1)).toHaveText("50,000,000");
  await expect(view.getByTestId("indicator-withheld")).toBeVisible();
  if (shot) await page.screenshot({ path: shot, fullPage: true });
});
