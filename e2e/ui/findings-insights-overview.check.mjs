// The Findings and Insights overviews (Grant, 2026-10-21), in a real browser on the disposable stack,
// on the golden-thread project after a supporting finding is rejected:
//   1. Findings opens on its overview. The reviewed tile and the evidence-source rows equal the
//      findings in the database; Rejected opens the Findings tab filtered to exactly those findings,
//      and an evidence source opens it filtered to that source.
//   2. Insights opens on its overview. Evidence health counts the insight whose support is no longer
//      valid; Needs a decision opens the Insights tab showing that insight, marked as such.
//   3. Codex OV-01 to OV-04 (21 October): with a rejected copy of that insight and a finding whose
//      theme is stored with surrounding spaces seeded into the disposable database, every figure
//      opens exactly the records it counts (a rejected insight never opens from an in-use figure;
//      the padded theme opens its one finding), and at 375 and 768 px the overviews fit their
//      workspace, add no horizontal page overflow, keep the top insight readable and reachable by
//      keyboard.
//   4. Opening the sections calls no model.
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

test("Findings and Insights overviews count the records and open them filtered", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `fi-overview-${Date.now()}` });
    await ui.upload(run, path.join(FIXTURE, "golden-survey-documented.xlsx"), "table");
    await ui.upload(run, path.join(FIXTURE, "report.docx"), "report");
    await ui.expectReadyOrActionableRecovery(run);
    const table = await ui.buildPurchaseCrosstab(run);
    const finding = await ui.postAndAcceptFinding(table);
    await ui.addIndependentEvidence(run);
    const insight = await ui.generateOrLoadInsight(run, finding);
    await ui.rejectFinding(finding);

    const q = async (sql) => (await db.query(sql, [run.id])).rows;
    const status = Object.fromEntries((await q("select status, count(*)::int as n from findings where run_id=$1 group by status")).map((r) => [r.status, r.n]));
    const total = Object.values(status).reduce((a, b) => a + b, 0);
    const usage = async () => Number((await q("select count(*)::int as n from trace where run_id=$1 and event='api_usage'"))[0].n);

    // 1. Findings overview.
    await page.goto(run.url, { waitUntil: "networkidle" });
    const before = await usage();
    await page.getByRole("button", { name: /^Findings(\s*\d+)?$/ }).first().click();
    const overview = page.getByTestId("findings-overview");
    await expect(overview).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("findings-tab-overview")).toHaveAttribute("aria-selected", "true");
    await expect(overview.getByTestId("fo-status-headline")).toHaveText(String((status.accepted ?? 0) + (status.rejected ?? 0)));
    await expect(overview.getByTestId("fo-status-rejected")).toHaveText(`Rejected ${status.rejected ?? 0}`);
    await expect(overview.getByTestId("fo-status-pending")).toHaveText(`Pending ${status.pending ?? 0}`);
    // This project's findings come from survey data and the report: each source row says how many.
    const sources = overview.getByTestId("fo-sources");
    await expect(sources.locator("[data-evidence-kind=survey]")).toBeVisible();
    const surveyCount = Number((await q("select count(*)::int as n from findings where run_id=$1 and origin='generated'"))[0].n);
    await expect(sources.locator("[data-evidence-kind=survey]").getByRole("button")).toHaveText(`Review ${surveyCount}`);
    if (testInfo) testInfo.annotations.push({ type: "findings", description: JSON.stringify({ status, total, surveyCount }) });

    // Rejected opens the review filtered to the rejected findings.
    await overview.getByTestId("fo-status-rejected").click();
    await expect(page.getByTestId("findings-tab-review")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("findings-showing").filter({ visible: true })).toContainText(`Showing ${status.rejected} of ${total}`);
    await expect(page.locator(`[data-testid="finding-card"][data-finding-id="${finding.id}"]`).filter({ visible: true })).toBeVisible();
    // Back to the overview, then a source row opens the review filtered to that source.
    await page.getByTestId("findings-tab-overview").click();
    await sources.locator("[data-evidence-kind=survey]").getByRole("button").click();
    await expect(page.getByTestId("findings-showing").filter({ visible: true })).toContainText(`Showing ${surveyCount} of ${total}`);

    // 2. Insights overview.
    await page.getByRole("button", { name: /^Insights(\s*\d+)?$/ }).first().click();
    const io = page.getByTestId("insights-overview");
    await expect(io).toBeVisible({ timeout: 60_000 });
    await expect(io.getByTestId("io-support-invalid")).toHaveText(/^No longer valid [1-9]/);
    const attention = io.getByTestId("io-attention-invalid");
    await expect(attention).toBeVisible();
    await attention.click();
    await expect(page.getByTestId("insights-tab-review")).toHaveAttribute("aria-selected", "true");
    const card = page.locator(`[data-testid="synthesized-insight-card"][data-insight-id="${insight.id}"]`).filter({ visible: true });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-support-status", "invalid");
    // Only insights whose support is no longer valid are listed.
    for (const s of await page.locator('[data-testid="synthesized-insight-card"]').filter({ visible: true }).evaluateAll((els) => els.map((e) => e.getAttribute("data-support-status")))) expect(s).toBe("invalid");

    // 3. Seeded boundaries (OV-01, OV-03). A rejected copy of the insight, resting on the same
    // (now rejected) finding, and an accepted finding whose theme is stored padded with spaces.
    const rejectedCopy = (await db.query(
      `insert into synthesized_insights
         select (jsonb_populate_record(null::synthesized_insights,
           to_jsonb(s) || jsonb_build_object('id', gen_random_uuid(), 'review_status', 'rejected', 'headline', 'Seeded rejected copy'))).*
         from synthesized_insights s where s.id = $1 returning id::text`,
      [insight.id],
    )).rows[0].id;
    await db.query(
      `insert into synthesized_insight_sources
         select (jsonb_populate_record(null::synthesized_insight_sources, to_jsonb(x) || jsonb_build_object('synthesized_insight_id', $2::uuid))).*
         from synthesized_insight_sources x where x.synthesized_insight_id = $1`,
      [insight.id, rejectedCopy],
    );
    const spacedTheme = "Seeded spaced theme";
    const spacedFinding = (await db.query(
      `insert into findings
         select (jsonb_populate_record(null::findings,
           to_jsonb(f) || jsonb_build_object('id', gen_random_uuid(), 'theme', $2::text, 'status', 'accepted', 'duplicate_group_id', null))).*
         from findings f where f.id = $1 returning id::text`,
      [finding.id, `   ${spacedTheme}  `],
    )).rows[0].id;
    const findingTotal = Number((await q("select count(*)::int as n from findings where run_id=$1"))[0].n);

    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Findings(\s*\d+)?$/ }).first().click();
    const themeRow = overview.getByTestId("fo-themes").locator(`tr[data-theme="${spacedTheme}"]`);
    await expect(themeRow).toContainText("1 accepted, 0 rejected");
    await themeRow.getByRole("button").click();
    await expect(page.getByTestId("findings-showing").filter({ visible: true })).toContainText(`Showing 1 of ${findingTotal}`);
    await expect(page.locator(`[data-testid="finding-card"][data-finding-id="${spacedFinding}"]`).filter({ visible: true })).toBeVisible();
    // The stored text is the researcher's, spaces and all.
    expect((await db.query("select theme from findings where id=$1 and run_id=$2", [spacedFinding, run.id])).rows[0].theme).toBe(`   ${spacedTheme}  `);

    const visibleInsights = () =>
      page.locator('[data-testid="synthesized-insight-card"]').filter({ visible: true }).evaluateAll((els) =>
        els.map((e) => ({ id: e.getAttribute("data-insight-id"), support: e.getAttribute("data-support-status"), review: e.getAttribute("data-review-status") })),
      );
    const countIn = async (locator) => Number((await locator.innerText()).match(/(\d+)\s*$/)[1]);
    await page.getByRole("button", { name: /^Insights(\s*\d+)?$/ }).first().click();
    await page.getByTestId("insights-tab-overview").click();
    // "No longer valid" counts in-use insights only, and opens exactly those: never the rejected copy.
    const invalidN = await countIn(io.getByTestId("io-support-invalid"));
    await io.getByTestId("io-support-invalid").click();
    const invalidOpened = await visibleInsights();
    expect(invalidOpened).toHaveLength(invalidN);
    for (const c of invalidOpened) expect([c.support, c.review]).toEqual(["invalid", "accepted"]);
    expect(invalidOpened.map((c) => c.id)).not.toContain(rejectedCopy);
    // A second click after changing the filters by hand applies again.
    await page.getByTestId("insights-tab-overview").click();
    await io.getByTestId("io-attention-invalid").click();
    expect(await visibleInsights()).toEqual(invalidOpened);
    // Rejected opens the rejected insights, the seeded copy among them.
    await page.getByTestId("insights-tab-overview").click();
    const rejectedN = await countIn(io.getByTestId("io-review-rejected"));
    await io.getByTestId("io-review-rejected").click();
    const rejectedOpened = await visibleInsights();
    expect(rejectedOpened).toHaveLength(rejectedN);
    for (const c of rejectedOpened) expect(c.review).toBe("rejected");
    expect(rejectedOpened.map((c) => c.id)).toContain(rejectedCopy);
    // Every corroboration figure with a count opens that many insights (OV-02 included).
    await page.getByTestId("insights-tab-overview").click();
    for (const key of ["strong", "moderate", "exploratory", "unrated", "unchecked"]) {
      const seg = io.getByTestId(`io-confidence-${key}`);
      const n = await countIn(seg);
      if (n === 0) continue;
      await seg.click();
      expect(await visibleInsights(), `corroboration ${key}`).toHaveLength(n);
      await page.getByTestId("insights-tab-overview").click();
    }

    // OV-04: narrow workspaces. The overview fits its container, adds no page overflow of its own,
    // keeps the top insight's wording clear of its score, and its actions stay reachable by keyboard.
    for (const width of [375, 768]) {
      await page.setViewportSize({ width, height: 900 });
      // With no remembered choice the main menu starts hidden below 768px, so the page keeps its width.
      if (width < 768) await expect(page.getByTestId("global-rail")).toHaveAttribute("data-collapsed", "true");
      for (const [section, tab, root] of [["Findings", "findings-tab-overview", "findings-overview"], ["Insights", "insights-tab-overview", "insights-overview"]]) {
        await page.getByRole("button", { name: new RegExp(`^${section}(\\s*\\d+)?$`) }).first().click();
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
      const top = io.getByTestId("io-top").locator("button").first();
      if (await top.count()) {
        const layout = await top.evaluate((btn) => {
          const spans = btn.querySelectorAll(":scope > span");
          const r = (el) => el.getBoundingClientRect();
          const words = r(spans[1]);
          const score = r(spans[2]);
          const overlap = !(score.right <= words.left || score.left >= words.right || score.bottom <= words.top || score.top >= words.bottom);
          return { overlap, wordsWidth: words.width, buttonWidth: r(btn).width };
        });
        expect(layout.overlap, `top insight wording and score overlap at ${width}px`).toBe(false);
        expect(layout.wordsWidth, `top insight wording squeezed at ${width}px`).toBeGreaterThan(layout.buttonWidth * 0.6);
      }
      // Keyboard: from the tab strip, Tab reaches the "Needs a decision" row.
      await page.getByTestId("insights-tab-overview").focus();
      let reached = false;
      for (let i = 0; i < 80 && !reached; i++) {
        await page.keyboard.press("Tab");
        reached = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "io-attention-invalid");
      }
      expect(reached, `keyboard reaches Needs a decision at ${width}px`).toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // 4. No model call from opening either section.
    await page.waitForLoadState("networkidle");
    expect(await usage()).toBe(before);
    if (process.env.SHOT) {
      await page.getByRole("button", { name: /^Findings(\s*\d+)?$/ }).first().click();
      await page.getByTestId("findings-tab-overview").click();
      await page.screenshot({ path: process.env.SHOT.replace(".png", "-findings.png"), fullPage: true });
      await page.getByRole("button", { name: /^Insights(\s*\d+)?$/ }).first().click();
      await page.getByTestId("insights-tab-overview").click();
      await page.screenshot({ path: process.env.SHOT.replace(".png", "-insights.png"), fullPage: true });
    }
  } finally {
    await db.end();
  }
});
