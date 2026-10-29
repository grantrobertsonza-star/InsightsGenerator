// A brief imported into a project with no business problem or objectives fills them when Objectives opens, without a
// click (Grant, 29 October 2026: "I imported a brief into the brand tracker, but objectives were not extracted
// automatically"); opening Objectives again does not fill again. Real browser against the disposable local stack; the
// model replay is scripted through the stack's model-fixture.json. Synthetic data only.
import { expect, test } from "@playwright/test";
import { openSection } from "./helpers/nav.mjs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const fixtureFile = path.join(path.dirname(path.resolve(manifestPath)), "model-fixture.json");
const SHOT = process.env.SHOT;

test.afterEach(() => writeFileSync(fixtureFile, JSON.stringify({})));

test("an imported brief fills an empty project's business problem and objectives when Objectives opens, once", async ({ page }, testInfo) => {
  test.setTimeout(5 * 60_000);
  const marker = `AUTO-BRIEF-${Date.now()}`;
  writeFileSync(fixtureFile, JSON.stringify({ tools: { record_brief_fields: [{ match: marker, input: { business_problem: "BMW consideration is falling among younger premium buyers.", research_objective: "Measure consideration of BMW against Audi and Mercedes by age" } }] } }));
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `auto-brief-${Date.now()}` });
  const dir = mkdtempSync(path.join(os.tmpdir(), "auto-brief-"));
  const file = path.join(dir, "BMW_Research_Brief.txt");
  writeFileSync(file, `Brief ${marker}. BMW consideration is falling among younger premium buyers. Objective: measure consideration against Audi and Mercedes by age.`);
  await ui.upload(run, file, "brief");
  rmSync(dir, { recursive: true, force: true });

  await openSection(page, "Set Objectives");
  await expect(page.getByText("Measure consideration of BMW against Audi and Mercedes by age", { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('textarea[name="businessProblem"]')).toHaveValue("BMW consideration is falling among younger premium buyers.");
  await expect(page.getByTestId("brief-last-fill")).toContainText("BMW_Research_Brief.txt");
  if (SHOT) await page.screenshot({ path: SHOT });

  // Again: the project now has objectives and a fill, so nothing is read again.
  const client = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await client.connect();
  try {
    const fills = async () => Number((await client.query("select count(*) from trace where run_id = $1 and event = 'brief_intake_used'", [run.id])).rows[0].count);
    const before = await fills();
    await page.reload({ waitUntil: "networkidle" });
    await openSection(page, "Set Objectives");
    await expect(page.getByTestId("brief-auto-fill")).toHaveCount(0);
    await page.waitForTimeout(2_000);
    expect(await fills()).toBe(before);
  } finally {
    await client.end();
  }
});
