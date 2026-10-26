// The Recommendations and Insights report overviews (Grant, 2026-10-21), in a real browser on the
// disposable stack, on the golden-thread project with a researcher-written recommendation and a
// generated narrative:
//   1. Recommendations opens on its overview. The review tile equals the recommendations in the
//      database; an Action plan row opens the review with that recommendation selected.
//   2. After a supporting finding is rejected, Needs a decision and the evidence-health segment both
//      open exactly the recommendations in use whose support is no longer valid, as many as counted;
//      a seeded rejected recommendation on the same insight is neither counted nor listed.
//   3. The Insights report opens on its overview, counts the narrative's insights whose support
//      changed, and its narrative tab still holds the generator and the exports.
//   4. At 375 and 768 px both overviews fit their workspace without widening the page.
//   5. Opening the sections calls no model.
import { clickSectionButton } from "./helpers/nav.mjs";
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FIXTURE = path.resolve("fixtures/golden-thread-1");

test.use({ viewport: { width: 1440, height: 900 } });

test("Recommendations and Insights report overviews count the records and open them", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `rec-report-overview-${Date.now()}` });
    await ui.upload(run, path.join(FIXTURE, "golden-survey-documented.xlsx"), "table");
    await ui.upload(run, path.join(FIXTURE, "report.docx"), "report");
    await ui.expectReadyOrActionableRecovery(run);
    const table = await ui.buildPurchaseCrosstab(run);
    const finding = await ui.postAndAcceptFinding(table);
    await ui.addIndependentEvidence(run);
    const insight = await ui.generateOrLoadInsight(run, finding);
    const human = await ui.addEligibleHumanRecommendation(run, { independentOf: finding, text: `Overview check action ${Date.now()}` });
    await ui.prepareAcceptedNarrative(run, insight);

    const q = async (sql) => (await db.query(sql, [run.id])).rows;
    const recStatus = async () => Object.fromEntries((await q("select status, count(*)::int as n from recommendations where run_id=$1 group by status")).map((r) => [r.status, r.n]));
    const usage = async () => Number((await q("select count(*)::int as n from trace where run_id=$1 and event='api_usage'"))[0].n);
    const openSectionButton = (name) => page.getByRole("button", { name: new RegExp(`^${name}(\\s*\\d+)?$`) }).first();

    // 1. Recommendations overview.
    await page.goto(run.url, { waitUntil: "networkidle" });
    const before = await usage();
    await openSectionButton("Recommendations").click();
    const overview = page.getByTestId("recommendations-overview");
    await expect(overview).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("rec-tab-overview")).toHaveAttribute("aria-selected", "true");
    const status = await recStatus();
    await expect(overview.getByTestId("ro-review-accepted")).toHaveText(`Accepted ${status.accepted ?? 0}`);
    await expect(overview.getByTestId("ro-review-pending")).toHaveText(`Not yet reviewed ${status.pending ?? 0}`);
    // The researcher's recommendation is accepted on current support, so it is in the action plan.
    const planRow = overview.getByTestId("ro-plan").locator(`[data-recommendation-id="${human.id}"]`);
    await expect(planRow).toBeVisible();
    await planRow.click();
    await expect(page.getByTestId("rec-tab-review")).toHaveAttribute("aria-selected", "true");
    const humanCard = page.locator(`[data-testid="recommendation-card"][data-recommendation-id="${human.id}"]`).filter({ visible: true });
    await expect(humanCard).toHaveAttribute("data-selected", "true");

    // 2. Reject the finding behind the generated insight: recommendations built on it lose valid support.
    await ui.rejectFinding(finding);
    // Seeded on that insight in the disposable database (Codex OV-01): one in use, so the drill-down is
    // always exercised, and one rejected, which has the same support but must be neither counted nor
    // listed by an in-use figure.
    const seed = async (status, text) =>
      (await db.query(
        `insert into recommendations (tenant_id, run_id, insight_id, synthesized_insight_id, action_text, owner_role, owner_feasibility_note,
           timeline, metric, priority, assumptions_and_risks, alternatives_considered, source, status)
         select tenant_id, run_id, insight_id, $2, $3, owner_role, owner_feasibility_note, timeline, metric, priority,
           assumptions_and_risks, alternatives_considered, source, $4
         from recommendations where id = $1 returning id::text`,
        [human.id, insight.id, text, status],
      )).rows[0].id;
    const seededInUse = await seed("accepted", "Seeded in-use recommendation on the rejected finding's insight");
    const seededRejected = await seed("rejected", "Seeded rejected recommendation on the rejected finding's insight");
    await page.goto(run.url, { waitUntil: "networkidle" });
    await openSectionButton("Recommendations").click();
    await expect(overview).toBeVisible({ timeout: 60_000 });
    // The recommendations built on the insight that rests on the rejected finding.
    const invalidIds = (await db.query(
      "select id::text from recommendations where run_id=$1 and synthesized_insight_id=$2 and status <> 'rejected'",
      [run.id, insight.id],
    )).rows.map((r) => r.id);
    expect(invalidIds).toContain(seededInUse);
    const invalidCount = Number((await overview.getByTestId("ro-support-invalid").innerText()).match(/(\d+)$/)[1]);
    // The tile segment and the attention row open the same set: exactly the counted ones, twice.
    const listedInvalid = async () =>
      page.locator('[data-testid="recommendation-card"]').filter({ visible: true }).evaluateAll((els) => els.map((e) => [e.getAttribute("data-recommendation-id"), e.getAttribute("data-support-status")]));
    const openedSets = [];
    for (const opener of [overview.getByTestId("ro-attention-invalid"), overview.getByTestId("ro-support-invalid")]) {
      await expect(opener).toBeVisible();
      await opener.click();
      await expect(page.getByTestId("rec-tab-review")).toHaveAttribute("aria-selected", "true");
      const listed = await listedInvalid();
      expect(listed).toHaveLength(invalidCount);
      for (const [, st] of listed) expect(st).toBe("invalid");
      const ids = listed.map(([x]) => x).sort();
      // Every in-use recommendation on that insight is listed (another insight could rest on the finding too).
      for (const id of invalidIds) expect(ids).toContain(id);
      expect(ids).not.toContain(seededRejected);
      await expect(page.getByTestId("recommendations-showing").filter({ visible: true })).toContainText(`Showing ${invalidCount} of`);
      openedSets.push(ids);
      await page.getByTestId("rec-tab-overview").click();
    }
    expect(openedSets[1]).toEqual(openedSets[0]);
    // The researcher's recommendation is independent of the rejected finding: still in the plan.
    await page.getByTestId("rec-tab-overview").click();
    await expect(overview.getByTestId("ro-plan").locator(`[data-recommendation-id="${human.id}"]`)).toBeVisible();

    // 3. Insights report overview.
    await openSectionButton("Insights report").click();
    const report = page.getByTestId("insights-report-overview");
    await expect(report).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("report-tab-overview")).toHaveAttribute("aria-selected", "true");
    await expect(report.getByTestId("ri-attention-narrative-support")).toBeVisible();
    await expect(report.getByTestId("ri-freshness-note")).toBeVisible();
    await expect(report.getByTestId("ri-exports").getByRole("link", { name: /deck/i })).toHaveAttribute("href", `/api/runs/${run.id}/story/export`);
    await page.getByTestId("report-tab-narrative").click();
    await expect(page.getByRole("button", { name: "Regenerate report content", exact: true })).toBeVisible();

    // OV-04: narrow workspaces. Each overview fits its container and adds no page overflow of its own.
    for (const width of [375, 768]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [section, tab, root] of [["Recommendations", "rec-tab-overview", "recommendations-overview"], ["Insights report", "report-tab-overview", "insights-report-overview"]]) {
        await clickSectionButton(page, section);
        await page.getByTestId(tab).click();
        const box = page.getByTestId(root);
        await expect(box).toBeVisible();
        const fit = await box.evaluate((el) => {
          const withIt = document.documentElement.scrollWidth;
          const own = { scroll: el.scrollWidth, client: el.clientWidth };
          const display = el.style.display;
          el.style.display = "none";
          const without = document.documentElement.scrollWidth;
          el.style.display = display;
          return { ...own, withIt, without };
        });
        expect(fit.scroll, `${root} at ${width}px overflows its workspace`).toBeLessThanOrEqual(fit.client + 1);
        expect(fit.withIt, `${root} at ${width}px widens the page`).toBeLessThanOrEqual(fit.without + 1);
        testInfo.annotations.push({ type: "narrow", description: JSON.stringify({ root, width, ...fit }) });
        if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(".png", `-${root}-${width}.png`), fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // 4. No model call from opening the sections.
    await page.waitForLoadState("networkidle");
    expect(await usage()).toBe(before);
    if (process.env.SHOT) {
      await openSectionButton("Recommendations").click();
      await page.getByTestId("rec-tab-overview").click();
      await page.screenshot({ path: process.env.SHOT.replace(".png", "-recommendations.png"), fullPage: true });
      await openSectionButton("Insights report").click();
      await page.getByTestId("report-tab-overview").click();
      await page.screenshot({ path: process.env.SHOT.replace(".png", "-report.png"), fullPage: true });
    }
  } finally {
    await db.end();
  }
});
