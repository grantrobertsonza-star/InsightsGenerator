// The project menu's grouping (Grant's sidebar, 2026-10-19; on this copy 2026-10-20 in its existing
// style, without the two-letter codes or the global-link changes). Real browser on the disposable stack.
//   2. A project's menu: current-project switcher, then Prepare, Analyse, Develop findings, Deliver
//      and Tools, in that order.
//   3. Objectives is one entry with Set and Review tabs; it stays highlighted on either tab.
//   4. Cross tabs shows a data file's Crosstabs tile only; Analytics shows the analyses without it.
//   5. Each group rolls up from its heading (mouse and keyboard), stays rolled up after a reload,
//      and hides all its entries; the heading of a rolled-up group holding the open section is marked.
//   6. The switcher opens another project.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openSection } from "./helpers/nav.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FIXTURE = path.resolve("fixtures/golden-thread-1");

test.use({ viewport: { width: 1600, height: 1000 } });

test("the sidebar's stages, Objectives tabs, split Cross tabs and Analytics, and project switcher", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const other = await ui.createRun({ name: `sidebar-other-${Date.now()}` });
  const run = await ui.createRun({ name: `sidebar-${Date.now()}` });
  await ui.upload(run, path.join(FIXTURE, "golden-survey-documented.xlsx"), "table");

  // 2. Groups in order.
  const menu = page.locator("#run-nav-slot");
  await expect(menu.getByLabel("Current project")).toHaveValue(run.id);
  expect(await menu.getByRole("group").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual(["Prepare", "Analyse", "Develop findings", "Deliver", "Tools"]);
  const labels = await menu.locator("[data-nav-label]").allInnerTexts();
  // Each stage opens with its overview (Grant, 2026-10-23).
  expect(labels.slice(0, 16)).toEqual(["Prepare overview", "Import data", "Research quality", "Objectives", "Business decisions", "Analyse overview", "Cross tabs", "Analytics", "Coding", "Secondary analysis", "Develop overview", "Findings", "Insights", "Deliver overview", "Recommendations", "Insights report"]);

  // 3. Objectives: one entry, two tabs, highlighted on both.
  const objectives = menu.getByRole("button", { name: /^Objectives$/ });
  // One Objectives page (2026-10-22): the context form and the review on the same page.
  await openSection(page, "Set Objectives");
  await expect(objectives).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Objectives", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Objective and context" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Objective detail" })).toBeVisible();

  // 4. Cross tabs opens its workspace directly; Analytics has its own tiles.
  await openSection(page, /^Cross tabs/);
  await expect(page.getByTestId("crosstab-workspace").filter({ visible: true }).getByRole("button", { name: /Add table to set/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: /^Driver analysis/ })).toHaveCount(0);
  await openSection(page, /^Analytics/);
  await expect(page.getByRole("button", { name: /^Driver analysis/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: /^Net Promoter Score/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Crosstabs/ })).toHaveCount(0);

  // 5. Each group rolls up from its heading (Grant, 2026-10-22), is remembered after a reload, and
  //    a rolled-up group still shows the open section.
  const toggle = (name) => menu.getByRole("group", { name }).getByTestId("run-nav-group-toggle");
  await expect(toggle("Analyse")).toHaveAttribute("aria-expanded", "true");
  await toggle("Develop findings").click();
  await expect(toggle("Develop findings")).toHaveAttribute("aria-expanded", "false");
  await expect(menu.getByRole("button", { name: /^Findings/ })).toHaveCount(0);
  await expect(menu.getByRole("button", { name: /^Insights\s*\d*$/ })).toHaveCount(0);
  // Analytics is open: rolling up Analyse hides it too, and the heading is marked as holding it.
  await toggle("Analyse").click();
  await expect(menu.getByRole("group", { name: "Analyse" }).locator("[data-nav-label]")).toHaveCount(0);
  await expect(toggle("Analyse")).toHaveAttribute("data-holds-open", "true");
  await expect(toggle("Develop findings")).not.toHaveAttribute("data-holds-open", "true");
  await page.reload({ waitUntil: "networkidle" });
  await expect(toggle("Develop findings")).toHaveAttribute("aria-expanded", "false");
  await expect(menu.getByRole("button", { name: /^Findings/ })).toHaveCount(0);
  if (process.env.SHOT) await page.locator("#run-nav-slot").screenshot({ path: process.env.SHOT.replace(".png", "-sidebar-folded.png") });
  // Keyboard: the heading is a button.
  await toggle("Develop findings").focus();
  await page.keyboard.press("Enter");
  await expect(toggle("Develop findings")).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("button", { name: /^Findings/ })).toBeVisible();
  await toggle("Analyse").click();
  await expect(menu.getByRole("button", { name: /^Cross tabs/ })).toBeVisible();

  // 6. Switch project.
  await menu.getByLabel("Current project").selectOption(other.id);
  await page.waitForURL(`**/runs/${other.id}`, { timeout: 60_000 });
  await expect(page.locator("#run-nav-slot").getByLabel("Current project")).toHaveValue(other.id);
});
