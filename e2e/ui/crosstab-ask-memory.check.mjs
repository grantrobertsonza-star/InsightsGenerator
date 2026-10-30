// SemanticTabs memory (Grant, 2026-10-22: "switch the rows and columns of the table just produced"
// had no memory of the previous request). Real browser against the disposable local stack; the
// planner's tool call is scripted through the stack's model-fixture.json, so the table read, the
// validation of based_on_table, the plan screen and the engine are real.
//   1. Satisfaction by gender is asked for and added.
//   2. "Switch the rows and columns of the table just produced": the plan starts from that table
//      (named under Starts from), with Gender down the side and Satisfaction across; the panel says
//      it remembers the tables and the last request; Add table now builds it.
//   3. Forget my earlier requests clears the panel's requests; the tables are still remembered.
//   4. After a reload the panel's requests are gone but the tables are read again, so a reference
//      to the table just produced still starts from the newest table.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { openCrosstabs } from "./helpers/crosstabs.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const fixtureFile = path.join(path.dirname(path.resolve(manifestPath)), "model-fixture.json");
const FIXTURE = path.resolve("fixtures/golden-thread-1");


test.use({ viewport: { width: 1600, height: 1000 } });
test.afterEach(() => writeFileSync(fixtureFile, JSON.stringify({})));

test("SemanticTabs follows a reference to the table just produced, across requests and a reload", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  page.setDefaultTimeout(30_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `crosstab-ask-memory-${Date.now()}` });
    await ui.upload(run, path.join(FIXTURE, "golden-survey-documented.xlsx"), "table");
    await ui.expectReadyOrActionableRecovery(run);
    await page.goto(run.url, { waitUntil: "networkidle" });
    let ws = await openCrosstabs(page, "golden-survey-documented.xlsx");
    await ws.getByRole("button", { name: "SemanticTabs" }).click();

    const script = (request, input) => writeFileSync(fixtureFile, JSON.stringify({ untargeted: [{ match: request, tool: "submit_plan", input }] }));
    const ask = async (request) => {
      await ws.getByPlaceholder(/What to measure/).fill(request);
      await ws.getByRole("button", { name: "Set it up" }).click();
      await expect(ws.getByTestId("crosstab-ask-summary")).toBeVisible({ timeout: 60_000 });
    };
    const tables = async () => (await db.query("select id, label from document_tables where run_id=$1 and table_index >= 100 and crosstab_status <> 'evidence' order by table_index desc", [run.id])).rows;
    const memory = () => ws.getByTestId("crosstab-ask-memory");

    // 1. The first table.
    await expect(memory()).toHaveText(/^Remembers the tables built from this file, so you can say/);
    const r1 = `MEMORY-FIRST-${Date.now()} satisfaction by gender`;
    script(r1, { summary: "x", rows: ["Satisfaction"], columns: ["Gender"], filters: [], unclear: [] });
    await ask(r1);
    await expect(ws.getByTestId("crosstab-ask-based-on")).toHaveCount(0);
    await ws.getByRole("button", { name: "Add table now" }).click();
    await expect.poll(async () => (await tables()).length, { timeout: 120_000 }).toBe(1);
    const [first] = await tables();
    await ws.getByRole("button", { name: "SemanticTabs" }).click();
    await expect(memory()).toContainText("and your last request here");

    // 2. Switch rows and columns of the table just produced.
    const r2 = `MEMORY-SWITCH-${Date.now()} switch the rows and columns of the table just produced`;
    script(r2, { summary: "x", rows: ["Gender"], columns: ["Satisfaction"], filters: [], unclear: [], based_on_table: first.id });
    await ask(r2);
    await expect(ws.getByTestId("crosstab-ask-based-on")).toHaveText(first.label);
    await expect(ws.getByTestId("crosstab-ask-rows")).toHaveText("Gender");
    await expect(ws.getByTestId("crosstab-ask-columns")).toHaveText("Overall satisfaction");
    await expect(ws.getByTestId("crosstab-ask-check")).toContainText(`Starts from the earlier table "${first.label}"`);
    await expect(memory()).toContainText("and your last 2 requests here");
    if (process.env.SHOT) await ws.getByTestId("crosstab-ask-summary").locator("xpath=../..").screenshot({ path: process.env.SHOT.replace(".png", "-ask-memory.png") });
    await ws.getByRole("button", { name: "Add table now" }).click();
    await expect.poll(async () => (await tables()).length, { timeout: 120_000 }).toBe(2);

    // 3. Forget the panel's requests; the tables stay remembered.
    await ws.getByRole("button", { name: "SemanticTabs" }).click();
    await memory().getByRole("button", { name: "Forget my earlier requests" }).click();
    await expect(memory()).toHaveText(/^Remembers the tables built from this file, so you can say/);

    // 4. After a reload, the newest table is read again.
    await page.reload({ waitUntil: "networkidle" });
    ws = await openCrosstabs(page, "golden-survey-documented.xlsx");
    await ws.getByRole("button", { name: "SemanticTabs" }).click();
    await expect(memory()).toHaveText(/^Remembers the tables built from this file, so you can say/);
    const [newest] = await tables();
    expect(newest.id).not.toBe(first.id);
    const r3 = `MEMORY-AGAIN-${Date.now()} switch them back`;
    script(r3, { summary: "x", rows: ["Satisfaction"], columns: ["Gender"], filters: [], unclear: [], based_on_table: newest.id });
    await ask(r3);
    await expect(ws.getByTestId("crosstab-ask-based-on")).toHaveText(newest.label);
    await expect(ws.getByTestId("crosstab-ask-rows")).toHaveText("Overall satisfaction");
  } finally {
    await db.end();
  }
});
