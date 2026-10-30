// Waves of one tracking study in one project (Grant, 27 October 2026), in a real browser on the disposable
// stack: three wave files uploaded out of order, labelled with their wave and fieldwork month under Import
// data, one left out. Wave tracking lists the included waves in fieldwork order, says so, and names the
// wave left out; Cross tabs lists each file with its wave and opens the latest.
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;

test.use({ viewport: { width: 1600, height: 1000 } });

test("waves are ordered by fieldwork, one can be left out, and Cross tabs opens the latest", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "waves-"));
  const rows = (seed) => Array.from({ length: 40 }, (_, i) => `${i + 1},${((i + seed) % 3) + 1},${((i * 7 + seed) % 11)}`).join("\n");
  const files = [
    { name: "tracker-w3.csv", wave: "Wave 3", month: "2026-09" },
    { name: "tracker-w1.csv", wave: "Wave 1", month: "2026-03" },
    { name: "tracker-w2.csv", wave: "Wave 2", month: "2026-06", exclude: true },
  ];
  for (const [i, f] of files.entries()) writeFileSync(path.join(dir, f.name), `ID,Region,NPS\n${rows(i)}\n`);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `waves-${Date.now()}` });
  for (const f of files) await ui.upload(run, path.join(dir, f.name), "table");

  await page.goto(run.url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Import data/ }).first().click();
  for (const f of files) {
    const setup = await openSource(page, f.name, "Setup");
    const wave = setup.getByLabel(`Wave: ${f.name}`);
    await wave.fill(f.wave);
    await wave.blur();
    const month = setup.getByLabel(`Fieldwork month: ${f.name}`);
    await expect(month).toBeVisible({ timeout: 30_000 });
    await month.fill(f.month);
    if (f.exclude) await setup.getByLabel(`Include in wave tracking: ${f.name}`).uncheck();
    // The form says when its edits have been answered (R3e1): wait for that, with no error, before moving on. Before,
    // "networkidle" had already been reached and returned at once, so the page was reloaded with Wave 2's month and
    // exclusion still on their way (Codex's E1R receipt).
    const status = setup.getByTestId("setup-save-status").filter({ visible: true });
    await expect(status).toHaveAttribute("data-saving", "false", { timeout: 60_000 });
    await expect(setup.getByTestId("setup-save-error").filter({ visible: true })).toHaveCount(0);
    if (f.exclude && SHOT) await setup.screenshot({ path: SHOT.replace(".png", "-setup.png") });
  }

  // What was saved reads back after a reload: one reload, no retry, so a lost save fails here.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Import data/ }).first().click();
  for (const f of files) {
    const setup = await openSource(page, f.name, "Setup");
    await expect(setup.getByLabel(`Wave: ${f.name}`)).toHaveValue(f.wave);
    await expect(setup.getByLabel(`Fieldwork month: ${f.name}`)).toHaveValue(f.month);
    await expect(setup.getByLabel(`Include in wave tracking: ${f.name}`)).toBeChecked({ checked: !f.exclude });
  }
  await page.getByRole("button", { name: /^Analytics/ }).first().click();
  const section = page.getByTestId("analytics-section").filter({ visible: true });
  await section.getByRole("list", { name: "Analyses" }).getByRole("button", { name: /^Wave tracking/ }).click();
  const workspace = page.getByRole("dialog", { name: "Analytics workspace" });
  await expect(workspace.getByTestId("wave-order")).toHaveText("Waves in order of fieldwork date.", { timeout: 60_000 });
  await expect(workspace.getByTestId("wave-list")).toContainText("1. Wave 1 (tracker-w1.csv, fieldwork 2026-03)");
  await expect(workspace.getByTestId("wave-list")).toContainText("2. Wave 3 (tracker-w3.csv, fieldwork 2026-09)");
  await expect(workspace.getByTestId("wave-excluded")).toContainText("Wave 2 (tracker-w2.csv)");
  if (SHOT) await workspace.screenshot({ path: SHOT });
  await workspace.getByRole("button", { name: /All analytics|Close/ }).first().click();

  // Cross tabs: each file with its wave; the latest wave opens first.
  await page.getByRole("button", { name: /^Cross tabs(\s*\d+)?$/ }).first().click();
  const picker = page.getByRole("combobox", { name: /data file/i }).filter({ visible: true }).first();
  await expect(picker.locator("option", { hasText: "Wave 1: tracker-w1.csv" })).toHaveCount(1);
  await expect(picker).toHaveValue(await picker.locator("option", { hasText: "Wave 3: tracker-w3.csv" }).getAttribute("value"));
});
