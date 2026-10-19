// Research Quality Review v1 in a real browser on the disposable stack (production build, model
// REPLAY: orchestration evidence only, never judgement quality). Two synthetic Word documents from
// golden-thread-1 (client brief and questionnaire) are uploaded through the native controls.
//   1. Opening the section makes no model call (no research-quality usage trace).
//   2. "Review research quality" on a document opens the section with it preselected.
//   3. Roles, mode and study type are chosen; the scope and estimate are shown before the start.
//   4. The review completes; observations show the three separate dimensions and verbatim quotes.
//   5. Accept and researcher wording survive reload, attributed to the signed-in researcher.
//   6. A second tab saving against the old revision gets a visible conflict and keeps its text.
//   7. A clarification is saved as researcher-supplied; the Word export contains the wording.
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

test("research quality review: start, review, decide, conflict, clarify, export", async ({ page, browser }, testInfo) => {
  test.setTimeout(15 * 60_000);
  page.on("dialog", (d) => d.accept());
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `research-quality-${Date.now()}` });
    await ui.upload(run, path.join(FIXTURE, "client-brief.docx"), "report");
    await ui.upload(run, path.join(FIXTURE, "questionnaire.docx"), "report");
    const usage = async () => Number((await db.query(`select count(*) from trace where run_id=$1 and event='api_usage' and detail->>'agent' like 'research_quality%'`, [run.id])).rows[0].count);

    // 1. open the section: no model call
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Research quality review/ }).first().click();
    const section = page.getByTestId("research-quality");
    await expect(section.getByRole("button", { name: "Review selected material" })).toBeVisible({ timeout: 60_000 });
    expect(await usage()).toBe(0);
    // Menu order agreed 2026-10-18: Import data, Research quality review, then Objectives with
    // Business decisions inside; and the module uses the shared three-pane layout.
    const menu = (await page.locator("#run-nav-slot button").allInnerTexts()).map((t) => t.replace(/\s*\d+$/, "").trim());
    const at = (label) => menu.indexOf(label);
    for (const label of ["Import data", "Research quality review", "Set Objectives", "Review Objectives", "Business decisions", "Analytics"]) expect(at(label), `${label} in ${menu.join(" | ")}`).toBeGreaterThanOrEqual(0);
    expect(at("Import data")).toBe(0);
    expect(at("Research quality review")).toBe(1);
    expect(at("Set Objectives")).toBeGreaterThan(at("Research quality review"));
    expect(at("Business decisions")).toBe(at("Review Objectives") + 1);
    expect(at("Analytics")).toBeGreaterThan(at("Business decisions"));
    for (const title of ["Reviews", "Start a review", "Documents"]) await expect(section.getByRole("heading", { name: title, exact: true })).toBeVisible();

    // 2. the per-document link preselects that document
    await page.getByRole("button", { name: /^Reports and decks/ }).first().click();
    const briefId = (await db.query(`select id from documents where run_id=$1 and source_filename='client-brief.docx'`, [run.id])).rows[0].id;
    await page.getByRole("button", { name: "Review research quality" }).first().click();
    await expect(section).toBeVisible();
    const preselected = await section.locator("[data-document-id] input[type=checkbox]:checked").count();
    expect(preselected).toBeGreaterThan(0);

    // 3. choose roles and context, see the scope, then start
    const card = (name) => section.locator("[data-document-id]").filter({ hasText: name });
    for (const name of ["client-brief.docx", "questionnaire.docx"]) {
      const box = card(name).locator("label").filter({ hasText: name }).locator("input");
      if (!(await box.isChecked())) await box.check();
    }
    const roleBox = (name, role) => card(name).locator("label").filter({ hasText: new RegExp(`^${role}$`) }).locator("input");
    for (const r of ["Brief", "Questionnaire"]) {
      const want = (r === "Brief") ? "client-brief.docx" : "questionnaire.docx";
      const other = want === "client-brief.docx" ? "questionnaire.docx" : "client-brief.docx";
      await roleBox(want, r).check();
      if (await roleBox(other, r).isChecked()) await roleBox(other, r).uncheck();
    }
    for (const name of ["client-brief.docx", "questionnaire.docx"]) if (await roleBox(name, "Report").isChecked()) await roleBox(name, "Report").uncheck();
    await section.getByLabel("Improve a planned study").check();
    await section.getByLabel("Study type").selectOption("quantitative");
    await section.getByLabel("Purpose").fill("Decide whether to prioritise convenience improvements");
    await section.getByLabel("Other decisions, one per line").fill("Prioritise convenience improvements or not");
    await section.getByRole("button", { name: "Review selected material" }).click();
    await expect(section.getByLabel("Review scope")).toContainText(/Estimated cost/);
    expect(await usage()).toBe(0);
    await section.getByRole("button", { name: "Start review" }).click();

    // 4. completes, with separate dimensions and verbatim quotes
    await expect(section.getByTestId("rq-review-state")).toHaveAttribute("data-state", /complete|partial/, { timeout: 8 * 60_000 });
    const obs = section.getByTestId("rq-observation");
    await expect(obs.first()).toBeVisible();
    await expect(obs.first()).toContainText("Documentation:");
    await expect(obs.first()).toContainText("Methodology:");
    expect(await usage()).toBeGreaterThan(0);
    const review = (await db.query(`select id, manifest from research_quality_reviews where run_id=$1`, [run.id])).rows[0];
    const versions = review.manifest.sources.map((s) => s.sourceVersionId);
    const texts = new Map((await db.query(`select id, canonical_text from research_quality_source_versions where id = any($1::uuid[])`, [versions])).rows.map((r) => [r.id, r.canonical_text]));
    for (const v of (await db.query(`select payload from research_quality_observation_versions where review_id=$1`, [review.id])).rows) {
      for (const s of v.payload.statements) expect(texts.get(s.sourceVersionId).slice(s.locator.start, s.locator.end)).toBe(s.exactQuote);
    }

    // 4b. the scored checklist: one card per document, its own checklist, a score or a stated
    // reason, and every percentage recomputed here from the element statuses the screen shows.
    const grid = section.getByTestId("rq-checklist");
    await expect(grid).toBeVisible();
    const cards = grid.locator("[data-checklist]");
    await expect(cards).toHaveCount(2);
    expect(await cards.evaluateAll((els) => els.map((e) => e.getAttribute("data-checklist")).sort())).toEqual(["brief", "questionnaire"]);
    for (const c of await cards.all()) {
      const statuses = await c.locator("[data-element]").evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
      const assessed = statuses.filter((x) => x !== "not_assessed" && x !== "none");
      const points = assessed.reduce((n, x) => n + (x === "present" ? 2 : x === "partial" ? 1 : 0), 0);
      const overall = await c.getByTestId("rq-checklist-overall").innerText();
      if (assessed.length * 2 >= statuses.length) expect(overall).toContain(`${Math.round((points / (assessed.length * 2)) * 100)}%`);
      else expect(overall).toMatch(/Too little could be assessed/);
    }
    // 4c. the scorecard shows a short name per criterion, with the full question behind the "i".
    const scoreRows = section.getByLabel("Scorecard").locator("[data-criterion]");
    await expect(scoreRows.first()).toBeVisible();
    for (const row of (await scoreRows.all()).slice(0, 3)) {
      const id = await row.getAttribute("data-criterion");
      const dot = row.locator("[title]").first();
      const hover = await dot.getAttribute("title");
      expect(hover).toMatch(new RegExp(`^${id}: .+\\?`));
      // The visible cell is the short name, not the question.
      const cell = (await row.getByTestId("rq-criterion-name").innerText()).replace(/\s*i$/, "").trim();
      expect(cell.length).toBeLessThan(hover.length);
      expect(cell).not.toContain("?");
    }
    // 4d. criteria that did not apply are a folded list of names and reasons with a count, and the
    // assessed criteria sit under their own heading, never inside that list.
    const notApplied = section.getByTestId("rq-criteria-not-applied");
    await expect(notApplied.locator("summary")).toHaveText(/^Criteria that did not apply to these documents \(\d+\)$/);
    expect(await notApplied.getByTestId("rq-observation").count()).toBe(0);
    await expect(section.getByRole("heading", { name: /^Criterion details \(\d+\)$/ })).toBeVisible();
    await section.getByRole("tab", { name: "Improvements" }).click();
    await expect(section.getByTestId("rq-gap-recommendations")).toContainText("Missing or partial elements");
    await section.getByRole("tab", { name: "Overview" }).click();

    // 5. accept and wording survive reload, attributed
    const first = obs.first();
    const obsId = await first.getAttribute("data-observation-id");
    const byId = () => section.locator(`[data-testid="rq-observation"][data-observation-id="${obsId}"]`);
    await first.getByRole("button", { name: "Accept" }).click();
    await expect(byId()).toHaveAttribute("data-status", "accepted");
    await byId().getByRole("button", { name: "Edit wording" }).click();
    await byId().getByLabel("Your wording").fill("Researcher wording for the export");
    await byId().getByRole("button", { name: "Save wording" }).click();
    await expect(byId()).toContainText("Implication (your wording): Researcher wording for the export");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Research quality review/ }).first().click();
    await expect(byId()).toHaveAttribute("data-status", "accepted", { timeout: 60_000 });
    await expect(byId()).toContainText("Researcher wording for the export");
    await expect(byId()).toContainText(`accepted by ${JSON.parse(readFileSync(target.credentialsFile, "utf8")).primary.email}`);

    // 6. a stale second tab gets a conflict and keeps its text
    const other = await browser.newPage();
    await other.goto(run.url, { waitUntil: "networkidle" });
    await other.getByRole("button", { name: /^Research quality review/ }).first().click();
    const otherCard = other.locator(`[data-testid="rq-observation"][data-observation-id="${obsId}"]`);
    await expect(otherCard).toBeVisible({ timeout: 60_000 });
    await byId().getByRole("button", { name: "Dismiss" }).click();
    await expect(byId()).toHaveAttribute("data-status", "dismissed");
    await otherCard.getByRole("button", { name: "Edit wording" }).click();
    await otherCard.getByLabel("Your wording").fill("Text from the stale tab");
    await otherCard.getByRole("button", { name: "Save wording" }).click();
    await expect(otherCard.getByRole("alert")).toContainText(/changed elsewhere/);
    await expect(otherCard.getByLabel("Your wording")).toHaveValue("Text from the stale tab");
    await other.close();

    // 7. clarification and export
    await section.getByRole("tab", { name: "Clarifications" }).click();
    await section.getByLabel("Clarification").fill("Recruitment will use the customer database.");
    await section.getByRole("button", { name: "Save clarification" }).click();
    await expect(section.getByText(/Clarification saved/)).toBeVisible();
    // History and export sit in the right-hand pane beside the review (three-pane layout).
    await expect(section.getByRole("heading", { name: "History and export" })).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), section.getByRole("link", { name: "Download review (Word)" }).click()]);
    const bytes = readFileSync(await download.path());
    const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml").async("string");
    const text = xml.replace(/<[^>]+>/g, "");
    expect(text).toContain("Appendix: dismissed observations");
    expect(text).toContain("Researcher wording for the export");
    expect(text).toContain("Recruitment will use the customer database.");
    expect(text).toContain("after this review");
  } finally {
    await db.end();
  }
});
