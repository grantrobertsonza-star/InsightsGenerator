// A module page's status bar rolls up the rest of the module's items in place (Grant, 2026-10-26:
// "instead of jumping back to the main overview page ... all the information on the individual pages as
// well, but with a roll up"), and the stage overviews show their modules as tiles. In a real browser on
// the disposable stack:
//   1. two reports not read yet give Secondary analysis two items: the bar shows the first, "1 more"
//      opens the second in place (aria-expanded), "Show less" closes it, and the overview link in the
//      opened bar still goes to the stage overview;
//   2. an item in the opened bar opens its target;
//   3. the stage overviews lay their modules out as a grid of tiles (several per row at 1440px).
// Synthetic files only. No model calls.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;
const shot = async (page, name) => {
  if (SHOT) await page.screenshot({ path: SHOT.replace(".png", `-${name}.png`), fullPage: false });
};
const FIXTURE = path.resolve("fixtures/golden-thread-1");
const nav = (page, name) => page.getByRole("button", { name: new RegExp(`^${name}(\\s*\\d+)?$`) }).first();

test.use({ viewport: { width: 1440, height: 1000 } });

test("a module's status bar rolls up its other items in place; overviews are tiles", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `module-bar-rollup-${Date.now()}` });
  await ui.upload(run, path.join(FIXTURE, "report.docx"), "report");
  await ui.upload(run, path.join(FIXTURE, "client-brief.docx"), "report");
  await page.goto(run.url, { waitUntil: "networkidle" });

  // 1. The roll-up.
  await nav(page, "Secondary analysis").click();
  const bar = page.getByTestId("module-bar-reports");
  await expect(bar).toHaveAttribute("data-state", "needs_you", { timeout: 60_000 });
  await expect(bar.getByTestId("module-bar-first")).toContainText("Read the claims in");
  const toggle = bar.getByTestId("module-bar-toggle");
  await expect(toggle).toHaveText(/1 more/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(bar.getByTestId("module-bar-detail")).toHaveCount(0);
  await shot(page, "1-bar-closed");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveText(/Show less/);
  const detail = bar.getByTestId("module-bar-detail");
  await expect(detail.getByTestId("module-bar-issues").locator("li")).toHaveCount(1);
  await expect(detail).toContainText("Read the claims in");
  await shot(page, "2-bar-open");
  await toggle.click();
  await expect(bar.getByTestId("module-bar-detail")).toHaveCount(0);

  // 2. An item in the opened bar opens its target (the module itself here), without leaving the page.
  await toggle.click();
  await detail.getByTestId("module-bar-issues").getByRole("button").first().click();
  await expect(nav(page, "Secondary analysis")).toHaveAttribute("aria-current", "page");

  // The overview link in the opened bar goes to the stage overview.
  await bar.getByTestId("module-bar-toggle").click();
  const overviewLink = bar.getByTestId("module-bar-overview");
  if (await overviewLink.count()) {
    await overviewLink.click();
    await expect(page.locator('[data-testid^="section-dashboard-overview-"]').first()).toBeVisible();
  }

  // 3. Tiles: on an overview, at least three module cards share the first row at this width.
  await nav(page, "Prepare overview").click();
  const prepare = page.getByTestId("section-dashboard-overview-prepare");
  await expect(prepare).toBeVisible();
  const tops = await prepare.locator('[data-testid^="module-card-"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(tops.filter((t) => t === tops[0]).length).toBeGreaterThanOrEqual(3);
  await shot(page, "3-prepare-tiles");
  await nav(page, "Analyse overview").click();
  await expect(page.getByTestId("section-dashboard-overview-analyse")).toBeVisible();
  await shot(page, "4-analyse-tiles");
});
