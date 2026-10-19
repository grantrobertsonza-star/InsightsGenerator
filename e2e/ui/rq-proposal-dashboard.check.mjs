// The proposal dashboard (RQC-4), Grant 2026-10-19: six weighted categories, each the average of its
// rated criteria, in a real browser on the disposable stack (model replay: orchestration only).
// A synthetic Word document from golden-thread-1 is reviewed in the proposal role; the overall
// percentage is recomputed here from the category scores and weights the screen shows.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FIXTURE = path.resolve("fixtures/golden-thread-1");

test.use({ viewport: { width: 1600, height: 1000 } });

test("a proposal review shows six weighted categories and an overall figure that follows from them", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `rq-proposal-${Date.now()}` });
  await ui.upload(run, path.join(FIXTURE, "client-brief.docx"), "report");
  await page.goto(run.url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Research quality review/ }).first().click();
  const section = page.getByTestId("research-quality");
  const card = section.locator("[data-document-id]").filter({ hasText: "client-brief.docx" });
  await expect(card).toBeVisible({ timeout: 60_000 });
  const include = card.locator("label").filter({ hasText: "client-brief.docx" }).locator("input");
  if (!(await include.isChecked())) await include.check();
  const role = (r) => card.locator("label").filter({ hasText: new RegExp(`^${r}$`) }).locator("input");
  await role("Proposal or plan").check();
  for (const r of ["Brief", "Report"]) if (await role(r).isChecked()) await role(r).uncheck();
  await section.getByLabel("Improve a planned study").check();
  await section.getByLabel("Study type").selectOption("quantitative");
  await section.getByRole("button", { name: "Review selected material" }).click();
  await section.getByRole("button", { name: "Start review" }).click();
  await expect(section.getByTestId("rq-review-state")).toHaveAttribute("data-state", /complete|partial/, { timeout: 8 * 60_000 });

  const dash = section.locator('[data-testid="rq-dashboard"][data-dashboard="proposal"]');
  await expect(dash).toBeVisible();
  const rows = dash.locator("[data-criterion]");
  await expect(rows).toHaveCount(6);
  const shown = await rows.evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-criterion"), score: e.getAttribute("data-score"), weight: Number(e.getAttribute("data-weight")) })));
  expect(shown.map((x) => [x.id, x.weight])).toEqual([["method", 36], ["price", 18], ["team", 14], ["management", 14], ["compliance", 9], ["innovation", 9]]);
  const rated = shown.filter((x) => x.score !== "none");
  const ratedWeight = rated.reduce((n, x) => n + x.weight, 0);
  const expected = ratedWeight * 2 >= 100 ? String(Math.round((rated.reduce((n, x) => n + x.weight * Number(x.score), 0) / (ratedWeight * 5)) * 100)) : "none";
  await expect(dash).toHaveAttribute("data-pct", expected);
  await expect(dash.locator('[data-criterion="method"]')).toContainText("Methodological rigour");
  await expect(dash.locator('[data-criterion="method"]')).toContainText("36%");
  // No brief selected, so no brief dashboard.
  await expect(section.locator('[data-testid="rq-dashboard"][data-dashboard="brief"]')).toHaveCount(0);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
});
