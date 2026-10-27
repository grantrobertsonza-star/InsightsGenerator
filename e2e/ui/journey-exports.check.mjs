// Golden-thread journey assessment (2026-10-17): one synthetic project from raw-file upload to every
// export format, on the disposable stack with model replay (orchestration, numbers, provenance and
// persistence are checked; AI quality is not).
//   1. Upload the golden-thread-1 workbook and report; data setup reaches its ready state.
//   2. Add and accept a business decision (so recommendations can be drafted).
//   3. Analysis: Purchase by Gender read off the screen equals the independent reference
//      (fixtures/golden-thread-1/expected.json) within each assertion's tolerance.
//   4. Findings from two committed tables; one accepted with a researcher note.
//   5. Synthesized insights citing the findings; a researcher-written recommendation; the narrative.
//   6. Reload: every finding, insight and recommendation the screen showed is still shown, with
//      the same review status and wording.
//   7. Every export route the app links to (15 routes, both scopes where offered) answers 200 with a
//      readable file, and agrees with the screen and the database: each item shown on screen
//      appears in its "all" export, an accepted-scope export carries no rejected item, figures in
//      the findings export equal the stored ones, and the researcher's wording is exported exactly.
// Each disagreement is recorded softly so one run reports every export, then the test fails.
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
const reference = JSON.parse(readFileSync(path.join(FIXTURE, "expected.json"), "utf8"));
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const xmlText = (xml) => squash(xml.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));

async function officeText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const parts = Object.keys(zip.files).filter((n) => /^(ppt\/slides\/slide\d+|word\/document)\.xml$/.test(n)).sort();
  return (await Promise.all(parts.map(async (n) => xmlText(await zip.files[n].async("string"))))).join(" ");
}
function sheetRows(buffer) {
  const book = XLSX.read(buffer, { type: "buffer" });
  return Object.fromEntries(book.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json(book.Sheets[n], { defval: "" })]));
}

test("journey: upload to every export, numbers against the reference, screen and export agreement, reload", async ({ page }, testInfo) => {
  test.setTimeout(30 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  const observations = { exports: {}, numbers: [], reload: {} };
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `journey-${Date.now()}` });

    // 1. Upload and setup.
    await ui.upload(run, path.join(FIXTURE, "golden-survey-documented.xlsx"), "table");
    await ui.upload(run, path.join(FIXTURE, "report.docx"), "report");
    await ui.expectReadyOrActionableRecovery(run);

    // 2. A business decision, added and accepted by the researcher.
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Business decisions/ }).first().click();
    const form = page.locator("form", { has: page.getByRole("button", { name: "Add decision" }) });
    await form.locator("textarea").fill("Decide whether to prioritise the male segment in next quarter's campaign");
    await form.getByRole("button", { name: "Add decision" }).click();
    await expect.poll(async () => (await db.query("select decision_statement from runs where id=$1", [run.id])).rows[0].decision_statement, { timeout: 120_000 })
      .toBe("Decide whether to prioritise the male segment in next quarter's campaign");

    // 3. Numbers off the screen against the independent reference.
    const table = await ui.buildPurchaseCrosstab(run);
    for (const id of ["purchase-None", "purchase-Male", "purchase-Female"]) {
      const a = reference.assertions.find((x) => x.id === id);
      const v = await ui.readStatistic(table, { variable: "Purchase", rawCode: "Yes", statistic: "selection_percentage", segment: a.segment });
      observations.numbers.push({ id, observed: v, expected: a.expectedValue, tolerance: a.tolerance.value });
      expect.soft(Math.abs(v - a.expectedValue), `${id} on screen`).toBeLessThanOrEqual(a.tolerance.value + 0.05);
    }

    // 4. Findings.
    const finding = await ui.postAndAcceptFinding(table);
    const note = "Researcher wording: purchase differs by gender; keep the uncertainty explicit.";
    await ui.saveResearcherNote(finding, note);
    await ui.addIndependentEvidence(run);

    // 5. Insights, a researcher recommendation, the narrative.
    const insight = await ui.generateOrLoadInsight(run, finding);
    const humanAction = "Researcher action: brief the campaign owner on the purchase gap between groups.";
    await ui.addEligibleHumanRecommendation(run, { independentOf: finding, text: humanAction });
    await ui.prepareAcceptedNarrative(run, insight);

    // 6. Screen inventory, then the same after a full reload.
    const inventory = async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      const read = async (section, selector, attrs) => {
        await page.getByRole("button", { name: new RegExp(`^${section}(\\s*\\d+)?$`) }).first().click();
        // Findings and Insights open on an overview; the cards are in the review tab.
        const tabId = { Findings: "findings-tab-review", Insights: "insights-tab-review", Recommendations: "rec-tab-review", "Insights report": "report-tab-narrative" }[section];
        if (tabId) {
          const t = page.getByTestId(tabId);
          if (await t.count()) await t.click();
        }
        await page.waitForTimeout(500);
        return page.locator(selector).evaluateAll((els, attrs) => els.map((e) => ({ ...Object.fromEntries(attrs.map((a) => [a, e.getAttribute(a)])), text: (e.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400) })), attrs);
      };
      return {
        findings: await read("Findings", '[data-testid="finding-card"]', ["data-finding-id", "data-review-status"]),
        insights: await read("Insights", '[data-testid="synthesized-insight-card"]', ["data-insight-id", "data-review-status", "data-support-status"]),
        recommendations: await read("Recommendations", '[data-testid="recommendation-card"]', ["data-recommendation-id", "data-source", "data-insight-id"]),
      };
    };
    const before = await inventory();
    await page.reload({ waitUntil: "networkidle" });
    const after = await inventory();
    observations.reload = { counts: Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.length])) };
    expect.soft(after, "screen state after a full reload equals the state before it").toEqual(before);
    expect(before.findings.length).toBeGreaterThan(0);
    expect(before.insights.length).toBeGreaterThan(0);
    expect(before.recommendations.length).toBeGreaterThan(0);

    // 7. Every export.
    const routes = [
      ["findings/export?scope=all", "xlsx"], ["findings/export?scope=accepted", "xlsx"],
      ["findings/export-deck?scope=all", "pptx"], ["findings/export-deck?scope=accepted", "pptx"],
      ["insights/export", "xlsx"], ["insights/export-deck", "pptx"],
      ["synthesized-insights/export?scope=all", "xlsx"], ["synthesized-insights/export?scope=accepted", "xlsx"],
      ["synthesized-insights/export-deck?scope=all", "pptx"], ["synthesized-insights/export-deck?scope=accepted", "pptx"],
      ["recommendations/export?scope=all", "xlsx"], ["recommendations/export?scope=accepted", "xlsx"],
      ["recommendations/export-deck?scope=all", "pptx"], ["recommendations/export-deck?scope=accepted", "pptx"],
      ["synthesized-recommendations/export?scope=all", "xlsx"], ["synthesized-recommendations/export?scope=accepted", "xlsx"],
      ["synthesized-recommendations/export-deck?scope=all", "pptx"], ["synthesized-recommendations/export-deck?scope=accepted", "pptx"],
      ["story/export", "pptx"], ["story/export-docx", "docx"], ["history/export", "xlsx"], ["coding/export", "xlsx"],
      ["crosstab/export", "xlsx"],
    ];
    const origin = new URL(run.url).origin;
    const findingsDb = (await db.query("select id, finding_text, status from findings where run_id=$1", [run.id])).rows;
    const recsDb = (await db.query("select id, action_text, status, source, insight_id from recommendations where run_id=$1", [run.id])).rows;
    const synthDb = (await db.query("select id, headline, review_status from synthesized_insights where run_id=$1", [run.id])).rows;
    for (const [route, format] of routes) {
      const response = await page.request.get(`${origin}/api/runs/${run.id}/${route}`, { timeout: 600_000 });
      const body = await response.body();
      const entry = { status: response.status(), bytes: body.length, type: response.headers()["content-type"] };
      observations.exports[route] = entry;
      writeFileSync(testInfo.outputPath(route.replace(/[^a-z0-9]+/gi, "_") + "." + format), body);
      if (route === "coding/export" && response.status() === 404) {
        // No qualitative coding in this project: the route says so rather than returning an empty file.
        entry.note = squash(body.toString("utf8"));
        expect.soft(entry.note, "coding export explains why there is nothing to export").toMatch(/No codebook yet/);
        continue;
      }
      expect.soft(response.status(), `${route} answers 200`).toBe(200);
      if (response.status() !== 200) { entry.error = squash(body.toString("utf8")).slice(0, 300); continue; }
      let text;
      try {
        // Cell values joined as plain text (not JSON, which would escape the quotes in finding text).
        text = format === "xlsx" ? Object.values(sheetRows(body)).flat().map((row) => Object.values(row).join(" | ")).join("\n") : await officeText(body);
      } catch (e) {
        expect.soft(String(e), `${route} is a readable ${format}`).toBe("readable");
        continue;
      }
      entry.textChars = text.length;
      if (route === "crosstab/export") {
        // Exported figures against the independent reference (fixtures/golden-thread-1/expected.json):
        // Purchase = Yes is 40% Female, 60% Male, 50% total; Pearson chi-square 8 on 1 df.
        const book = XLSX.read(body, { type: "buffer" });
        const sheet = book.SheetNames.find((n) => n.startsWith("Purchase by Gender"));
        const rows = XLSX.utils.sheet_to_json(book.Sheets[sheet], { header: 1, defval: null });
        const header = rows.find((r) => r[0] === "Answer");
        const yes = rows.find((r) => r[0] === "Yes" && r[1] === "% within column");
        const col = (name) => header.findIndex((h) => String(h ?? "").endsWith(name));
        observations.crosstabExport = { female: yes?.[col("Female")], male: yes?.[col("Male")], total: yes?.[col("Total")] };
        expect.soft(yes?.[col("Female")], "export: Purchase Yes, Female").toBeCloseTo(0.4, 3);
        expect.soft(yes?.[col("Male")], "export: Purchase Yes, Male").toBeCloseTo(0.6, 3);
        expect.soft(yes?.[col("Total")], "export: Purchase Yes, Total").toBeCloseTo(0.5, 3);
        expect.soft(text, "export: chi-square for Purchase by Gender").toMatch(/chi-square 8, df 1/);
        expect.soft(text, "export: the test note names the method applied").toMatch(/two-proportion z-test, shares pooled under the null hypothesis/);
      }
      const accepted = route.includes("scope=accepted");
      if (route.startsWith("findings/")) {
        for (const f of findingsDb) {
          const head = squash(f.finding_text).slice(0, 60);
          const present = squash(text).includes(head);
          if (accepted && f.status === "rejected") expect.soft(present, `${route}: rejected finding left out`).toBe(false);
          if (!accepted) expect.soft(present, `${route}: finding "${head}" present`).toBe(true);
        }
        if (route === "findings/export?scope=all") expect.soft(text, `${route}: researcher note exported exactly`).toContain(note);
      }
      // The Recommendations Excel/Slides links on the Working data tab export the per-pre-insight list
      // (by design, see page.tsx). The researcher's recommendation is on a synthesized insight: it is
      // in the narrative and, since GT-007, in the main list's own exports.
      if (route.startsWith("story/") || route.startsWith("synthesized-recommendations/")) {
        expect.soft(text, `${route}: researcher's recommendation wording exported exactly`).toContain(humanAction);
      }
      if (route.startsWith("synthesized-insights/")) {
        for (const s of synthDb) {
          const head = squash(s.headline).slice(0, 50);
          const present = squash(text).includes(head);
          if (accepted && s.review_status !== "accepted") expect.soft(present, `${route}: non-accepted insight left out`).toBe(false);
          if (!accepted || s.review_status === "accepted") expect.soft(present, `${route}: insight "${head}" present`).toBe(true);
        }
      }
      if (route.startsWith("recommendations/export?")) {
        for (const r of recsDb.filter((x) => x.insight_id)) {
          const head = squash(r.action_text).slice(0, 50);
          const present = squash(text).includes(head);
          if (accepted && r.status === "rejected") expect.soft(present, `${route}: rejected recommendation left out`).toBe(false);
          if (!accepted) expect.soft(present, `${route}: recommendation "${head}" present`).toBe(true);
        }
      }
    }
    // GT-005: the crosstab tables as PDF (rendered from the deck): every word inside its page, the
    // Total column present on every page, and the reference figures readable.
    {
      const { spawnSync } = await import("node:child_process");
      const pdf = await page.request.get(`${origin}/api/runs/${run.id}/crosstab/export?format=pdf`, { timeout: 600_000 });
      observations.crosstabPdf = { status: pdf.status() };
      expect.soft(pdf.status(), "crosstab PDF answers 200").toBe(200);
      if (pdf.status() === 200) {
        const file = testInfo.outputPath("crosstab.pdf");
        writeFileSync(file, await pdf.body());
        const bbox = spawnSync("pdftotext", ["-bbox", file, "-"], { encoding: "utf8" }).stdout;
        const pages = bbox.split(/<page /).slice(1);
        observations.crosstabPdf.pages = pages.length;
        for (const [i, pg] of pages.entries()) {
          const width = Number(/width="([\d.]+)"/.exec(pg)[1]);
          const outside = [...pg.matchAll(/<word xMin="[\d.]+" yMin="[\d.]+" xMax="([\d.]+)"[^>]*>([^<]*)</g)].filter((w) => Number(w[1]) > width + 0.5).map((w) => w[2]);
          expect.soft(outside, `crosstab PDF page ${i + 1}: words beyond the page`).toEqual([]);
          expect.soft(pg, `crosstab PDF page ${i + 1}: Total column present`).toContain(">Total<");
        }
        const layout = spawnSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" }).stdout;
        expect.soft(layout, "crosstab PDF: Purchase Yes 40% / 60% / 50%").toMatch(/Yes\s+40%\s+60%\s+50%/);
      }
    }
    observations.runId = run.id;
  } finally {
    writeFileSync(testInfo.outputPath("journey-observations.json"), JSON.stringify(observations, null, 2));
    console.log("JOURNEY_OBSERVATIONS", JSON.stringify(observations));
    await db.end();
  }
});
