// Choosing a questionnaire question's variable by hand, in a real browser on the disposable stack
// (Grant, 2026-10-20: "when there is no match, there is no way to manually select a match from the
// data file's variable dictionary"). The questionnaire's questions are written straight into the
// database, as the stack's model replay cannot read this fixture's questions; everything from
// matching on is the app's own path.
//   1. Matching links the question whose code is a variable name; the other has no match.
//   2. The tab's count is questions to check, not links.
//   3. "Choose variable" searches the data file's variables; the one chosen is confirmed, shown as
//      chosen by you, and kept after a reload.
//   4. A variable already confirmed for one question is shown, not offered, for another.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { addFiles } from "./helpers/addFiles.mjs";
import { openSource, openSourceTab } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FIXTURE = path.resolve("fixtures/golden-thread-1");

test.use({ viewport: { width: 1600, height: 1000 } });

test("a question with no match can be linked by hand to a variable from the data file", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `manual-link-${Date.now()}` });
    await ui.upload(run, path.join(FIXTURE, "golden-survey-documented.xlsx"), "table");
    await expect.poll(async () => Number((await db.query("select count(*) from document_tables where run_id=$1", [run.id])).rows[0].count), { timeout: 120_000 }).toBeGreaterThan(0);
    await addFiles(page, path.join(FIXTURE, "questionnaire.docx"), "Questionnaire");
    await expect(page.getByTestId("source-row")).toHaveCount(2, { timeout: 120_000 });
    const instrument = (await db.query("select id, tenant_id from documents where run_id=$1 and kind='instrument'", [run.id])).rows[0];
    for (const [order, code, text] of [[0, "Region", "Which region do you live in?"], [1, "QX", "How likely are you to buy again?"]]) {
      await db.query("insert into instrument_items(tenant_id,run_id,document_id,item_order,code,item_text) values($1,$2,$3,$4,$5,$6)", [instrument.tenant_id, run.id, instrument.id, order, code, text]);
    }

    // 1. Match; Region links by its code.
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    const links = await openSource(page, "questionnaire.docx", "Questionnaire links");
    await links.getByRole("button", { name: /^(Match to variables|Match again)$/ }).click();
    await expect(links.getByText(/links suggested/)).toBeVisible({ timeout: 60_000 });

    // 2. The tab counts questions to check (Region), not links.
    await expect(page.getByRole("tab", { name: "Questionnaire links", exact: true }).getByTestId("source-tab-count")).toHaveText("1 to check", { timeout: 60_000 });

    // 3. QX has no match: choose Purchase for it.
    await links.getByRole("button", { name: "Review matches" }).click();
    await links.getByRole("button", { name: "No match", exact: true }).click();
    const qx = links.locator('[data-testid="item-links"][data-item-code="QX"]');
    await expect(qx).toContainText("No match");
    await qx.getByRole("button", { name: "Choose variable" }).click();
    const picker = qx.getByTestId("variable-picker");
    await picker.getByLabel("Search the data file's variables").fill("purch");
    await picker.getByRole("button", { name: /^Purchase/ }).click();
    await expect(links.getByText("Linked QX to Purchase, confirmed as chosen by you.")).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await db.query("select variable, method, status from instrument_links l join instrument_items i on i.id=l.item_id where i.code='QX' and i.document_id=$1", [instrument.id])).rows, { timeout: 30_000 }).toEqual([{ variable: "Purchase", method: "manual", status: "confirmed" }]);
    await links.getByRole("button", { name: "Confirmed", exact: true }).click();
    await expect(qx).toContainText("Purchase");
    await expect(qx).toContainText("Chosen by you");

    // Kept after a reload.
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    const again = await openSource(page, "questionnaire.docx", "Questionnaire links");
    await again.getByRole("button", { name: "Review matches" }).click();
    await again.getByRole("button", { name: "Confirmed", exact: true }).click();
    await expect(again.locator('[data-testid="item-links"][data-item-code="QX"]')).toContainText("Chosen by you");

    // 4. For Region, Purchase is shown as taken by QX and cannot be chosen.
    await again.getByRole("button", { name: "All", exact: true }).click();
    const region = again.locator('[data-testid="item-links"][data-item-code="Region"]');
    await region.getByRole("button", { name: "Choose another" }).click();
    await region.getByLabel("Search the data file's variables").fill("Purchase");
    const taken = region.getByTestId("variable-picker").getByRole("button", { name: /^Purchase/ });
    await expect(taken).toBeDisabled();
    await expect(taken).toContainText("confirmed for QX");
    if (process.env.SHOT) await again.screenshot({ path: process.env.SHOT });
    await openSourceTab(page, "Questionnaire links");
  } finally {
    await db.end();
  }
});
