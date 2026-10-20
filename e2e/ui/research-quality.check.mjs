// Research Quality Review in a real browser on the disposable stack (production build, model REPLAY:
// orchestration evidence only, never judgement quality). Grant 2026-10-19: one brief or one proposal
// at a time, a separate proposal-against-brief comparison, view only; laid out from 2026-10-20 as his
// prototype, then with the document and review chosen at the top of the review pane, its actions and
// Overview, Criteria and Improvements tabs, and the clicked bar's or criterion's detail on the right.
//   1. Opening the section makes no model call; documents uploaded as a brief and a proposal are
//      listed with their role; the selected one offers Review brief, Review proposal and Compare.
//   2. A start needs a confirmation; cancelling calls nothing.
//   3. A brief review completes: ten bars, the overall recomputed here from the scores and weights on
//      screen; clicking a bar opens the Criteria tab on that criterion, with quotes that are verbatim
//      spans of the stored document text; the status filter narrows the criteria list.
//   4. A proposal review shows six weighted categories; a category's detail lists its criteria.
//   5. The comparison is its own review with seven equal-weight comparisons, listed in the
//      historical reviews of both of its documents.
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
    const menu = (await page.locator("#run-nav-slot [data-nav-label]").allInnerTexts()).map((t) => t.trim());
    expect(menu.indexOf("Import data")).toBe(0);
    expect(menu.indexOf("Research quality")).toBe(1);
    await page.getByRole("button", { name: /^Research quality/ }).first().click();
    const section = page.getByTestId("research-quality");
    const documentPicker = section.getByLabel("Document", { exact: true });
    const reviewPicker = section.getByLabel("Review", { exact: true });
    await expect(documentPicker).toBeVisible({ timeout: 60_000 });
    await expect(section.getByRole("heading", { name: "Criterion details", exact: true })).toBeVisible();
    // Chooses a document by its file name; the picker says which one is shown.
    const choose = async (name) => {
      const value = await documentPicker.locator("option", { hasText: name }).getAttribute("value");
      await documentPicker.selectOption(value);
      await expect(section.getByTestId("rq-picker")).toHaveAttribute("data-document-id", value);
    };
    // The shown document's reviews, as the review picker lists them.
    const reviewsListed = () => reviewPicker.locator("option").allInnerTexts();
    const actions = section.getByRole("group", { name: "Review actions" });
    // Briefs and proposals only, each with the role recorded at upload.
    expect((await documentPicker.locator("option").allInnerTexts()).sort()).toEqual(["client-brief.docx · Brief", "report.docx · Proposal"]);
    expect(await usage()).toBe(0);

    // 2. a start needs confirming; cancel calls nothing
    await choose("client-brief.docx");
    await expect(section.getByTestId("rq-selected")).toContainText("No review yet");
    await actions.getByRole("button", { name: "Review brief" }).click();
    await expect(section.getByTestId("rq-confirm")).toContainText("Brief review of client-brief.docx");
    await section.getByTestId("rq-confirm").getByRole("button", { name: "Cancel" }).click();
    await expect(section.getByTestId("rq-confirm")).toHaveCount(0);
    expect(await usage()).toBe(0);

    // 3. the brief review
    // Starts a review and waits for it, by its number: the review shown before keeps its place until
    // the new one has loaded, so its state alone would not say the new one finished.
    let started = 0;
    const runReview = async (button, start = true) => {
      if (start) await button.click();
      await section.getByTestId("rq-confirm").getByRole("button", { name: "Start review" }).click();
      started += 1;
      await expect(section.getByTestId("rq-selected")).toContainText(`No. ${started} ·`, { timeout: 60_000 });
      await expect(section.getByTestId("rq-review-state")).toHaveAttribute("data-state", /complete|partial/, { timeout: 8 * 60_000 });
    };
    await runReview(actions.getByRole("button", { name: "Review brief" }));
    await expect(section.getByTestId("rq-selected")).toContainText("Brief review");
    expect(await usage()).toBeGreaterThan(0);
    const brief = section.locator('[data-testid="rq-dashboard"][data-dashboard="brief"]');
    await expect(brief.locator("li[data-criterion]")).toHaveCount(10);
    await expect(brief).toHaveAttribute("data-pct", await expectedPct(brief));
    await expect(brief.locator('[data-criterion="RQ-BRIEF-DECISION"]')).toContainText("x2");
    await brief.locator('[data-criterion="RQ-BRIEF-DECISION"] button').click();
    // The detail is in the right-hand pane, beside the dashboard.
    const details = section.getByTestId("rq-details");
    await expect(details).toHaveAttribute("data-dimension", "RQ-BRIEF-DECISION");
    await expect(details.getByTestId("rq-criterion-detail")).toHaveCount(1);
    // The criteria list: all ten, then narrowed by the status filter to those with that status.
    await section.getByRole("tab", { name: "Criteria" }).click();
    await section.getByLabel("Dimension", { exact: true }).selectOption("all");
    const list = section.getByRole("list", { name: "Criteria" });
    await expect(list.locator("li[data-criterion-row]")).toHaveCount(10);
    const firstStatus = (await section.getByLabel("Assessment status", { exact: true }).locator("option").allInnerTexts())[1];
    await section.getByLabel("Assessment status", { exact: true }).selectOption({ label: firstStatus });
    const narrowed = await list.locator("li[data-criterion-row]").count();
    expect(narrowed).toBeGreaterThan(0);
    expect(narrowed).toBeLessThanOrEqual(10);
    for (const t of await list.locator("li[data-criterion-row]").allInnerTexts()) expect(t.toUpperCase()).toContain(firstStatus.toUpperCase());
    await section.getByLabel("Assessment status", { exact: true }).selectOption("all");
    await list.locator('li[data-criterion-row="RQ-BRIEF-DECISION"] button').click();
    await expect(details.getByRole("heading", { name: "Decisions to inform" })).toBeVisible();
    // Every quote shown anywhere is a verbatim span of the stored document text.
    const review = (await db.query(`select id, manifest from research_quality_reviews where run_id=$1 order by sequence desc limit 1`, [run.id])).rows[0];
    expect(review.manifest.kind).toBe("brief");
    const texts = new Map((await db.query(`select id, canonical_text from research_quality_source_versions where id = any($1::uuid[])`, [review.manifest.sources.map((s) => s.sourceVersionId)])).rows.map((r) => [r.id, r.canonical_text]));
    for (const v of (await db.query(`select payload from research_quality_observation_versions where review_id=$1`, [review.id])).rows) {
      for (const s of v.payload.statements) expect(texts.get(s.sourceVersionId).slice(s.locator.start, s.locator.end)).toBe(s.exactQuote);
    }
    // The document's own words are closed when a criterion opens, and open on a click (Grant, 2026-10-20).
    const words = details.getByTestId("rq-document-words");
    if ((await words.count()) > 0) {
      expect(await words.evaluate((e) => e.open)).toBe(false);
      await expect(words.locator("li").first()).toBeHidden();
      await words.locator("summary").click();
      await expect(words.locator("li").first()).toBeVisible();
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
    await choose("report.docx");
    await runReview(actions.getByRole("button", { name: "Review proposal" }));
    await section.getByRole("tab", { name: "Overview" }).click();
    const proposal = section.locator('[data-testid="rq-dashboard"][data-dashboard="proposal"]');
    const cats = proposal.locator("li[data-criterion]");
    await expect(cats).toHaveCount(6);
    expect(await cats.evaluateAll((els) => els.map((e) => [e.getAttribute("data-criterion"), Number(e.getAttribute("data-weight"))]))).toEqual([["method", 36], ["price", 18], ["team", 14], ["management", 14], ["compliance", 9], ["innovation", 9]]);
    await expect(proposal).toHaveAttribute("data-pct", await expectedPct(proposal));
    // The methodology items and their scores sit under its bar; the bar is their average (rated only).
    const method = proposal.locator('[data-criterion="method"]');
    const items = method.locator("li[data-sub-criterion]");
    await expect(method).toHaveAttribute("data-state", "rated", { timeout: 3 * 60_000 });
    expect(await items.evaluateAll((els) => els.map((e) => e.getAttribute("data-sub-criterion")))).toEqual(["RQ-PROP-METHOD", "RQ-PROP-DESIGN", "RQ-PROP-SAMPLE-SIZE", "RQ-PROP-SAMPLE-METHOD", "RQ-PROP-ANALYSIS", "RQ-PROP-LITERATURE"]);
    const itemScores = (await items.evaluateAll((els) => els.map((e) => e.getAttribute("data-score")))).filter((v) => v !== "none").map(Number);
    expect(itemScores.length).toBeGreaterThan(0);
    expect(Number(await method.getAttribute("data-score"))).toBeCloseTo(itemScores.reduce((a, b) => a + b, 0) / itemScores.length, 6);
    await expect(proposal.locator('[data-criterion="price"] li[data-sub-criterion]')).toHaveCount(0); // one item: no list
    await method.locator("button").first().click();
    await expect(details.getByRole("heading", { name: "Methodological rigour" })).toBeVisible();
    await expect(details.getByTestId("rq-criterion-detail")).toHaveCount(6);
    // RQC-6: the calculated margin-of-error check sits under Sample size and precision, labelled as code's,
    // not the model's; this fixture states no margin, and says so rather than showing nothing.
    const precision = details.locator('[data-criterion="RQ-PROP-SAMPLE-SIZE"]').getByTestId("rq-precision-checks");
    await expect(precision).toContainText("Margin of error, calculated (not the model's rating)");
    await expect(precision).toContainText(/No margin of error is stated|Consistent|Claims more precision|Wider than needed|Not checked/);
    // An item under a category shows that one criterion alone.
    await method.locator('li[data-sub-criterion="RQ-PROP-DESIGN"] button').click();
    await expect(details).toHaveAttribute("data-dimension", "RQ-PROP-DESIGN");
    await expect(details.getByTestId("rq-criterion-detail")).toHaveCount(1);
    // Each document lists its own reviews.
    expect((await reviewsListed()).filter((t) => t.startsWith("Proposal review"))).toHaveLength(1);
    await choose("client-brief.docx");
    expect((await reviewsListed()).filter((t) => t.startsWith("Brief review"))).toHaveLength(1);
    await choose("report.docx");
    // The Improvements tab lists what to improve, or says there is none.
    await section.getByRole("tab", { name: "Improvements" }).click();
    await expect(section.getByRole("tabpanel", { name: "Improvements" })).toContainText(/\S{10,}/);

    // 5. the comparison: its own review, seven equal comparisons, in both documents' histories
    await actions.getByRole("button", { name: "Compare with brief" }).click();
    await section.getByTestId("rq-confirm").getByLabel("Brief to compare").selectOption({ label: "client-brief.docx" });
    await runReview(null, false);
    await section.getByRole("tab", { name: "Overview" }).click();
    const comparison = section.locator('[data-testid="rq-dashboard"][data-dashboard="comparison"]');
    await expect(comparison.locator("li[data-criterion]")).toHaveCount(7);
    await expect(comparison).toHaveAttribute("data-pct", await expectedPct(comparison));
    for (const name of ["report.docx", "client-brief.docx"]) {
      await choose(name);
      expect((await reviewsListed()).filter((t) => t.startsWith("Proposal against brief")), `${name} lists the comparison`).toHaveLength(1);
    }
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });

    // Switching back to an earlier review shows it again.
    await choose("client-brief.docx");
    await reviewPicker.selectOption({ label: (await reviewsListed()).find((t) => t.startsWith("Brief review")) });
    await section.getByRole("tab", { name: "Overview" }).click();
    await expect(section.locator('[data-testid="rq-dashboard"][data-dashboard="brief"]')).toBeVisible();
  } finally {
    await db.end();
  }
});
