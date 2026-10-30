// Where a project opens (Grant, 27 October 2026): always on its overview, whichever section was used last,
// in a real browser on the disposable stack. A reload of the page stays where you were; a dashboard link
// naming a section opens that section.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;

test.use({ viewport: { width: 1440, height: 1000 } });

test("a project opens on its overview; a reload stays put; a section link opens its section", async ({ page }, testInfo) => {
  test.setTimeout(3 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `opens-overview-${Date.now()}` });

  await page.goto(run.url, { waitUntil: "networkidle" });
  const overview = page.getByTestId("project-overview");
  await expect(overview).toBeVisible({ timeout: 60_000 });
  await expect(overview.getByTestId("project-overview-stage")).toHaveCount(4);
  if (SHOT) await page.screenshot({ path: SHOT });

  // Into a stage, then a reload of this page keeps it.
  await overview.getByTestId("project-overview-stage").filter({ hasText: "Analyse" }).click();
  await expect(page.getByRole("button", { name: /^Analyse overview/ }).first()).toHaveAttribute("aria-current", "page");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: /^Analyse overview/ }).first()).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("project-overview")).toBeHidden();

  // Opened again from the dashboard: the overview, not the section used last.
  await page.goto(`${target.appUrl}/`, { waitUntil: "networkidle" });
  await page.locator(`a[href="/runs/${run.id}"]`).first().click();
  await expect(page.getByTestId("project-overview")).toBeVisible({ timeout: 60_000 });

  // A link naming a section opens it.
  await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: /^Import data/ }).first()).toHaveAttribute("aria-current", "page");
});
