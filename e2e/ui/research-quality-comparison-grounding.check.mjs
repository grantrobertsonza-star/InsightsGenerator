// Codex RQ-F02 (2026-10-24), in a real browser on the disposable stack (production build, model
// REPLAY). A proposal-against-brief comparison whose proposal reading fails (the replay proposes a
// quote report.docx does not contain) used to rate "Problem restated" 3/5 and the comparison 60%
// Workable from the brief's words alone, on screen and in Word. Now:
//   1. the failed reading is named, and no comparison criterion is rated: no overall figure, every
//      row unscored, also after a reload;
//   2. the Word download names the unfinished reading and rates no comparison criterion;
//   3. with the replay healthy, a new comparison reads both documents and rates them.
// Synthetic replay answers only; orchestration evidence, not judgement quality.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const fixtureFile = path.join(path.dirname(path.resolve(manifestPath)), "model-fixture.json");
const FIXTURE = path.resolve("fixtures/golden-thread-1");
const SHOT = process.env.SHOT;

test.use({ viewport: { width: 1600, height: 1000 } });
test.afterEach(() => writeFileSync(fixtureFile, JSON.stringify({})));

test("a comparison with an unread proposal rates nothing from the brief alone; a healthy comparison reads both", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  writeFileSync(
    fixtureFile,
    JSON.stringify({
      tools: {
        record_documented_facts: [
          { match: "Document: report.docx", input: { nothing_found: false, facts: [{ topic: "claim", phase: "reported_executed", selection: "unstated", statement: "Invented", exact_quote: "This proposal sentence was never written." }] } },
        ],
      },
    }),
  );
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `rq-compare-${Date.now()}` });
  await ui.upload(run, path.join(FIXTURE, "client-brief.docx"), "brief");
  await ui.upload(run, path.join(FIXTURE, "report.docx"), "proposal");
  const openSection = async () => {
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Research quality/ }).first().click();
  };
  await openSection();
  const section = page.getByTestId("research-quality");
  const documentPicker = section.getByLabel("Document", { exact: true });
  await expect(documentPicker.locator("option", { hasText: "report.docx" })).toHaveCount(1, { timeout: 60_000 });
  await documentPicker.selectOption(await documentPicker.locator("option", { hasText: "report.docx" }).getAttribute("value"));
  const actions = section.getByRole("group", { name: "Review actions" });
  const compareOnce = async () => {
    await actions.getByRole("button", { name: "Compare with brief" }).click();
    await section.getByTestId("rq-confirm").getByLabel("Brief to compare").selectOption({ label: "client-brief.docx" });
    await section.getByTestId("rq-confirm").getByRole("button", { name: "Start review" }).click();
  };
  await compareOnce();
  const state = section.getByTestId("rq-review-state");
  const comparison = section.locator('[data-testid="rq-dashboard"][data-dashboard="comparison"]');

  const expectNothingRated = async () => {
    await expect(state).toHaveAttribute("data-state", /partial|failed/, { timeout: 5 * 60_000 });
    await expect(state.getByTestId("rq-failed-step").first()).toContainText("report.docx");
    await expect(comparison.locator("li[data-criterion]")).toHaveCount(7);
    await expect(comparison).toHaveAttribute("data-pct", "none");
    expect(await comparison.locator("li[data-criterion]").evaluateAll((els) => els.map((e) => e.getAttribute("data-score")))).toEqual(Array(7).fill("none"));
  };
  // 1. on screen, then after a reload
  await expectNothingRated();
  if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-comparison-unread.png") });
  await openSection();
  await expectNothingRated();

  // 2. Word
  const [download] = await Promise.all([page.waitForEvent("download"), section.getByRole("link", { name: "Download review (Word)" }).click()]);
  const word = (await (await JSZip.loadAsync(readFileSync(await download.path()))).file("word/document.xml").async("string")).replace(/<[^>]+>/g, "");
  expect(word).toContain("Not completed: Reading the document (report.docx)");
  expect(word).not.toMatch(/Problem restated: \d\/5/);
  expect(word).not.toMatch(/Proposal against brief: \d+%/);

  // 3. healthy: a new comparison reads both and rates them
  writeFileSync(fixtureFile, JSON.stringify({}));
  await compareOnce();
  await expect(section.getByTestId("rq-selected")).toContainText("No. 2", { timeout: 60_000 });
  await expect(state).toHaveAttribute("data-state", /complete|partial/, { timeout: 5 * 60_000 });
  await expect(comparison.locator("li[data-criterion]")).toHaveCount(7);
  expect(await comparison.locator("li[data-criterion]").evaluateAll((els) => els.filter((e) => e.getAttribute("data-score") !== "none").length)).toBeGreaterThan(0);
  if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-comparison-both.png") });
});
