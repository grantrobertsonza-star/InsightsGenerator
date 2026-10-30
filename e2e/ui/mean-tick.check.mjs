// The Mean tick (batch 48, Grant 27 October 2026: "add Mean to the Show in each cell list"). Real browser
// against the disposable local stack. An SPSS file: Satisfaction on a labelled 1 to 5 scale with "Don't
// know" = 9 (a rating scale, a single choice question), and Channel (labelled codes, not a scale), split by
// Segment. (A plain 0 to 10 number column is read by StarterTabs as a number question, which already has its
// own Average row, so it gets no second mean.)
//   1. Mean is ticked by default in the table settings; the built table has a "Mean" row first under the
//      rating, and none under the contact method, which is named under the table.
//   2. Unticking Mean on the built table hides the row; the Excel, PowerPoint and PDF links then carry
//      mean=0, so the exports leave it out too. Ticking it again brings the row back.
//   3. The setting is saved with the table: after a reload the row is still there.
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { openCrosstabs, showTables } from "./helpers/crosstabs.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

const SCRIPT = String.raw`
import sys, pandas as pd, pyreadstat
n = 300
seg = [float(i % 3 + 1) for i in range(n)]
sat = [float(9 if i % 20 == 0 else min(5, (i * 7) % 5 + 1 + (1 if seg[i] == 1.0 and i % 2 == 0 else 0))) for i in range(n)]
channel = [float((i * 11) % 3 + 1) for i in range(n)]
labels = {"Segment": {1.0: "Segment1", 2.0: "Segment2", 3.0: "Segment3"},
          "Satisfaction": {1.0: "Very dissatisfied", 2.0: "Dissatisfied", 3.0: "Neither", 4.0: "Satisfied", 5.0: "Very satisfied", 9.0: "Don't know"},
          "Channel": {1.0: "Phone", 2.0: "App", 3.0: "Web"}}
pyreadstat.write_sav(pd.DataFrame({"Segment": seg, "Satisfaction": sat, "Channel": channel}), sys.argv[1], variable_value_labels=labels)
`;

test.use({ viewport: { width: 1600, height: 1000 } });

test("Mean is on by default, adds a mean row above a rating scale, names the rest, and can be hidden", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  page.setDefaultTimeout(30_000);
  const dir = mkdtempSync(path.join(tmpdir(), "mean-tick-"));
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `mean-tick-${Date.now()}` });
    const file = path.join(dir, "mean-tick.sav");
    execFileSync("python3", ["-I", "-c", SCRIPT, file]);
    await ui.upload(run, file, "table");

    await page.goto(run.url, { waitUntil: "networkidle" });
    let ws = await openCrosstabs(page, "mean-tick.sav");
    await ws.getByRole("button", { name: "StarterTabs" }).click();
    await ws.getByRole("button", { name: "Build starter tables" }).click();
    const expandAll = async () => {
      const collapsed = ws.getByRole("button", { name: /^▸ / });
      for (let i = (await collapsed.count()) - 1; i >= 0; i--) await collapsed.nth(i).click().catch(() => {});
    };
    const table = ws.locator('table[data-testid="crosstab-result-table"]').first();
    await expect.poll(async () => (await expandAll(), table.count()), { timeout: 120_000, message: "the starter table did not appear" }).toBeGreaterThan(0);

    // 1. The Mean row is the first row under the rating's bases; the contact method has none and is named.
    const ratingRows = table.locator("tbody tr").filter({ hasText: /^\s*(×\s*)?Mean(?!\s*score)/ });
    await expect(ratingRows.first()).toBeVisible();
    await expect(ws.getByTestId("crosstab-mean-not-added").first()).toContainText("No mean row for Channel");
    if (process.env.SHOT) await ws.screenshot({ path: process.env.SHOT.replace(".png", "-mean-row.png") });
    if (process.env.SHOT) await table.screenshot({ path: process.env.SHOT.replace(".png", "-mean-table.png") });

    // 2. Unticking hides the row and carries mean=0 to every export link; ticking brings it back.
    const tick = ws.getByTestId("crosstab-mean-tick").first();
    await expect(tick).toBeChecked();
    await tick.uncheck();
    await expect(table.locator("tbody tr").filter({ hasText: /^\s*(×\s*)?Mean(?!\s*score)/ })).toHaveCount(0);
    for (const name of ["Download Excel", "PowerPoint", "PDF"]) {
      await expect(ws.getByRole("link", { name, exact: true }).first()).toHaveAttribute("href", /mean=0/);
    }
    if (process.env.SHOT) await ws.screenshot({ path: process.env.SHOT.replace(".png", "-mean-hidden.png") });
    await tick.check();
    await expect(ratingRows.first()).toBeVisible();
    await expect(ws.getByRole("link", { name: "Download Excel", exact: true }).first()).not.toHaveAttribute("href", /mean=0/);

    // 3. Saved with the table: still there after a reload.
    await page.reload({ waitUntil: "networkidle" });
    ws = await openCrosstabs(page, "mean-tick.sav");
    // Cross tabs opens on CrossTabs; the starter table is listed under StarterTabs.
    await ws.getByRole("button", { name: "StarterTabs" }).click();
    await showTables(ws);
    await expect.poll(async () => (await expandAll(), table.count()), { timeout: 60_000 }).toBeGreaterThan(0);
    await expect(ws.locator('table[data-testid="crosstab-result-table"]').first().locator("tbody tr").filter({ hasText: /^\s*(×\s*)?Mean(?!\s*score)/ }).first()).toBeVisible();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
