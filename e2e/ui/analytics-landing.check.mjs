// The Analytics landing (Grant's review, 2026-10-20), in a real browser on the disposable stack:
//   1. One header with the data file chooser; every working analysis is a card in the grid.
//   2. Wave tracking is listed with the reason it cannot run (one file, not labelled as a wave);
//      Clustering is set apart under "Not available yet".
//   3. An analysis opens its own workspace on the chosen file; "All analytics" comes back to the grid.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FIXTURE = path.resolve("fixtures/golden-thread-1");

test.use({ viewport: { width: 1440, height: 900 } });

test("Analytics: file chooser, tool grid, unavailable tools set apart, All analytics returns", async ({ page }, testInfo) => {
  test.setTimeout(5 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `analytics-landing-${Date.now()}` });
  await ui.upload(run, path.join(FIXTURE, "golden-survey-documented.xlsx"), "table");
  await page.goto(run.url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Analytics/ }).first().click();
  const section = page.getByTestId("analytics-section").filter({ visible: true });

  // 1. Header and grid.
  await expect(section.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(section.getByTestId("analytics-file-select")).toContainText("golden-survey-documented.xlsx");
  const grid = section.getByRole("list", { name: "Analyses" });
  for (const name of ["Driver analysis", "Net Promoter Score", "Charts", "Wave tracking", "CSM Analytics", "Brand Health Analytics"]) {
    await expect(grid.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
  }

  // 2. Wave tracking says why it cannot run; Clustering is not offered as a tool.
  const wave = grid.getByRole("button", { name: /^Wave tracking/ });
  await expect(wave).toBeDisabled();
  await expect(wave).toContainText("Needs two or more data files labelled as waves");
  await expect(grid.getByRole("button", { name: /^Clustering/ })).toHaveCount(0);
  await expect(section.getByRole("region", { name: "Not available yet" })).toContainText("Clustering");

  // 3. Open an analysis and come back.
  await grid.getByRole("button", { name: /^Net Promoter Score/ }).click();
  const workspace = page.getByRole("dialog", { name: "Analytics workspace" });
  await expect(workspace).toBeVisible();
  await workspace.getByRole("button", { name: "← All analytics" }).click();
  await expect(workspace).toHaveCount(0);
  await expect(grid).toBeVisible();
});
