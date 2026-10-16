// Not picked up by `npm run e2e:smoke` (testMatch *.spec.mjs). Run it on its own with
//   npx playwright test -c e2e/adapter/adapter-check.config.mjs
// (same GOLDEN_SMOKE_TARGET_MANIFEST and GOLDEN_SMOKE_ADAPTER as the smoke).
// App-owned readiness check for Codex's Task B (not Codex's specification): the adapter reads
// raw-code statistics from what the app renders, compared with Codex's INDEPENDENT expected values
// (application-ready-v2/expected.json), consumed as delivered. Nothing is recalculated here.
// Runs only when that fixture folder is present; replay/local stack as for the golden-thread smoke.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FIXTURE_DIR = path.resolve(process.env.TASK_B_FIXTURE_DIR ?? "scripts/golden-thread-hardening/supplemental/application-ready-v2");
const present = fs.existsSync(path.join(FIXTURE_DIR, "expected.json"));

test.skip(!present, `Task B fixtures not found at ${FIXTURE_DIR}`);

test("raw-code statistics read through the app match Codex's selected references", async ({ page }, testInfo) => {
  const target = JSON.parse(fs.readFileSync(process.env.GOLDEN_SMOKE_TARGET_MANIFEST, "utf8"));
  testInfo.annotations.push({ type: "evidence-level", description: "Implementer readiness check against a disposable stack; not Codex's Task B" });
  const adapter = await import(pathToFileURL(path.resolve(process.env.GOLDEN_SMOKE_ADAPTER)).href);
  const ui = await adapter.bind({ page, target, testInfo });
  const expected = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "expected.json"), "utf8"));
  const run = await ui.createRun({ name: `task-b-readiness-${Date.now()}` });
  await ui.upload(run, path.join(FIXTURE_DIR, expected.selectedInput), "table");
  for (const a of expected.selectedAssertions) {
    const table = await ui.buildTable(run, { row: a.canonicalVariable });
    const value = await ui.readStatistic(table, {
      variable: a.canonicalVariable,
      rawCodes: a.rawCategoryCodes,
      statistic: a.statistic,
      segment: a.segment,
    });
    expect(Math.abs(value - a.expectedValue), `${a.id}: app ${value} vs reference ${a.expectedValue}`).toBeLessThanOrEqual(a.tolerance.value);
  }
});

// Adapter mechanics on the golden-thread fixture (no new reference values: the numbers are read,
// never judged here; Codex's references decide correctness):
//   - a numeric variable's mean is read from its own result table, which nests a
//     descriptive-statistics table (the nested table used to be picked instead of the result)
//   - a subgroup read uses the banner column found by its raw code; a code with no column, and a
//     segment on a variable that is not the table's banner, are refused rather than answered with
//     the overall value
//   - counted section navigation ("Analytics1") works without a whitespace workaround
const GOLDEN = path.resolve("fixtures/golden-thread-1/golden-survey-documented.xlsx");
test("adapter mechanics: nested-statistics mean, subgroup read by raw code, refusals", async ({ page }, testInfo) => {
  test.skip(!fs.existsSync(GOLDEN), `golden fixture not found at ${GOLDEN}`);
  const target = JSON.parse(fs.readFileSync(process.env.GOLDEN_SMOKE_TARGET_MANIFEST, "utf8"));
  testInfo.annotations.push({ type: "evidence-level", description: "Implementer readiness check of adapter mechanics; values are not judged here" });
  const adapter = await import(pathToFileURL(path.resolve(process.env.GOLDEN_SMOKE_ADAPTER)).href);
  const ui = await adapter.bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `adapter-mechanics-${Date.now()}` });
  await ui.upload(run, GOLDEN, "table");

  const recommend = await ui.buildTable(run, { row: "Recommend" });
  const mean = await ui.readStatistic(recommend, { variable: "Recommend", statistic: "mean" });
  expect(Number.isFinite(mean)).toBe(true);

  const byGender = await ui.buildTable(run, { row: "Purchase", column: "Gender" });
  const overall = await ui.readStatistic(byGender, { variable: "Purchase", rawCode: "Yes", statistic: "selection_percentage" });
  const female = await ui.readStatistic(byGender, { variable: "Purchase", rawCode: "Yes", statistic: "selection_percentage", segment: { variable: "Gender", rawCode: "Female" } });
  const male = await ui.readStatistic(byGender, { variable: "Purchase", rawCode: "Yes", statistic: "selection_percentage", segment: { variable: "Gender", rawCode: "Male" } });
  for (const v of [overall, female, male]) expect(v).toBeGreaterThanOrEqual(0);
  // The overall share lies between the two subgroup shares (a weighted average of them).
  expect(overall).toBeGreaterThanOrEqual(Math.min(female, male) - 0.1);
  expect(overall).toBeLessThanOrEqual(Math.max(female, male) + 0.1);
  await expect(
    ui.readStatistic(byGender, { variable: "Purchase", rawCode: "Yes", statistic: "selection_percentage", segment: { variable: "Gender", rawCode: "No such code" } }),
  ).rejects.toThrow(/no banner column for Gender code "No such code"/);
  await expect(
    ui.readStatistic(byGender, { variable: "Purchase", rawCode: "Yes", statistic: "selection_percentage", segment: { variable: "Region", rawCode: "North" } }),
  ).rejects.toThrow(/not this table's banner/);
});
