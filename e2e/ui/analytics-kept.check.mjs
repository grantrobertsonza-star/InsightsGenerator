// The Analytics workspace keeps its results (Grant, 2026-10-21: "When I do a driver or NPS or other
// analysis and go out and come back in it is gone"), and every chart kind tiles in one grid (a
// scatter used to sit alone, full width, above the chart cards). In a real browser on the
// disposable stack, on a seeded file A and a second file B:
//   1. A bar chart, then a scatter, then a line chart: one grid, newest first, equal widths at 1440px.
//   2. A driver analysis run and posted (so saved).
//   3. Leaving the section and coming back, and a reload: the three cards come back in the same
//      order and the driver result reopens; nothing is posted again.
//   4. File B shows none of file A's cards; back on file A they return.
//   5. Clear one: the driver result and the scatter leave the workspace; the saved analysis stays in
//      Saved analyses and the posted findings stay. Clear all: nothing comes back after a reload.
//   6. Storage blocked: building a chart still works, and the workspace says results will not be kept.
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

test("analytics results are kept per file until cleared, and every chart kind tiles in one grid", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `analytics-kept-${Date.now()}` });
    const dir = mkdtempSync(path.join(tmpdir(), "analytics-kept-"));
    let seed = 13;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const rowsA = ["id,Y,X1,X2,X3,EASE,TRUST,Q1,AGE"];
    for (let i = 1; i <= 120; i++) {
      const x1 = 1 + Math.floor(rnd() * 5), x2 = 1 + Math.floor(rnd() * 5), x3 = 1 + Math.floor(rnd() * 5);
      const y = Math.min(10, Math.max(0, Math.round(x1 + 0.6 * x2 + rnd() * 2)));
      const ease = 1 + Math.floor(rnd() * 5);
      const trust = Math.min(5, Math.max(1, ease + Math.round(rnd() * 2 - 1)));
      rowsA.push(`${i},${y},${x1},${x2},${x3},${ease},${trust},${1 + Math.floor(rnd() * 3)},${18 + Math.floor(rnd() * 60)}`);
    }
    const fileA = path.join(dir, "kept-a.csv");
    writeFileSync(fileA, rowsA.join("\n") + "\n");
    const rowsB = ["id,Q1,AGE"];
    for (let i = 1; i <= 60; i++) rowsB.push(`${i},${1 + Math.floor(rnd() * 3)},${18 + Math.floor(rnd() * 60)}`);
    const fileB = path.join(dir, "kept-b.csv");
    writeFileSync(fileB, rowsB.join("\n") + "\n");
    await ui.upload(run, fileA, "table");
    await ui.upload(run, fileB, "table");

    const findings = async () => Number((await db.query("select count(*) from findings where run_id=$1 and status<>'rejected'", [run.id])).rows[0].count);
    const analyses = async () => Number((await db.query("select count(*) from driver_analyses where run_id=$1", [run.id])).rows[0].count);

    const section = (p = page) => p.getByTestId("analytics-section").filter({ visible: true });
    const toSection = async (p = page) => {
      await p.getByRole("button", { name: /^Analytics/ }).first().click();
      await expect(section(p).getByRole("list", { name: "Analyses" })).toBeVisible({ timeout: 60_000 });
    };
    const chooseFile = async (name, p = page) => {
      await section(p).getByTestId("analytics-file-select").selectOption({ label: name });
    };
    const openTool = async (tool, p = page) => {
      await section(p).getByRole("list", { name: "Analyses" }).getByRole("button", { name: new RegExp(`^${tool}`) }).click({ timeout: 60_000 });
      const ws = p.getByRole("dialog", { name: "Analytics workspace" });
      await expect(ws).toBeVisible();
      return ws;
    };
    const grid = (ws) => ws.getByTestId("analytics-card-grid");
    const kinds = async (ws) => grid(ws).locator(":scope > [data-card-kind]").evaluateAll((els) => els.map((e) => e.getAttribute("data-card-kind")));
    // Restored cards are rebuilt from the file; wait until none is still being worked out.
    const settled = async (ws) => expect(ws.getByTestId("analytics-restore-slot")).toHaveCount(0, { timeout: 60_000 });

    await page.goto(run.url, { waitUntil: "networkidle" });
    await toSection();
    await chooseFile("kept-a.csv");

    // 1. Bar, then scatter, then line: one grid, newest first, equal widths.
    let ws = await openTool("Charts");
    const chartType = (name) => ws.getByRole("radiogroup", { name: "Chart type" }).getByRole("radio", { name }).click({ timeout: 60_000 });
    await chartType("Bar");
    await ws.getByLabel("Chart question").selectOption("Q1");
    await ws.getByRole("button", { name: "Build chart" }).click();
    await expect(grid(ws).locator("[data-card-kind=bar]")).toHaveCount(1, { timeout: 60_000 });
    await chartType("Scatter");
    await ws.getByLabel("X axis variable").selectOption("EASE");
    await ws.getByLabel("Y axis variable").selectOption("TRUST");
    await ws.getByRole("button", { name: "Build scatter plot" }).click();
    await expect(grid(ws).getByTestId("scatter-card")).toHaveCount(1, { timeout: 60_000 });
    await chartType("Line");
    await ws.getByLabel("Chart question").selectOption("Q1");
    await ws.getByRole("button", { name: "Build chart" }).click();
    await expect(grid(ws).locator("[data-card-kind=line]")).toHaveCount(1, { timeout: 60_000 });
    await expect(ws.getByTestId("analytics-card-grid")).toHaveCount(1);
    expect(await kinds(ws)).toEqual(["line", "scatter", "bar"]);
    const widths = await grid(ws).locator(":scope > [data-card-kind]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(".png", "-1-grid.png") });
    // The title and colour controls are inside the chart they edit, not above the grid.
    await expect(ws.getByTestId("chart-customize")).toHaveCount(1);
    await expect(grid(ws).locator("[data-card-kind=line]").getByTestId("chart-customize")).toHaveCount(1);

    // 2. A driver analysis, run and posted (which saves it).
    await ws.getByRole("button", { name: "Driver analysis", exact: true }).click();
    await ws.getByLabel("Outcome variable").selectOption("Y");
    const predictor = (name) => ws.getByTestId("driver-predictor-list").locator("label", { hasText: new RegExp(`^${name}\\b`) }).locator("input[type=checkbox]");
    await predictor("X1").check();
    await predictor("X2").check();
    await ws.getByRole("button", { name: "Run driver analysis" }).click();
    await expect(ws.getByTestId("driver-report")).toBeVisible({ timeout: 2 * 60_000 });
    await ws.getByTestId("driver-report").getByRole("button", { name: "Post to findings" }).click();
    await expect.poll(findings, { timeout: 60_000 }).toBeGreaterThan(0);
    const posted = await findings();
    expect(await analyses()).toBe(1);

    const expectKept = async (w) => {
      await settled(w);
      expect(await kinds(w)).toEqual(["line", "scatter", "bar"]);
      await w.getByRole("button", { name: "Driver analysis", exact: true }).click();
      await expect(w.getByTestId("driver-report")).toBeVisible({ timeout: 2 * 60_000 });
      await expect(w.getByTestId("driver-report").getByRole("button", { name: "Remove from findings" })).toBeVisible({ timeout: 30_000 });
      await w.getByRole("button", { name: "Charts", exact: true }).click();
      expect(await findings()).toBe(posted); // restoring posts nothing
      expect(await analyses()).toBe(1); // and saves nothing
    };

    // 3a. Leave the workspace and the section, and come back.
    await ws.getByRole("button", { name: "← All analytics" }).click();
    await page.getByRole("button", { name: /^Findings/ }).first().click();
    await toSection();
    await chooseFile("kept-a.csv");
    ws = await openTool("Charts");
    await expectKept(ws);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(".png", "-2-came-back.png") });
    // 3b. A reload.
    await page.reload({ waitUntil: "networkidle" });
    await toSection();
    await chooseFile("kept-a.csv");
    ws = await openTool("Charts");
    await expectKept(ws);

    // 4. File B has none of file A's cards; back on file A they return.
    await ws.getByRole("button", { name: "← All analytics" }).click();
    await chooseFile("kept-b.csv");
    ws = await openTool("Charts");
    await expect(ws.getByTestId("analytics-card-grid")).toHaveCount(0);
    await expect(ws.getByTestId("analytics-kept-bar")).toHaveCount(0);
    await ws.getByRole("button", { name: "← All analytics" }).click();
    await chooseFile("kept-a.csv");
    ws = await openTool("Charts");
    await settled(ws);
    expect(await kinds(ws)).toEqual(["line", "scatter", "bar"]);

    // 5a. Clear one: the scatter, and the driver result.
    await grid(ws).getByTestId("scatter-card").getByRole("button", { name: "Clear this scatter plot" }).click();
    expect(await kinds(ws)).toEqual(["line", "bar"]);
    await ws.getByRole("button", { name: "Driver analysis", exact: true }).click();
    await expect(ws.getByTestId("driver-clear")).toHaveAttribute("title", /saved analysis stays in Saved analyses/);
    await ws.getByTestId("driver-clear").click();
    await expect(ws.getByTestId("driver-report")).toHaveCount(0);
    await expect(ws.getByRole("button", { name: /^Drivers of / }).filter({ visible: true })).toHaveCount(1);
    expect(await analyses()).toBe(1);
    expect(await findings()).toBe(posted);
    await page.reload({ waitUntil: "networkidle" });
    await toSection();
    await chooseFile("kept-a.csv");
    ws = await openTool("Charts");
    await settled(ws);
    expect(await kinds(ws)).toEqual(["line", "bar"]);
    await ws.getByRole("button", { name: "Driver analysis", exact: true }).click();
    await expect(ws.getByTestId("driver-report")).toHaveCount(0);
    await expect(ws.getByRole("button", { name: /^Drivers of / }).filter({ visible: true })).toHaveCount(1);

    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(".png", "-3-after-clear.png") });
    // 5b. Clear all.
    await ws.getByTestId("analytics-clear-all").click();
    await ws.getByRole("button", { name: "Charts", exact: true }).click();
    await expect(ws.getByTestId("analytics-card-grid")).toHaveCount(0);
    await page.reload({ waitUntil: "networkidle" });
    await toSection();
    await chooseFile("kept-a.csv");
    ws = await openTool("Charts");
    await expect(ws.getByTestId("analytics-card-grid")).toHaveCount(0);
    const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("insights:analytics-workspace:")));
    expect(stored).toEqual([]);
    expect(await analyses()).toBe(1);
    expect(await findings()).toBe(posted);

    // 6. Storage blocked: the workspace still builds a chart and says it will not be kept.
    const blocked = await page.context().newPage();
    await blocked.addInitScript(() => {
      const thrower = () => {
        throw new Error("storage blocked (test)");
      };
      Object.defineProperty(window, "localStorage", { configurable: true, get: thrower });
    });
    await blocked.goto(run.url, { waitUntil: "networkidle" });
    await toSection(blocked);
    await chooseFile("kept-a.csv", blocked);
    const bws = await openTool("Charts", blocked);
    await expect(bws.getByTestId("analytics-kept-bar")).toContainText("will not be kept");
    await bws.getByRole("radiogroup", { name: "Chart type" }).getByRole("radio", { name: "Bar" }).click({ timeout: 60_000 });
    await bws.getByLabel("Chart question").selectOption("Q1");
    await bws.getByRole("button", { name: "Build chart" }).click();
    await expect(bws.getByTestId("analytics-card-grid").locator("[data-card-kind=bar]")).toHaveCount(1, { timeout: 60_000 });
    await bws.getByRole("button", { name: "Clear this chart" }).click();
    await expect(bws.getByTestId("analytics-card-grid")).toHaveCount(0);
    await blocked.close();
  } finally {
    await db.end();
  }
});
