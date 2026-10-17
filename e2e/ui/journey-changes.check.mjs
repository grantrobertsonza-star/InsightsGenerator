// Golden-thread journey assessment (2026-10-17): change and failure probes AFTER downstream work
// exists. Each test builds its own project through the real controls (upload, decision, Purchase
// table, accepted finding with a researcher note, a second subject, synthesis, a researcher
// recommendation, the narrative), then makes one change and checks what the researcher sees on
// screen, after a reload, and in the exports. Model output is replay (orchestration, not AI quality).
//   C1 delete the data file the findings came from
//   C2 upload the same data file a second time (duplicate evidence)
//   C3 a save that fails in transit (finding acceptance, recommendation edit), then a retry
//   C4 a narrative generation interrupted by leaving the page, then a retry
//   C5 a data correction behind an accepted finding (stale support qualified on screen and in exports)
//   C6 rejecting an insight after the narrative exists (left out of accepted exports and the
//      regenerated narrative)
//   C7 an edited AI recommendation through re-synthesis, reload and export
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import JSZip from "jszip";
import pg from "pg";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FIXTURE = path.resolve("fixtures/golden-thread-1");
const WORKBOOK = path.join(FIXTURE, "golden-survey-documented.xlsx");
const QUALIFIER = /no longer valid|no longer current|left out|needs review|may be out of date|excluded from this report|changed since|support changed|could not be checked/i;
// The deck's "Evidence qualifications" slide lists every item with its design caveat; the support
// status is disclosed per item elsewhere and on the "Evidence status" slide. It is recorded, not failed.
const QUALIFICATIONS_SLIDE = /^EVIDENCE QUALIFICATIONS/;
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const xmlText = (xml) => squash(xml.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));

async function officeParts(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter((n) => /^(ppt\/slides\/slide\d+|word\/document)\.xml$/.test(n));
  return Promise.all(names.map(async (n) => ({ name: n, text: xmlText(await zip.files[n].async("string")) })));
}
const xlsxText = (buffer) => {
  const book = XLSX.read(buffer, { type: "buffer" });
  return book.SheetNames.flatMap((n) => XLSX.utils.sheet_to_json(book.Sheets[n], { defval: "" }).map((r) => Object.values(r).join(" | "))).join("\n");
};

async function thread(page, testInfo, label) {
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `${label}-${Date.now()}` });
  await ui.upload(run, WORKBOOK, "table");
  await ui.expectReadyOrActionableRecovery(run);
  await page.goto(run.url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Business decisions/ }).first().click();
  const form = page.locator("form", { has: page.getByRole("button", { name: "Add decision" }) });
  await form.locator("textarea").fill("Decide whether to prioritise the male segment next quarter");
  await form.getByRole("button", { name: "Add decision" }).click();
  await expect(page.getByText("Decide whether to prioritise the male segment next quarter", { exact: true }).first()).toBeVisible({ timeout: 120_000 });
  const table = await ui.buildPurchaseCrosstab(run);
  const finding = await ui.postAndAcceptFinding(table);
  const note = "Researcher wording: purchase differs by gender; keep the uncertainty explicit.";
  await ui.saveResearcherNote(finding, note);
  await ui.addIndependentEvidence(run);
  const insight = await ui.generateOrLoadInsight(run, finding);
  const action = "Researcher action: brief the campaign owner on the purchase gap between groups.";
  const recommendation = await ui.addEligibleHumanRecommendation(run, { independentOf: finding, text: action });
  await ui.prepareAcceptedNarrative(run, insight);
  return { ui, run, finding, note, insight, recommendation, action };
}

async function exportsOf(page, run) {
  const origin = new URL(run.url).origin;
  const get = async (route) => {
    const r = await page.request.get(`${origin}/api/runs/${run.id}/${route}`, { timeout: 600_000 });
    return { status: r.status(), body: await r.body() };
  };
  return {
    storyPptx: await get("story/export"),
    storyDocx: await get("story/export-docx"),
    synthXlsx: await get("synthesized-insights/export?scope=all"),
    synthAccepted: await get("synthesized-insights/export?scope=accepted"),
    findingsXlsx: await get("findings/export?scope=all"),
  };
}

const db = () => new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });

test("C1 deleting the data file after downstream work: what is removed, what is qualified, what is kept", async ({ page }, testInfo) => {
  test.setTimeout(20 * 60_000);
  const client = db(); await client.connect();
  const obs = {};
  try {
    const t = await thread(page, testInfo, "change-delete");
    page.on("dialog", (d) => { obs.confirm = d.message(); d.accept(); });
    await page.goto(t.run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Import data(\s*\d+)?$/ }).first().click();
    await page.getByRole("button", { name: "Delete document", exact: true }).first().click();
    await expect.poll(async () => Number((await client.query("select count(*) from documents where run_id=$1", [t.run.id])).rows[0].count), { timeout: 120_000 }).toBe(0);
    await page.reload({ waitUntil: "networkidle" });
    obs.findingsLeft = Number((await client.query("select count(*) from findings where run_id=$1", [t.run.id])).rows[0].count);
    obs.synth = (await client.query("select id, review_status from synthesized_insights where run_id=$1", [t.run.id])).rows;
    obs.recommendation = (await client.query("select action_text from recommendations where id=$1", [t.recommendation.id])).rows[0];
    // The researcher's recommendation wording is kept (it is the researcher's own work).
    expect.soft(obs.recommendation?.action_text, "researcher recommendation kept").toBe(t.action);
    // Every insight that rested on the deleted file is shown as no longer supported.
    await page.getByRole("button", { name: /^Insights(\s*\d+)?$/ }).first().click();
    const cards = page.locator('[data-testid="synthesized-insight-card"]');
    obs.insightCards = await cards.evaluateAll((els) => els.map((e) => ({ status: e.getAttribute("data-support-status"), text: (e.innerText || "").slice(0, 200) })));
    for (const c of obs.insightCards) expect.soft(c.status, `insight shown with its support qualified: ${c.text.slice(0, 60)}`).not.toBe("current");
    // Exports: no slide or report section restates an insight without a qualification beside it.
    const ex = await exportsOf(page, t.run);
    obs.exports = Object.fromEntries(Object.entries(ex).map(([k, v]) => [k, v.status]));
    for (const key of ["storyPptx", "storyDocx"]) {
      expect.soft(ex[key].status, `${key} answers 200`).toBe(200);
      if (ex[key].status !== 200) continue;
      const parts = await officeParts(ex[key].body);
      const headline = t.insight.headline.replace(/…$/, "").slice(0, 50);
      const unqualified = parts.filter((p) => p.text.includes(headline) && !QUALIFIER.test(p.text));
      expect.soft(unqualified.map((p) => p.name), `${key}: the unsupported insight is never presented unqualified`).toEqual([]);
    }
    const synthAccepted = xlsxText(ex.synthAccepted.body);
    obs.synthAcceptedMentionsInsight = synthAccepted.includes(t.insight.headline.replace(/…$/, "").slice(0, 50));
  } finally {
    writeFileSync(testInfo.outputPath("c1-observations.json"), JSON.stringify(obs, null, 2));
    console.log("C1_OBSERVATIONS", JSON.stringify(obs));
    await client.end();
  }
});

test("C2 uploading the same data file again does not add corroboration", async ({ page }, testInfo) => {
  test.setTimeout(20 * 60_000);
  const client = db(); await client.connect();
  const obs = {};
  try {
    const t = await thread(page, testInfo, "change-duplicate");
    const tiers = async () => (await client.query("select id, independent_source_count, confidence_tier, triangulation_count from synthesized_insights where run_id=$1 order by id", [t.run.id])).rows;
    obs.before = await tiers();
    // Upload the same file through the same form; the app refuses a second copy (IMP-008) and must
    // say so. Read the form's own message, not a file count.
    await page.goto(t.run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Import data(\s*\d+)?$/ }).first().click();
    const uploadForm = page.locator("form", { has: page.locator('input[name="rawTableFiles"]') });
    await uploadForm.locator('input[name="rawTableFiles"]').setInputFiles(WORKBOOK);
    await uploadForm.getByRole("button", { name: "Upload", exact: true }).click();
    await page.waitForTimeout(4000);
    obs.formMessage = (await uploadForm.innerText()).split("\n").filter((l) => /added|already|duplicate|same/i.test(l));
    expect.soft(obs.formMessage.join(" "), "the researcher is told the file is already in the project").toMatch(/already/i);
    obs.documentCount = Number((await client.query("select count(*) from documents where run_id=$1", [t.run.id])).rows[0].count);
    expect.soft(obs.documentCount, "no second copy stored").toBe(1);
    await page.reload({ waitUntil: "networkidle" });
    obs.documents = (await client.query("select source_filename, content_sha256 from documents where run_id=$1 order by created_at", [t.run.id]).catch(async () => (await client.query("select source_filename from documents where run_id=$1", [t.run.id])))).rows;
    // Re-run synthesis: the duplicate must not raise any insight's independent-source count or tier.
    await page.getByRole("button", { name: /^Insights(\s*\d+)?$/ }).first().click();
    await page.getByRole("button", { name: /^(Run synthesis|Re-run synthesis)$/ }).click();
    await expect(page.getByRole("button", { name: /^(Run synthesis|Re-run synthesis)$/ })).toBeEnabled({ timeout: 180_000 });
    obs.after = await tiers();
    for (const b of obs.before) {
      const a = obs.after.find((x) => x.id === b.id);
      if (a) expect.soft(a.independent_source_count ?? null, `insight ${b.id}: independent sources unchanged by a duplicate`).toBe(b.independent_source_count ?? null);
    }
    for (const a of obs.after) expect.soft(a.independent_source_count ?? 0, "no insight counts the same file twice").toBeLessThanOrEqual(1);
  } finally {
    writeFileSync(testInfo.outputPath("c2-observations.json"), JSON.stringify(obs, null, 2));
    console.log("C2_OBSERVATIONS", JSON.stringify(obs));
    await client.end();
  }
});

test("C3 a save lost in transit is not shown as saved, and a retry saves once", async ({ page }, testInfo) => {
  test.setTimeout(20 * 60_000);
  const client = db(); await client.connect();
  const obs = {};
  try {
    const t = await thread(page, testInfo, "change-failed-save");
    // Recommendation edit: the first server-action POST from the page is dropped before it reaches the server.
    await page.goto(t.run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Recommendations(\s*\d+)?$/ }).first().click();
    const card = page.locator(`[data-testid="recommendation-card"][data-recommendation-id="${t.recommendation.id}"]`);
    await card.getByRole("button", { name: /^Edit/ }).first().click();
    const edited = `${t.action} Edited once.`;
    await card.locator("textarea").first().fill(edited);
    let dropped = 0;
    await page.route("**/*", async (route) => {
      const r = route.request();
      if (r.method() === "POST" && r.headers()["next-action"] && dropped === 0) { dropped++; return route.abort("connectionreset"); }
      return route.continue();
    });
    await card.getByRole("button", { name: /^Save/ }).first().click();
    await page.waitForTimeout(3000);
    obs.afterDrop = { stored: (await client.query("select action_text from recommendations where id=$1", [t.recommendation.id])).rows[0].action_text, alert: await page.getByRole("alert").allInnerTexts(), draftKept: await card.locator("textarea").count() };
    expect.soft(obs.afterDrop.stored, "nothing stored when the request never arrived").toBe(t.action);
    expect.soft(obs.afterDrop.draftKept, "the researcher's draft is still open to retry").toBeGreaterThan(0);
    // Retry succeeds once.
    await card.getByRole("button", { name: /^Save/ }).first().click();
    await expect.poll(async () => (await client.query("select action_text from recommendations where id=$1", [t.recommendation.id])).rows[0].action_text, { timeout: 60_000 }).toBe(edited);
    await page.unroute("**/*");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Recommendations(\s*\d+)?$/ }).first().click();
    await expect(card).toContainText("Edited once.");
    obs.copies = Number((await client.query("select count(*) from recommendations where run_id=$1 and action_text=$2", [t.run.id, edited])).rows[0].count);
    expect.soft(obs.copies, "saved once").toBe(1);
    const story = await page.request.get(`${new URL(t.run.url).origin}/api/runs/${t.run.id}/story/export-docx`);
    const storyText = (await officeParts(await story.body())).map((p) => p.text).join(" ");
    obs.narrativeHasEdit = storyText.includes("Edited once.");
  } finally {
    writeFileSync(testInfo.outputPath("c3-observations.json"), JSON.stringify(obs, null, 2));
    console.log("C3_OBSERVATIONS", JSON.stringify(obs));
    await client.end();
  }
});

test("C4 leaving the page while the narrative is generating, then retrying", async ({ page }, testInfo) => {
  test.setTimeout(20 * 60_000);
  const client = db(); await client.connect();
  const obs = {};
  try {
    const t = await thread(page, testInfo, "change-interrupt");
    const narratives = async () => (await client.query("select count(*)::int n from deck_narratives where run_id=$1", [t.run.id]).catch(() => ({ rows: [{ n: null }] }))).rows[0].n;
    obs.before = await narratives();
    await page.goto(t.run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Insights report(\s*\d+)?$/ }).first().click();
    // Hold the regeneration request, leave the page, then let it continue.
    let held = null;
    await page.route("**/*", async (route) => {
      const r = route.request();
      if (r.method() === "POST" && r.headers()["next-action"] && !held) { held = route; return; }
      return route.continue();
    });
    await page.getByRole("button", { name: /^(Generate Insights Report|Regenerate report content)$/ }).click();
    await expect.poll(() => Boolean(held), { timeout: 30_000 }).toBe(true);
    await page.goto("about:blank");
    await held.continue().catch(() => {});
    await page.unroute("**/*");
    await page.waitForTimeout(5000);
    await page.goto(t.run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Insights report(\s*\d+)?$/ }).first().click();
    obs.afterInterrupt = { narratives: await narratives(), generated: await page.getByText(/^Generated \d/).count() };
    // Retry.
    await page.getByRole("button", { name: /^(Generate Insights Report|Regenerate report content)$/ }).click();
    await expect(page.getByRole("button", { name: "Regenerate report content", exact: true })).toBeVisible({ timeout: 180_000 });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Insights report(\s*\d+)?$/ }).first().click();
    await expect(page.getByText(/^Generated \d/)).toBeVisible();
    obs.afterRetry = await narratives();
    expect.soft(obs.afterRetry, "one current narrative after an interrupted run and a retry").toBe(obs.before);
    const docx = await page.request.get(`${new URL(t.run.url).origin}/api/runs/${t.run.id}/story/export-docx`);
    expect.soft(docx.status(), "report exports after the retry").toBe(200);
    obs.exportText = (await officeParts(await docx.body())).map((p) => p.text).join(" ").includes(t.action);
    expect.soft(obs.exportText, "researcher recommendation wording in the report after the retry").toBe(true);
  } finally {
    writeFileSync(testInfo.outputPath("c4-observations.json"), JSON.stringify(obs, null, 2));
    console.log("C4_OBSERVATIONS", JSON.stringify(obs));
    await client.end();
  }
});

test("C5 a data correction behind an accepted finding after downstream work: stale support is qualified, wording kept", async ({ page }, testInfo) => {
  test.setTimeout(20 * 60_000);
  const client = db(); await client.connect();
  const obs = {};
  try {
    const t = await thread(page, testInfo, "change-correction");
    const docId = (await client.query("select id from documents where run_id=$1 and kind='table'", [t.run.id])).rows[0].id;
    await page.goto(t.run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Import data(\s*\d+)?$/ }).first().click();
    const control = page.getByLabel("Data type: Purchase", { exact: true });
    await expect(control).toBeAttached({ timeout: 60_000 });
    const details = control.locator("xpath=ancestor::details");
    for (let i = 0; i < (await details.count()); i++) {
      const d = details.nth(i);
      if ((await d.getAttribute("open")) === null) await d.locator("summary").first().click();
    }
    obs.typeBefore = await control.inputValue();
    obs.options = await control.evaluate((s) => [...s.options].map((o) => o.value));
    const other = obs.options.find((v) => v && v !== obs.typeBefore && v !== "continuous");
    await control.selectOption(other);
    obs.typeAfter = other;
    await expect.poll(async () => JSON.stringify((await client.query("select variable_overrides from documents where id=$1", [docId])).rows[0].variable_overrides ?? {}), { timeout: 30_000 }).toContain("Purchase");
    await page.reload({ waitUntil: "networkidle" });
    // Findings, insights and the narrative after the correction.
    await page.getByRole("button", { name: /^Insights(\s*\d+)?$/ }).first().click();
    const card = page.locator(`[data-testid="synthesized-insight-card"][data-insight-id="${t.insight.id}"]`);
    obs.insightCard = squash(await card.innerText()).slice(0, 400);
    expect.soft(obs.insightCard, "the insight resting on the corrected variable is qualified").toMatch(QUALIFIER);
    await page.getByRole("button", { name: /^Insights report(\s*\d+)?$/ }).first().click();
    obs.narrativeBanner = await page.locator('[data-support-status]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-support-status")}: ${(e.innerText || "").slice(0, 160)}`));
    const ex = await exportsOf(page, t.run);
    for (const key of ["storyPptx", "storyDocx"]) {
      const parts = await officeParts(ex[key].body);
      const headline = t.insight.headline.replace(/…$/, "").slice(0, 50);
      obs[`${key}QualificationsSlideOnly`] = parts.filter((p) => p.text.includes(headline) && !QUALIFIER.test(p.text) && QUALIFICATIONS_SLIDE.test(p.text)).map((p) => p.name);
      obs[`${key}Unqualified`] = parts.filter((p) => p.text.includes(headline) && !QUALIFIER.test(p.text) && !QUALIFICATIONS_SLIDE.test(p.text)).map((p) => p.name);
      expect.soft(obs[`${key}Unqualified`], `${key}: the stale insight is never presented unqualified`).toEqual([]);
    }
    // Human work is kept.
    obs.note = (await client.query("select researcher_note from findings where id=$1", [t.finding.id]).catch(() => ({ rows: [{}] }))).rows[0]?.researcher_note ?? null;
    obs.recommendation = (await client.query("select action_text from recommendations where id=$1", [t.recommendation.id])).rows[0]?.action_text;
    expect.soft(obs.recommendation, "researcher recommendation kept").toBe(t.action);
  } finally {
    writeFileSync(testInfo.outputPath("c5-observations.json"), JSON.stringify(obs, null, 2));
    console.log("C5_OBSERVATIONS", JSON.stringify(obs));
    await client.end();
  }
});

test("C6 rejecting an insight after the narrative exists: left out of accepted exports, narrative qualified, regenerated narrative excludes it", async ({ page }, testInfo) => {
  test.setTimeout(20 * 60_000);
  const client = db(); await client.connect();
  const obs = {};
  try {
    const t = await thread(page, testInfo, "change-reject-insight");
    await page.goto(t.run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Insights(\s*\d+)?$/ }).first().click();
    const card = page.locator(`[data-testid="synthesized-insight-card"][data-insight-id="${t.insight.id}"]`);
    await card.getByRole("button", { name: "Reject", exact: true }).click();
    await expect.poll(async () => (await client.query("select review_status from synthesized_insights where id=$1", [t.insight.id])).rows[0].review_status, { timeout: 60_000 }).toBe("rejected");
    await page.reload({ waitUntil: "networkidle" });
    const headline = t.insight.headline.replace(/…$/, "").slice(0, 50);
    let ex = await exportsOf(page, t.run);
    obs.acceptedSynthHasRejected = xlsxText(ex.synthAccepted.body).includes(headline);
    expect.soft(obs.acceptedSynthHasRejected, "accepted-scope insights export leaves the rejected insight out").toBe(false);
    for (const key of ["storyPptx", "storyDocx"]) {
      const parts = await officeParts(ex[key].body);
      obs[`${key}BeforeRegen`] = parts.filter((p) => p.text.includes(headline) && !QUALIFIER.test(p.text) && !QUALIFICATIONS_SLIDE.test(p.text)).map((p) => p.name);
      expect.soft(obs[`${key}BeforeRegen`], `${key}: the narrative written before the rejection never presents the rejected insight unqualified`).toEqual([]);
    }
    // Regenerate the narrative: the rejected insight is no longer used.
    await page.getByRole("button", { name: /^Insights report(\s*\d+)?$/ }).first().click();
    await page.getByRole("button", { name: /^(Generate Insights Report|Regenerate report content)$/ }).click();
    await expect(page.getByRole("button", { name: "Regenerate report content", exact: true })).toBeEnabled({ timeout: 180_000 });
    await page.reload({ waitUntil: "networkidle" });
    ex = await exportsOf(page, t.run);
    for (const key of ["storyPptx", "storyDocx"]) {
      const parts = await officeParts(ex[key].body);
      obs[`${key}AfterRegen`] = parts.filter((p) => p.text.includes(headline) && !QUALIFIER.test(p.text) && !QUALIFICATIONS_SLIDE.test(p.text)).map((p) => p.name);
      expect.soft(obs[`${key}AfterRegen`], `${key}: the regenerated narrative does not present the rejected insight`).toEqual([]);
      expect.soft((await officeParts(ex[key].body)).map((p) => p.text).join(" "), `${key}: researcher recommendation on the other insight kept`).toContain(t.action);
    }
  } finally {
    writeFileSync(testInfo.outputPath("c6-observations.json"), JSON.stringify(obs, null, 2));
    console.log("C6_OBSERVATIONS", JSON.stringify(obs));
    await client.end();
  }
});

test("C7 an edited AI recommendation keeps its wording through re-synthesis, reload and export", async ({ page }, testInfo) => {
  test.setTimeout(20 * 60_000);
  const client = db(); await client.connect();
  const obs = {};
  try {
    const t = await thread(page, testInfo, "change-edit-regenerate");
    const ai = (await client.query("select id, action_text from recommendations where run_id=$1 and source='ai_suggested' and synthesized_insight_id is not null order by created_at limit 1", [t.run.id])).rows[0];
    obs.aiBefore = ai;
    expect(ai, "an AI recommendation exists on a synthesized insight").toBeTruthy();
    await page.goto(t.run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Recommendations(\s*\d+)?$/ }).first().click();
    const card = page.locator(`[data-testid="recommendation-card"][data-recommendation-id="${ai.id}"]`);
    await card.getByRole("button", { name: /^Edit/ }).first().click();
    const edited = "Researcher-edited action: test the offer with the female segment first.";
    await card.locator("textarea").first().fill(edited);
    await card.getByRole("button", { name: /^Save/ }).first().click();
    await expect.poll(async () => (await client.query("select action_text from recommendations where id=$1", [ai.id])).rows[0]?.action_text, { timeout: 60_000 }).toBe(edited);
    // Re-run synthesis.
    await page.getByRole("button", { name: /^Insights(\s*\d+)?$/ }).first().click();
    await page.getByRole("button", { name: /^(Run synthesis|Re-run synthesis)$/ }).click();
    await expect(page.getByRole("button", { name: /^(Run synthesis|Re-run synthesis)$/ })).toBeEnabled({ timeout: 180_000 });
    await page.reload({ waitUntil: "networkidle" });
    obs.afterResynthesis = (await client.query("select id, action_text, edited, status from recommendations where run_id=$1 and action_text=$2", [t.run.id, edited])).rows;
    expect.soft(obs.afterResynthesis.length, "the edited recommendation survives re-synthesis exactly once").toBe(1);
    await page.getByRole("button", { name: /^Recommendations(\s*\d+)?$/ }).first().click();
    await expect.soft(page.getByText(edited).first(), "edited wording shown after reload").toBeVisible();
    await page.getByRole("button", { name: /^Insights report(\s*\d+)?$/ }).first().click();
    await page.getByRole("button", { name: /^(Generate Insights Report|Regenerate report content)$/ }).click();
    await expect(page.getByRole("button", { name: "Regenerate report content", exact: true })).toBeEnabled({ timeout: 180_000 });
    const ex = await exportsOf(page, t.run);
    obs.storyHasEdit = (await officeParts(ex.storyDocx.body)).map((p) => p.text).join(" ").includes(edited);
    expect.soft(obs.storyHasEdit, "the regenerated report carries the edited wording").toBe(true);
  } finally {
    writeFileSync(testInfo.outputPath("c7-observations.json"), JSON.stringify(obs, null, 2));
    console.log("C7_OBSERVATIONS", JSON.stringify(obs));
    await client.end();
  }
});
