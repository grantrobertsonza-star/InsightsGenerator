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
    await section.getByRole("tab", { name: "History and export" }).click();
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
