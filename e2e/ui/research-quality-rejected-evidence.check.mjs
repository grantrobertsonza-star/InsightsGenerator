// Codex RQ-F01 (2026-10-24), in a real browser on the disposable stack (production build, model
// REPLAY). A brief uploaded through Import whose extraction proposes only a quote the document does
// not contain used to be shown as a complete review, 0%, ten Absent ratings and no retry, after a
// reload and in the Word download too. Now:
//   1. the review is not complete: the reading step is named as failed, with its reason, and no
//      criterion is rated Absent; the overall shows no figure;
//   2. a reload shows the same;
//   3. the Word download says the reading did not complete and carries no 0%;
//   4. with the model healthy again, Retry failed steps reads the document and the review completes,
//      the decision rated from its verified quote.
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

test("a brief whose quotes are all rejected is a failed reading, not a complete 0% review; Retry reads it again", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  // Every extraction of this document proposes one quote it does not contain.
  writeFileSync(
    fixtureFile,
    JSON.stringify({
      tools: {
        record_documented_facts: [
          {
            match: "Document: client-brief.docx",
            input: { nothing_found: false, facts: [{ topic: "decision", phase: "planned", selection: "unstated", statement: "Invented", exact_quote: "The board will decide on a national rollout in March." }] },
          },
        ],
      },
    }),
  );
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `rq-rejected-${Date.now()}` });
  await ui.upload(run, path.join(FIXTURE, "client-brief.docx"), "brief");
  await page.goto(run.url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Research quality/ }).first().click();
  const section = page.getByTestId("research-quality");
  const actions = section.getByRole("group", { name: "Review actions" });
  await expect(actions.getByRole("button", { name: "Review brief" })).toBeVisible({ timeout: 60_000 });
  await actions.getByRole("button", { name: "Review brief" }).click();
  await section.getByTestId("rq-confirm").getByRole("button", { name: "Start review" }).click();
  const state = section.getByTestId("rq-review-state");
  await expect(state).toHaveAttribute("data-state", /failed|partial|complete/, { timeout: 5 * 60_000 });

  const expectFailedReading = async () => {
    await expect(state).toHaveAttribute("data-state", "failed");
    await expect(state.getByTestId("rq-failed-step")).toHaveCount(1);
    await expect(state.getByTestId("rq-failed-step")).toContainText("Reading the document");
    await expect(state.getByTestId("rq-failed-step")).toContainText("could be found in the document");
    await expect(state.getByRole("button", { name: "Retry failed steps" })).toBeVisible();
    const brief = section.locator('[data-testid="rq-dashboard"][data-dashboard="brief"]');
    // No criterion is rated, so none is Absent and there is no overall figure.
    if (await brief.count()) {
      await expect(brief).toHaveAttribute("data-pct", "none");
      expect(await brief.locator('li[data-criterion][data-score="0"]').count()).toBe(0);
    }
  };
  // 1. and 2. on screen, then after a reload
  await expectFailedReading();
  if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-rejected.png") });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Research quality/ }).first().click();
  await expectFailedReading();

  // 3. the Word download
  const [download] = await Promise.all([page.waitForEvent("download"), section.getByRole("link", { name: "Download review (Word)" }).click()]);
  const word = (await (await JSZip.loadAsync(readFileSync(await download.path()))).file("word/document.xml").async("string")).replace(/<[^>]+>/g, "");
  expect(word).toContain("Not completed: Reading the document");
  expect(word).toContain("could be found in the document");
  expect(word).not.toMatch(/Research brief: 0%/);

  // 4. healthy again: Retry reads the document and the review completes
  writeFileSync(fixtureFile, JSON.stringify({}));
  await state.getByRole("button", { name: "Retry failed steps" }).click();
  await expect(state).toHaveAttribute("data-state", "complete", { timeout: 5 * 60_000 });
  const brief = section.locator('[data-testid="rq-dashboard"][data-dashboard="brief"]');
  await expect(brief.locator("li[data-criterion]")).toHaveCount(10);
  await expect(brief).not.toHaveAttribute("data-pct", "none");
  await expect(section.getByTestId("rq-unverified-evidence")).toHaveCount(0);
  if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-recovered.png") });
});
