// Regression, Grant 2026-10-19: Cross tabs refused FinScope SA 2024.sav (26.7 MB) with "exceeds the
// supported 20 MB limit" because a read limit added on 2026-10-16 blocked a file accepted earlier.
// Every fixture in the suite was small, so nothing exercised a file of real survey size. This check
// imports a synthetic SPSS file of FinScope's shape and size (5,600 cases by 4,500 variables, about
// 25 MB, generated here by scripts/e2e/make-large-sav.py: no real data) and builds a cross tab from it
// through the workspace's own controls, in a real browser on the disposable stack.
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const limits = JSON.parse(readFileSync(path.resolve("api/import-limits.json"), "utf8"));

test("a survey-sized SPSS file (over 20 MB) imports and builds a cross tab", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const file = path.join(mkdtempSync(path.join(tmpdir(), "large-sav-")), "national-survey-shape.sav");
  execFileSync("python3", ["-I", path.resolve("scripts/e2e/make-large-sav.py"), file], { stdio: "inherit" });
  const bytes = statSync(file).size;
  expect(bytes).toBeGreaterThan(20_000_000); // the size that was refused

  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `large-sav-${Date.now()}` });
  await ui.upload(run, file, "table");
  await expect(page.getByText(/exceeds the supported/)).toHaveCount(0);
  const { table } = await ui.buildPurchaseCrosstab(run);
  await expect(page.getByText(/Couldn't read this data file/)).toHaveCount(0);
  // The table shows both answers, from all 5,600 cases.
  const text = await table.innerText();
  expect(text).toMatch(/Yes/);
  expect(text).toMatch(/No/);
  expect(text.replace(/[\s,]/g, "")).toMatch(/5600/);
  // Asserted last, so a run against an older, lower limit fails on the app's refusal above.
  expect(bytes).toBeLessThanOrEqual(limits.maxFileBytes);
});
