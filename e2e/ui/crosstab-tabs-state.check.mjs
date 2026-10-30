// B50-F01 (Codex, 28 October 2026): switching between Build table and View tables unmounted the other tab, so
// a reviewed SemanticTabs plan was lost and a table's Mean tick (and so its export links) reset. Real browser
// against the disposable local stack; the planner's tool call is scripted through the stack's
// model-fixture.json, so the plan screen, the engine and the tables are real. No reload anywhere: a reload
// still starts afresh, as before.
//   1. A reviewed SemanticTabs plan survives View tables and back: the request, the summary and Add table now.
//   2. On a built starter table, an unticked Mean, its mean=0 export links and an unsaved title survive Build
//      table and back.
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { openCrosstabs, showBuild, showTables } from "./helpers/crosstabs.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const fixtureFile = path.join(path.dirname(path.resolve(manifestPath)), "model-fixture.json");
const FIXTURE = path.resolve("fixtures/golden-thread-1");

const SCRIPT = String.raw`
import sys, pandas as pd, pyreadstat
n = 300
seg = [float(i % 3 + 1) for i in range(n)]
sat = [float(9 if i % 20 == 0 else min(5, (i * 7) % 5 + 1 + (1 if seg[i] == 1.0 and i % 2 == 0 else 0))) for i in range(n)]
labels = {"Segment": {1.0: "Segment1", 2.0: "Segment2", 3.0: "Segment3"},
          "Satisfaction": {1.0: "Very dissatisfied", 2.0: "Dissatisfied", 3.0: "Neither", 4.0: "Satisfied", 5.0: "Very satisfied", 9.0: "Don't know"}}
pyreadstat.write_sav(pd.DataFrame({"Segment": seg, "Satisfaction": sat}), sys.argv[1], variable_value_labels=labels)
`;

test.use({ viewport: { width: 1600, height: 1000 } });
test.afterEach(() => writeFileSync(fixtureFile, JSON.stringify({})));

test("a reviewed plan, an unticked Mean and an unsaved title survive switching between Build table and View tables", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  page.setDefaultTimeout(30_000);
  const dir = mkdtempSync(path.join(tmpdir(), "tabs-state-"));
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `tabs-state-${Date.now()}` });
    await ui.upload(run, path.join(FIXTURE, "golden-survey-documented.xlsx"), "table");
    const sav = path.join(dir, "tabs-state.sav");
    execFileSync(process.env.PYTHON ?? "python3", ["-I", "-c", SCRIPT, sav]);
    await ui.upload(run, sav, "table");
    await page.goto(run.url, { waitUntil: "networkidle" });

    // 1. A reviewed plan.
    let ws = await openCrosstabs(page, "golden-survey-documented.xlsx");
    await ws.getByRole("button", { name: "SemanticTabs" }).click();
    const request = `TABS-PLAN-${Date.now()} satisfaction by gender`;
    writeFileSync(fixtureFile, JSON.stringify({ untargeted: [{ match: request, tool: "submit_plan", input: { summary: "x", rows: ["Satisfaction"], columns: ["Gender"], filters: [], unclear: [] } }] }));
    await ws.getByPlaceholder(/What to measure/).fill(request);
    await ws.getByRole("button", { name: "Set it up" }).click();
    const summary = ws.getByTestId("crosstab-ask-summary");
    await expect(summary).toBeVisible({ timeout: 60_000 });
    const planned = await summary.textContent();
    await showTables(ws);
    await expect(summary).toBeHidden();
    await showBuild(ws);
    await expect(summary).toBeVisible();
    await expect(summary).toHaveText(planned);
    await expect(ws.getByPlaceholder(/What to measure/)).toHaveValue(request);
    await expect(ws.getByRole("button", { name: "Add table now" })).toBeEnabled();

    // 2. A built table's display choices and an unsaved title.
    ws = await openCrosstabs(page, "tabs-state.sav");
    await ws.getByRole("button", { name: "StarterTabs" }).click();
    await ws.getByRole("button", { name: "Build starter tables" }).click();
    await showTables(ws);
    const tick = ws.getByTestId("crosstab-mean-tick").first();
    await expect.poll(async () => {
      const collapsed = ws.getByRole("button", { name: /^▸ / });
      for (let i = (await collapsed.count()) - 1; i >= 0; i--) await collapsed.nth(i).click().catch(() => {});
      return tick.count();
    }, { timeout: 120_000 }).toBeGreaterThan(0);
    await tick.uncheck();
    const excel = ws.getByRole("link", { name: "Download Excel", exact: true }).first();
    await expect(excel).toHaveAttribute("href", /mean=0/);
    await ws.getByRole("button", { name: "Title and caption" }).first().click();
    const title = ws.getByLabel("Title", { exact: true }).first();
    await title.fill("Satisfaction by segment, draft title");

    await showBuild(ws);
    await showTables(ws);
    await expect(tick).not.toBeChecked();
    await expect(excel).toHaveAttribute("href", /mean=0/);
    await expect(title).toHaveValue("Satisfaction by segment, draft title");
    if (process.env.SHOT) await ws.screenshot({ path: process.env.SHOT });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
