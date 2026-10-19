// Research Quality Review in a real browser on the disposable stack (production build, model REPLAY:
// orchestration evidence only, never judgement quality). Grant 2026-10-19: one brief or one proposal
// at a time, a separate proposal-against-brief comparison, view only.
//   1. Opening the section makes no model call; documents uploaded as a brief and a proposal are
//      listed with their role and "Review as brief/proposal".
//   2. A start needs a confirmation; cancelling calls nothing.
//   3. A brief review completes: ten bars, the overall recomputed here from the scores and weights on
//      screen; clicking a bar shows that criterion on the right, with quotes that are verbatim spans of
//      the stored document text.
//   4. A proposal review shows six weighted categories; a category's detail lists its criteria.
//   5. The comparison is its own review with seven equal-weight comparisons.
//   6. The Word export of the brief review carries the dashboard and the criteria.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FIXTURE = path.resolve("fixtures/golden-thread-1");

test.use({ viewport: { width: 1600, height: 1000 } });

/** The overall percentage a dashboard should show, from the bars' own scores and weights. */
async function expectedPct(dash) {
  const rows = await dash.locator("li[data-criterion]").evaluateAll((els) => els.map((e) => ({ score: e.getAttribute("data-score"), weight: Number(e.getAttribute("data-weight")) })));
  const total = rows.reduce((n, x) => n + x.weight, 0);
  const rated = rows.filter((x) => x.score !== "none");
  const w = rated.reduce((n, x) => n + x.weight, 0);
  return w * 2 >= total ? String(Math.round((rated.reduce((n, x) => n + x.weight * Number(x.score), 0) / (w * 5)) * 100)) : "none";
}

test("research quality: brief, proposal and comparison reviews, dashboard, details and export", async ({ page }, testInfo) => {
  test.setTimeout(15 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `research-quality-${Date.now()}` });
    // Through the Import screen's Brief and Proposal pickers (added 2026-10-19).
    await ui.upload(run, path.join(FIXTURE, "client-brief.docx"), "brief");
    await ui.upload(run, path.join(FIXTURE, "report.docx"), "proposal");
    // A report is not a brief or proposal: it is not offered for review (Grant 2026-10-19).
    await ui.upload(run, path.join(FIXTURE, "questionnaire.docx"), "report");
    const usage = async () => Number((await db.query(`select count(*) from trace where run_id=$1 and event='api_usage' and detail->>'agent' like 'research_quality%'`, [run.id])).rows[0].count);

    // 1. open the section: no model call; the menu order agreed 2026-10-18 still holds
    await page.goto(run.url, { waitUntil: "networkidle" });
    const menu = (await page.locator("#run-nav-slot button").allInnerTexts()).map((t) => t.replace(/\s*\d+$/, "").trim());
    expect(menu.indexOf("Import data")).toBe(0);
    expect(menu.indexOf("Research quality review")).toBe(1);
    await page.getByRole("button", { name: /^Research quality review/ }).first().click();
    const section = page.getByTestId("research-quality");
    for (const title of ["Briefs and proposals", "Dashboard", "Criterion details"]) await expect(section.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: 60_000 });
    const card = (name) => section.locator("[data-document-id]").filter({ hasText: name });
    await expect(card("client-brief.docx")).toBeVisible();
    await expect(card("questionnaire.docx")).toHaveCount(0);
    await expect(section.locator("[data-document-id]")).toHaveCount(2);
    // The role recorded at upload is shown on each document.
    await expect(card("client-brief.docx").getByTestId("rq-doc-role")).toHaveText("Brief");
    await expect(card("report.docx").getByTestId("rq-doc-role")).toHaveText("Proposal");
    expect(await usage()).toBe(0);

    // 2. a start needs confirming; cancel calls nothing
    await card("client-brief.docx").getByRole("button", { name: "Review as brief" }).click();
    await expect(section.getByTestId("rq-confirm")).toContainText("Brief review of client-brief.docx");
    await section.getByTestId("rq-confirm").getByRole("button", { name: "Cancel" }).click();
    await expect(section.getByTestId("rq-confirm")).toHaveCount(0);
    expect(await usage()).toBe(0);

    // 3. the brief review
    const runReview = async (button) => {
      await button.click();
      await section.getByTestId("rq-confirm").getByRole("button", { name: "Start review" }).click();
      await expect(section.getByTestId("rq-review-state")).toHaveAttribute("data-state", /complete|partial/, { timeout: 8 * 60_000 });
    };
    await runReview(card("client-brief.docx").getByRole("button", { name: "Review as brief" }));
    expect(await usage()).toBeGreaterThan(0);
    const brief = section.locator('[data-testid="rq-dashboard"][data-dashboard="brief"]');
    await expect(brief.locator("li[data-criterion]")).toHaveCount(10);
    await expect(brief).toHaveAttribute("data-pct", await expectedPct(brief));
    await expect(brief.locator('[data-criterion="RQ-BRIEF-DECISION"]')).toContainText("x2");
    await brief.locator('[data-criterion="RQ-BRIEF-DECISION"] button').click();
    const details = section.getByTestId("rq-details");
    await expect(details).toHaveAttribute("data-dimension", "RQ-BRIEF-DECISION");
    await expect(details.getByTestId("rq-criterion-detail")).toHaveCount(1);
    await expect(details.getByRole("heading", { name: "Decisions to inform" })).toBeVisible();
    // Every quote shown anywhere is a verbatim span of the stored document text.
    const review = (await db.query(`select id, manifest from research_quality_reviews where run_id=$1 order by sequence desc limit 1`, [run.id])).rows[0];
    expect(review.manifest.kind).toBe("brief");
    const texts = new Map((await db.query(`select id, canonical_text from research_quality_source_versions where id = any($1::uuid[])`, [review.manifest.sources.map((s) => s.sourceVersionId)])).rows.map((r) => [r.id, r.canonical_text]));
    for (const v of (await db.query(`select payload from research_quality_observation_versions where review_id=$1`, [review.id])).rows) {
      for (const s of v.payload.statements) expect(texts.get(s.sourceVersionId).slice(s.locator.start, s.locator.end)).toBe(s.exactQuote);
    }
    // No evidence or decision assessment on screen: the review rates how the document is written.
    await expect(section.getByText(/Decision implications|Documentation:|Methodology:/)).toHaveCount(0);

    // 6. the Word export of the brief review
    const [download] = await Promise.all([page.waitForEvent("download"), section.getByRole("link", { name: "Download review (Word)" }).click()]);
    const docText = (await (await JSZip.loadAsync(readFileSync(await download.path()))).file("word/document.xml").async("string")).replace(/<[^>]+>/g, "");
    expect(docText).toContain("Brief review");
    expect(docText).toContain("Research brief: ");
    expect(docText).toContain("Decisions to inform (counts x2)");

    // 4. the proposal review, its categories and a category's criteria
    await runReview(card("report.docx").getByRole("button", { name: "Review as proposal" }));
    const proposal = section.locator('[data-testid="rq-dashboard"][data-dashboard="proposal"]');
    const cats = proposal.locator("li[data-criterion]");
    await expect(cats).toHaveCount(6);
    expect(await cats.evaluateAll((els) => els.map((e) => [e.getAttribute("data-criterion"), Number(e.getAttribute("data-weight"))]))).toEqual([["method", 36], ["price", 18], ["team", 14], ["management", 14], ["compliance", 9], ["innovation", 9]]);
    await expect(proposal).toHaveAttribute("data-pct", await expectedPct(proposal));
    // The methodology items and their scores sit under its bar; the bar is their average (rated only).
    const method = proposal.locator('[data-criterion="method"]');
    const items = method.locator("li[data-sub-criterion]");
    await expect(method).toHaveAttribute("data-state", "rated", { timeout: 3 * 60_000 });
    expect(await items.evaluateAll((els) => els.map((e) => e.getAttribute("data-sub-criterion")))).toEqual(["RQ-PROP-METHOD", "RQ-PROP-DESIGN", "RQ-PROP-SAMPLE", "RQ-PROP-ANALYSIS", "RQ-PROP-LITERATURE"]);
    const itemScores = (await items.evaluateAll((els) => els.map((e) => e.getAttribute("data-score")))).filter((v) => v !== "none").map(Number);
    expect(itemScores.length).toBeGreaterThan(0);
    expect(Number(await method.getAttribute("data-score"))).toBeCloseTo(itemScores.reduce((a, b) => a + b, 0) / itemScores.length, 6);
    await expect(proposal.locator('[data-criterion="price"] li[data-sub-criterion]')).toHaveCount(0); // one item: no list
    await method.locator("button").first().click();
    await expect(details.getByRole("heading", { name: "Methodological rigour" })).toBeVisible();
    await expect(details.getByTestId("rq-criterion-detail")).toHaveCount(5);
    // Each document lists its own reviews.
    await expect(card("client-brief.docx").getByRole("button", { name: /^Brief review/ })).toHaveCount(1);
    await expect(card("report.docx").getByRole("button", { name: /^Proposal review/ })).toHaveCount(1);

    // 5. the comparison: its own review, seven equal comparisons
    const compare = section.getByTestId("rq-compare");
    await compare.getByLabel("Proposal to compare").selectOption({ label: "report.docx" });
    await compare.getByLabel("Brief to compare").selectOption({ label: "client-brief.docx" });
    await runReview(compare.getByRole("button", { name: "Compare" }));
    const comparison = section.locator('[data-testid="rq-dashboard"][data-dashboard="comparison"]');
    await expect(comparison.locator("li[data-criterion]")).toHaveCount(7);
    await expect(comparison).toHaveAttribute("data-pct", await expectedPct(comparison));
    await expect(compare.getByRole("button", { name: /^report\.docx against client-brief\.docx/ })).toBeVisible();
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });

    // Switching back to an earlier review shows it again.
    await card("client-brief.docx").getByRole("button", { name: /^Brief review/ }).click();
    await expect(section.locator('[data-testid="rq-dashboard"][data-dashboard="brief"]')).toBeVisible();
  } finally {
    await db.end();
  }
});
