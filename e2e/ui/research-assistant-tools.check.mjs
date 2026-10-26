// The Research assistant as the project's expert (Grant, 2026-10-22). Real browser against the
// disposable stack; the model is the stack's replay, scripted through model-fixture.json
// ("untargeted" rules, later steps first), so the tool loop, the plan checks, the Python engine, the
// saved table and the page are real.
//   1. A data question: the assistant builds Satisfaction by Gender from the golden file; the reply
//      ends with the code-written line naming the table; the table is saved as a draft with source
//      "assistant" and is listed under Cross tabs, All tables, with a Research assistant badge.
//   2. A sample size question: the figure in the reply comes from the calculator (385 completes for a
//      5 point margin at 95%), as the tool result the model was given.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { openCrosstabs } from "./helpers/crosstabs.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const fixtureFile = path.join(path.dirname(path.resolve(manifestPath)), "model-fixture.json");
const FIXTURE = path.resolve("fixtures/golden-thread-1");

test.use({ viewport: { width: 1600, height: 1000 } });
test.afterEach(() => writeFileSync(fixtureFile, JSON.stringify({})));

test("the Research assistant answers from a table it builds, saved as a draft, and gives sample sizes from the calculator", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  page.setDefaultTimeout(30_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `assistant-tools-${Date.now()}` });
    await ui.upload(run, path.join(FIXTURE, "golden-survey-documented.xlsx"), "table");
    await ui.expectReadyOrActionableRecovery(run);
    const doc = (await db.query("select id from documents where run_id=$1 and source_filename='golden-survey-documented.xlsx'", [run.id])).rows[0].id;
    const assistantTables = async () =>
      (await db.query("select label, crosstab_status from document_tables where run_id=$1 and crosstab->>'source' = 'assistant'", [run.id])).rows;

    const marker = `ASSIST-${Date.now()}`;
    const sizeMarker = `SIZE-${Date.now()}`;
    writeFileSync(
      fixtureFile,
      JSON.stringify({
        untargeted: [
          { match: "saved as a draft under Cross tabs", text: "Satisfaction by gender is built; the figures are in the table." },
          { match: "Completed interviews needed: 385.", text: "You need 385 completed interviews for a 5 point margin at 95% confidence." },
          { match: marker, tool: "build_table", input: { data_file_id: doc, rows: ["Satisfaction"], columns: ["Gender"], filters: [] } },
          { match: sizeMarker, tool: "sample_size", input: { mode: "sample_for_margin", margin_pct: 5 } },
        ],
      }),
    );

    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Research assistant/ }).first().click();
    const box = page.getByPlaceholder(/Ask a question about the data/).filter({ visible: true }).first();
    const send = async (text) => {
      await box.fill(text);
      await page.getByRole("button", { name: "Send" }).filter({ visible: true }).first().click();
    };

    // 1. A data question.
    await send(`${marker} Is satisfaction different by gender?`);
    await expect(page.getByText(/Tables built for this answer \(drafts under Cross tabs, All tables\): ".+" from golden-survey-documented\.xlsx\./).filter({ visible: true }).first()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText("Satisfaction by gender is built; the figures are in the table.", { exact: false }).filter({ visible: true }).first()).toBeVisible();
    await expect.poll(assistantTables, { timeout: 60_000 }).toHaveLength(1);
    expect((await assistantTables())[0].crosstab_status).toBe("draft");
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(".png", "-assistant-table.png"), fullPage: true });

    // 2. A sample size question: the calculator's figure.
    await send(`${sizeMarker} What sample do I need for a 5% margin of error nationally?`);
    await expect(page.getByText("You need 385 completed interviews for a 5 point margin at 95% confidence.").filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    expect(await assistantTables()).toHaveLength(1);

    // The table is under Cross tabs, All tables, with its badge.
    const ws = await openCrosstabs(page, "golden-survey-documented.xlsx");
    await ws.getByRole("button", { name: /^All tables/ }).click();
    await expect(ws.getByTestId("crosstab-assistant-badge")).toHaveCount(1);
    if (process.env.SHOT) await ws.screenshot({ path: process.env.SHOT.replace(".png", "-assistant-all-tables.png") });
  } finally {
    await db.end();
  }
});
