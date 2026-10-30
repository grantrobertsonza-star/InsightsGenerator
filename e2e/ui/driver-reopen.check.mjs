// Reopening a saved driver analysis (Codex IR-03, 2026-10-20), in a real browser on the disposable stack:
//   1. Run and post: one saved analysis and its findings.
//   2. After a reload, reopening it from Saved analyses restores its controls (outcome, predictors) and
//      shows it as posted.
//   3. Taking it out of use and posting again keeps one analysis and the same number of findings
//      (it used to go from 1 analysis and 3 findings to 2 and 6).
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

test.use({ viewport: { width: 1440, height: 900 } });

test("a reopened driver analysis restores its settings and reposting adds no duplicates", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `driver-reopen-${Date.now()}` });
    // A seeded synthetic file: Y depends on X1 and X2; X3 is noise.
    const dir = mkdtempSync(path.join(tmpdir(), "driver-reopen-"));
    const file = path.join(dir, "driver-data.csv");
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const rows = ["id,Y,X1,X2,X3"];
    for (let i = 1; i <= 120; i++) {
      const x1 = 1 + Math.floor(rnd() * 5), x2 = 1 + Math.floor(rnd() * 5), x3 = 1 + Math.floor(rnd() * 5);
      const y = Math.min(10, Math.max(0, Math.round(x1 + 0.6 * x2 + rnd() * 2)));
      rows.push(`${i},${y},${x1},${x2},${x3}`);
    }
    writeFileSync(file, rows.join("\n") + "\n");
    await ui.upload(run, file, "table");

    const counts = async () => ({
      analyses: Number((await db.query("select count(*) from driver_analyses where run_id=$1", [run.id])).rows[0].count),
      findings: Number((await db.query("select count(*) from findings where run_id=$1 and pattern_type='driver' and status<>'rejected'", [run.id])).rows[0].count),
    });
    const openDriver = async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Analytics/ }).first().click();
      const section = page.getByTestId("analytics-section").filter({ visible: true });
      await section.getByRole("list", { name: "Analyses" }).getByRole("button", { name: /^Driver analysis/ }).click({ timeout: 60_000 });
      const workspace = page.getByRole("dialog", { name: "Analytics workspace" });
      await expect(workspace.getByLabel("Outcome variable")).toBeVisible({ timeout: 60_000 });
      return workspace;
    };
    const predictor = (ws, name) => ws.getByTestId("driver-predictor-list").locator("label", { hasText: new RegExp(`^${name}\\b`) }).locator("input[type=checkbox]");

    // 1. Run and post.
    let ws = await openDriver();
    await ws.getByLabel("Outcome variable").selectOption("Y");
    await predictor(ws, "X1").check();
    await predictor(ws, "X2").check();
    await ws.getByRole("button", { name: "Run driver analysis" }).click();
    const report = ws.getByTestId("driver-report");
    await expect(report).toBeVisible({ timeout: 2 * 60_000 });
    await report.getByRole("button", { name: "Post to findings" }).click();
    await expect.poll(async () => (await counts()).findings, { timeout: 60_000 }).toBeGreaterThan(0);
    const first = await counts();
    expect(first.analyses).toBe(1);

    // 2. Reload and reopen: the controls describe the result again.
    ws = await openDriver();
    const savedEntry = ws.getByRole("button", { name: /^Drivers of / }).filter({ visible: true }).first();
    await savedEntry.click();
    await expect(ws.getByTestId("driver-report")).toBeVisible({ timeout: 60_000 });
    await expect(ws.getByLabel("Outcome variable")).toHaveValue("Y");
    await expect(predictor(ws, "X1")).toBeChecked();
    await expect(predictor(ws, "X2")).toBeChecked();
    await expect(predictor(ws, "X3")).not.toBeChecked();
    await expect(ws.getByTestId("driver-report").getByRole("button", { name: "Remove from findings" })).toBeVisible();

    // 3. Out of use and posted again: still one analysis and the same findings.
    await ws.getByTestId("driver-report").getByRole("button", { name: "Remove from findings" }).click();
    await expect.poll(async () => (await counts()).findings, { timeout: 60_000 }).toBe(0);
    await ws.getByTestId("driver-report").getByRole("button", { name: "Post to findings" }).click();
    await expect.poll(async () => (await counts()).findings, { timeout: 60_000 }).toBe(first.findings);
    expect((await counts()).analyses).toBe(1);
  } finally {
    await db.end();
  }
});
