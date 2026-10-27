// Quick charts (Grant, 27 October 2026: "In StarterTabs when I click show chart, it only shows a chart for
// the first table"). Real browser against the disposable local stack. A starter set is one table holding
// many questions; Quick charts now draws one chart per single or multiple response question, in table
// order, and "Charts only" hides the figures table. The same file carries a "DontKnow" answer (run
// together, no space), which with non-answers excluded must not appear as a bar (batch 47 engine fix).
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openCrosstabs } from "./helpers/crosstabs.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

test.use({ viewport: { width: 1600, height: 1000 } });

test("Quick charts draws every question of a starter table, and Charts only hides the table", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  page.setDefaultTimeout(30_000);
  const dir = mkdtempSync(path.join(tmpdir(), "quick-charts-"));
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `quick-charts-${Date.now()}` });
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    const rows = ["RespondentID,Segment,Transferred,WaitTimeVsExpectation,UsedIVR"];
    for (let i = 1; i <= 300; i++) {
      rows.push(`R_${i},${pick(["Segment1", "Segment2", "Segment3"])},${pick(["Yes", "No"])},${pick(["Quicker", "JustAsLong", "Longer"])},${pick(["Yes", "No", "DontKnow"])}`);
    }
    const file = path.join(dir, "quick-charts.csv");
    writeFileSync(file, rows.join("\n") + "\n");
    await ui.upload(run, file, "table");

    await page.goto(run.url, { waitUntil: "networkidle" });
    const ws = await openCrosstabs(page, "quick-charts.csv");
    await ws.getByRole("button", { name: "StarterTabs" }).click();
    await ws.getByRole("button", { name: "Build starter tables" }).click();
    const table = ws.locator('table[data-testid="crosstab-result-table"]').first();
    await expect
      .poll(
        async () => {
          const collapsed = ws.getByRole("button", { name: /^▸ / });
          for (let i = (await collapsed.count()) - 1; i >= 0; i--) await collapsed.nth(i).click().catch(() => {});
          return table.count();
        },
        { timeout: 120_000, message: "the starter table did not appear" },
      )
      .toBeGreaterThan(0);
    const keys = JSON.parse(await table.getAttribute("data-question-keys"));
    expect(keys.length).toBeGreaterThanOrEqual(3);

    const toggle = ws.getByTestId("crosstab-chart-toggle").first();
    await expect(toggle).toHaveText("Quick charts");
    await toggle.click();
    const charts = ws.getByTestId("crosstab-quick-charts").first();
    const figures = charts.locator("figure[data-question-key]");
    // One chart per question, in table order (before batch 47 there was exactly one, for the first).
    await expect(figures).toHaveCount(keys.length);
    expect(await figures.evaluateAll((fs) => fs.map((f) => f.getAttribute("data-question-key")))).toEqual(keys);
    // The run-together "DontKnow" answer is a non-answer, so it is not a bar on any chart.
    await expect(charts).not.toContainText("DontKnow");
    await expect(table).toBeVisible();
    if (process.env.SHOT) await ws.screenshot({ path: process.env.SHOT.replace(".png", "-quick-charts.png") });

    // Charts only: the figures table is hidden, the charts stay; unticking brings the table back.
    await ws.getByTestId("crosstab-charts-only").first().check();
    await expect(table).toBeHidden();
    await expect(figures).toHaveCount(keys.length);
    if (process.env.SHOT) await ws.screenshot({ path: process.env.SHOT.replace(".png", "-charts-only.png") });
    await ws.getByTestId("crosstab-charts-only").first().uncheck();
    await expect(table).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveText("Quick charts");
    await expect(ws.getByTestId("crosstab-quick-charts")).toHaveCount(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
