// Section dashboards and the main dashboard's project rows (Grant, 2026-10-23, prototype on 3001):
// each stage of the sidebar opens with an overview of its modules' states; an item's link opens the
// module at the exact item; the overview refreshes when opened again; the main dashboard shows each
// project's four stages and its next step, which opens the project at that module.
// Run against the disposable stack; with SHOT=<dir>/stage.png it also saves screenshots.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FIXTURE = path.resolve("fixtures/golden-thread-1");
const SHOT = process.env.SHOT;
const shot = async (page, name) => {
  if (SHOT) await page.screenshot({ path: SHOT.replace(".png", `-${name}.png`), fullPage: true });
};

test.use({ viewport: { width: 1440, height: 1000 } });

const nav = (page, name) => page.getByRole("button", { name: new RegExp(`^${name}(\\s*\\d+)?$`) }).first();

test("section dashboards: module states, linked items, refresh on reopening, and the main dashboard's project rows", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const name = `stage-status-${Date.now()}`;
  const run = await ui.createRun({ name });

  // A new project: Prepare asks for files, objectives and a decision; optional Research quality is not used.
  await nav(page, "Prepare overview").click();
  const prepare = page.getByTestId("section-dashboard-overview-prepare");
  await expect(prepare).toHaveAttribute("data-state", "needs_you");
  await expect(prepare.getByTestId("module-card-upload")).toHaveAttribute("data-state", "needs_you");
  await expect(prepare.getByTestId("module-card-upload")).toContainText("No files yet");
  await expect(prepare.getByTestId("module-card-research-quality")).toHaveAttribute("data-state", "not_used");
  await shot(page, "1-prepare-new");

  // A data file is read and accepted on import; reopening the overview shows Import ready.
  await ui.upload(run, path.join(FIXTURE, "golden-survey-documented.xlsx"), "table");
  await expect.poll(async () => page.getByText("Accepted", { exact: true }).count(), { timeout: 3 * 60_000 }).toBeGreaterThan(0);
  await nav(page, "Prepare overview").click();
  await expect(prepare.getByTestId("module-card-upload")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(prepare.getByTestId("module-card-upload")).toContainText("1 file imported, all ready");
  await shot(page, "2-prepare-after-import");

  // An item's link opens the module at the item: no objectives yet opens Objectives.
  await prepare.getByTestId("module-card-objective").getByTestId("module-issues").getByRole("button").first().click();
  await expect(nav(page, "Objectives")).toHaveAttribute("aria-current", "page");
  // Each module page has its one-line status, from the same rule as the overview card.
  const objectiveBar = page.getByTestId("module-bar-objective");
  await expect(objectiveBar).toHaveAttribute("data-state", "needs_you");
  await expect(objectiveBar).toContainText("No objectives yet");
  await shot(page, "2b-objectives-bar");
  await nav(page, "Import data").click();
  await expect(page.getByTestId("module-bar-upload")).toHaveAttribute("data-state", "ready");
  await shot(page, "2c-import-bar");
  // Its "more on the overview" link returns to the stage's overview when there is more to see.
  await nav(page, "Business decisions").click();
  await expect(page.getByTestId("module-bar-decisions")).toHaveAttribute("data-state", "needs_you");

  // Each stage's overview is the first entry in its group (the group heading folds the group).
  await nav(page, "Analyse overview").click();
  const analyse = page.getByTestId("section-dashboard-overview-analyse");
  await expect(analyse).toBeVisible();
  const crosstabs = analyse.getByTestId("module-card-crosstabs");
  await expect(crosstabs).toHaveAttribute("data-state", "needs_you");
  await expect(crosstabs).toContainText("Build a table and commit it");
  await expect(analyse.getByTestId("module-card-coding")).toHaveAttribute("data-state", "not_used");
  await shot(page, "3-analyse");
  await crosstabs.getByTestId("module-issues").getByRole("button").first().click();
  await expect(nav(page, "Cross tabs")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("crosstabs-file-select").or(page.getByLabel("Data file")).first()).toBeVisible();

  await nav(page, "Develop overview").click();
  await expect(page.getByTestId("section-dashboard-overview-develop").getByTestId("module-card-findings")).toContainText("No findings yet");
  await shot(page, "4-develop");
  await nav(page, "Deliver overview").click();
  await expect(page.getByTestId("section-dashboard-overview-deliver").getByTestId("module-card-insights-report")).toContainText("No report yet");
  await shot(page, "5-deliver");

  // The main dashboard: the project's four stages and its next step, which opens that module.
  await page.goto(target.appUrl, { waitUntil: "networkidle" });
  const row = page.getByTestId("project-row").filter({ hasText: name });
  await expect(row.getByTestId("project-sections").locator("[data-state]")).toHaveCount(4);
  await expect(row).toHaveAttribute("data-state", "needs_you");
  const next = row.getByTestId("project-next");
  await expect(next).toContainText("Next: Objectives");
  await shot(page, "6-home");
  await next.click();
  await page.waitForURL(/\?section=objective/);
  await expect(nav(page, "Objectives")).toHaveAttribute("aria-current", "page");
});
