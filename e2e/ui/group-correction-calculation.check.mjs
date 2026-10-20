// IMP-005: a saved question-group correction changes the actual calculation, and clearing it
// restores the imported definition in the calculation too, after reload.
// Golden fixture: MR_Convenience, MR_Value and MR_Service are declared one multiple-response set
// ("Reasons") in the Codebook. Earlier evidence proved the correction and its clear at dictionary
// level only; this computes under each state:
//   1. Corrected to Single mention (saved, then reload): MR_Convenience builds as its own
//      question and its "selected" code 1 share equals the fixture's independent reference (60%).
//   2. Correction cleared (then reload): the question type is Multiple response again, the
//      saved correction is gone, and the set builds as a multiple-response table that lists
//      Convenience with the same 60% share; the table saved under the correction is visibly
//      marked as possibly outdated.
// Real browser on the disposable stack; the stored correction is checked in the database.
import { expect, test } from "@playwright/test";
import { openCrosstabs } from "./helpers/crosstabs.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { openSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const GOLDEN = path.resolve("fixtures/golden-thread-1/golden-survey-documented.xlsx");
const reference = (() => {
  const doc = JSON.parse(readFileSync(path.resolve("fixtures/golden-thread-1/expected.json"), "utf8"));
  const found = Object.values(doc).find(Array.isArray).find((a) => a.id === "MR_Convenience");
  if (!found) throw new Error("no MR_Convenience reference");
  return found;
})();

test("a saved group correction computes as corrected, and clearing it computes the imported set again, across reloads", async ({ page }, testInfo) => {
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `group-correction-${Date.now()}` });
    await ui.upload(run, GOLDEN, "table");
    await expect.poll(async () => Number((await db.query("select count(*) from document_tables where run_id=$1", [run.id])).rows[0].count), { timeout: 60_000 }).toBeGreaterThan(0);
    const docId = (await db.query("select id from documents where run_id=$1 and kind='table'", [run.id])).rows[0].id;
    const overrides = async () => (await db.query("select variable_overrides from documents where id=$1", [docId])).rows[0].variable_overrides ?? {};

    const openImport = async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Import data/ }).first().click();
      // The data file's Variables tab (Grant's Sources layout, 2026-10-20).
      await openSource(page, path.basename(GOLDEN), "Variables");
    };
    const reveal = async (control) => {
      await expect(control).toBeAttached({ timeout: 60_000 });
      const ancestors = control.locator("xpath=ancestor::details");
      for (let i = 0; i < (await ancestors.count()); i++) {
        const d = ancestors.nth(i);
        if ((await d.getAttribute("open")) === null) await d.locator("summary").first().click();
      }
      await expect(control).toBeVisible();
    };
    const questionType = () => page.getByLabel("Question type: MR_Convenience", { exact: true });
    const tol = reference.tolerance.value;

    // 1. Correct MR_Convenience to a single question; it persists and reloads.
    await openImport();
    await reveal(questionType());
    await expect(questionType()).toHaveValue("multi");
    await questionType().selectOption("single");
    await expect.poll(async () => (await overrides()).MR_Convenience?.questionType, { timeout: 30_000 }).toBe("single");
    await openImport();
    await reveal(questionType());
    await expect(questionType()).toHaveValue("single");

    const corrected = await ui.buildTable(run, { row: "MR_Convenience" });
    const correctedShare = await ui.readStatistic(corrected, { variable: "MR_Convenience", rawCode: "1", statistic: "selection_percentage" });
    expect(Math.abs(correctedShare - reference.expectedValue), `corrected single share ${correctedShare} vs reference ${reference.expectedValue}`).toBeLessThanOrEqual(tol);

    // 2. Clear the correction; the imported multiple-response definition is back, in the
    //    calculation as well.
    await openImport();
    await reveal(questionType());
    await page.getByRole("button", { name: "Clear corrections: MR_Convenience", exact: true }).click();
    await expect.poll(async () => (await overrides()).MR_Convenience, { timeout: 30_000 }).toBeUndefined();
    await openImport();
    await reveal(questionType());
    await expect(questionType()).toHaveValue("multi");

    // The adapter's picker selects single variables by their "Row" toggle; a multiple-response set
    // offers "Row (all)", so the set table is built with the same workspace steps here.
    await page.goto(run.url, { waitUntil: "networkidle" });
    const dialog = await openCrosstabs(page);
    await dialog.getByPlaceholder("Search name or label").fill("Reasons");
    const setRow = dialog.locator('div.grid:has(> span[title="Reasons"])').first();
    await expect(setRow).toContainText("multiple response, 3 items");
    await setRow.getByRole("button", { name: "Row (all)", exact: true }).click();
    await dialog.getByRole("button", { name: "Add table to set", exact: true }).click();
    const setTable = dialog.locator('table[data-testid="crosstab-result-table"]').filter({ hasText: "Convenience" }).filter({ hasText: "Service" }).last();
    await expect(setTable).toBeVisible({ timeout: 60_000 });
    const shareText = await setTable.locator("tr", { hasText: "Convenience" }).first().innerText();
    const shares = [...shareText.matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
    const toggle = dialog.getByRole("button", { name: /^▸ Convenience, all respondents.*may be outdated/ });
    await expect(toggle).toBeVisible();
    // Codex IR-08: at the default 1280px viewport the title and its "may be outdated" label had
    // collapsed to 0px beside the table's action buttons. They must keep a usable width, here and
    // with the variable pane dragged to its widest (the narrowest results pane).
    const usable = async () => {
      expect((await toggle.boundingBox())?.width ?? 0, "table title toggle width").toBeGreaterThanOrEqual(200);
      expect((await toggle.getByText("may be outdated").boundingBox())?.width ?? 0, "outdated label width").toBeGreaterThan(40);
    };
    await usable();
    const divider = page.getByRole("separator").first();
    if (await divider.isVisible()) {
      await divider.focus();
      await page.keyboard.press("End");
      await usable();
      await page.keyboard.press("Home");
    }
    testInfo.annotations.push({ type: "set-row", description: shareText.replace(/\s+/g, " ") });
    expect(shares.some((v) => Math.abs(v - reference.expectedValue) <= tol), `set Convenience share ${shares} vs reference ${reference.expectedValue}`).toBe(true);
  } finally {
    await db.end();
  }
});
