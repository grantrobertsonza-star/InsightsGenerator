// Multiple-response families in questionnaire links, in a real browser on the disposable stack
// (Grant, 2026-10-22: FinScope's stem EN20 showed No match although the data has EN20_1 to EN20_n).
// The golden-thread workbook has the family MR_Convenience, MR_Value, MR_Service. The questionnaire's
// questions are written straight into the database, as the stack's model replay cannot read this
// fixture's questions; everything from matching on is the app's own path.
//   1. Matching links the stem MR to all three, at the same-code confidence, and says it is a family.
//   2. A family link the researcher rejects stays rejected; "Link all" in the picker links the rest,
//      chosen by the researcher, and says how many.
//   3. Matching again and a reload keep every decision.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { addFiles } from "./helpers/addFiles.mjs";
import { openSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FIXTURE = path.resolve("fixtures/golden-thread-1");
const FAMILY = ["MR_Convenience", "MR_Service", "MR_Value"];

test.use({ viewport: { width: 1600, height: 1000 } });

test("a multiple-response stem is linked to its whole family; Link all respects a rejection", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `family-link-${Date.now()}` });
    await ui.upload(run, path.join(FIXTURE, "golden-survey-documented.xlsx"), "table");
    await expect.poll(async () => Number((await db.query("select count(*) from document_tables where run_id=$1", [run.id])).rows[0].count), { timeout: 120_000 }).toBeGreaterThan(0);
    await addFiles(page, path.join(FIXTURE, "questionnaire.docx"), "Questionnaire");
    await expect(page.getByTestId("source-row")).toHaveCount(2, { timeout: 120_000 });
    const instrument = (await db.query("select id, tenant_id from documents where run_id=$1 and kind='instrument'", [run.id])).rows[0];
    await db.query("insert into instrument_items(tenant_id,run_id,document_id,item_order,code,item_text) values($1,$2,$3,0,'MR','Why do you choose this provider? Select all that apply.')", [instrument.tenant_id, run.id, instrument.id]);
    const stored = async () =>
      (await db.query("select l.variable, l.method, l.status from instrument_links l join instrument_items i on i.id=l.item_id where i.code='MR' and i.document_id=$1 order by l.variable", [instrument.id])).rows;

    // 1. Match: the stem takes all three, as a family, at the same-code confidence.
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    const links = await openSource(page, "questionnaire.docx", "Questionnaire links");
    await links.getByRole("button", { name: /^(Match to variables|Match again)$/ }).click();
    await expect(links.getByText(/links suggested/)).toBeVisible({ timeout: 60_000 });
    await links.getByRole("button", { name: "Review matches" }).click();
    await links.getByRole("button", { name: "All", exact: true }).click();
    const mr = links.locator('[data-testid="item-links"][data-item-code="MR"]');
    await expect(mr.getByTestId("item-family")).toHaveText("Multiple-response family: MR_Convenience to MR_Value (3 variables)");
    for (const v of FAMILY) await expect(mr).toContainText(v);
    await expect(mr).toContainText("Code stem, 92%");
    expect((await stored()).map((r) => r.status)).toEqual(["suggested", "suggested", "suggested"]);

    // 2. Reject MR_Value, then Link all from the picker: the other two are linked, the rejection stays.
    const valueRow = mr.locator("div.mb-1", { hasText: "MR_Value" });
    await valueRow.getByRole("button", { name: "Not MR_Value", exact: true }).click();
    await expect(valueRow).toContainText("Rejected", { timeout: 30_000 });
    await mr.getByRole("button", { name: "Choose another" }).click();
    const all = mr.getByTestId("variable-picker-link-all");
    await expect(all).toHaveText("Link all 3 in MR_* (MR_Convenience to MR_Value)");
    await all.click();
    await expect(links.getByText("Linked MR to 2 of 3 variables, confirmed as chosen by you.")).toBeVisible({ timeout: 60_000 });
    await expect.poll(stored, { timeout: 30_000 }).toEqual([
      { variable: "MR_Convenience", method: "manual", status: "confirmed" },
      { variable: "MR_Service", method: "manual", status: "confirmed" },
      { variable: "MR_Value", method: "stem", status: "rejected" },
    ]);

    // 3. Matching again and a reload keep every decision.
    const before = await stored();
    await links.getByRole("button", { name: "Match again" }).click();
    await expect(links.getByText(/links suggested/)).toBeVisible({ timeout: 60_000 });
    expect(await stored()).toEqual(before);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    const again = await openSource(page, "questionnaire.docx", "Questionnaire links");
    await again.getByRole("button", { name: "Review matches" }).click();
    await again.getByRole("button", { name: "All", exact: true }).click();
    await expect(again.locator('[data-testid="item-links"][data-item-code="MR"]').getByTestId("item-family")).toBeVisible();
    if (process.env.SHOT) await again.screenshot({ path: process.env.SHOT });
  } finally {
    await db.end();
  }
});
