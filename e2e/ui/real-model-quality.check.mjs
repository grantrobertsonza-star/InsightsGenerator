// Real-model quality pass (authorised by Grant, 2026-10-17). Runs ONLY on a stack started with the
// loopback budget gateway (target manifest modelMode "real-model"); on the usual replay stack it
// skips, because replay answers say nothing about model quality.
//
// One synthetic project from golden-thread-1 through the native controls: the survey workbook and
// the planted-claim report are uploaded, a business decision is accepted, "Run analysis" runs the
// pipeline (report extraction, claim checks against the data, verification, insights), then
// "Run synthesis". The model's judgements are then compared with the fixture's independent answer
// key (fixtures/golden-thread-1/history/answer-key.json):
//   - the ten report claims C1 to C10: five correct, three wrong (C6 70%, C7 4.2, C8 the NearTie
//     significance), two unsupported (C9 the 16-person subgroup, C10 advertising caused loyalty).
//     A correct claim should pass verification (robust / use with caution); a wrong or unsupported
//     one should not (not supported / insufficient information);
//   - the omitted effect the report never mentions (Convenience 70% men vs 50% women): is it found;
//   - numerical traceability of the AI-written insights (figure checks);
//   - cost and calls, from the gateway log.
// This is a MEASUREMENT on one fixture and one run, not a pass threshold: the test fails only when
// the pipeline itself does not complete. Results go to real-model-quality.json and stdout.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FIXTURE = path.resolve("fixtures/golden-thread-1");
const key = JSON.parse(readFileSync(path.join(FIXTURE, "history/answer-key.json"), "utf8"));

// Each claim is recognised by the report's own "Cn:" label, or failing that by its distinctive
// content (claims are extracted by the model, so wording can drift; identity is never position).
const CLAIMS = [
  { id: "C1", expect: "pass", markers: [/purchase intention is\s*50\s*%/i] },
  { id: "C2", expect: "pass", markers: [/satisfaction is\s*3\.5/i] },
  { id: "C3", expect: "pass", markers: [/NPS is\s*25\b/i] },
  { id: "C4", expect: "pass", markers: [/Convenience is selected by\s*60\s*%/i] },
  { id: "C5", expect: "pass", markers: [/60\s*%\s*among men.*40\s*%\s*among women/i] },
  { id: "C6", expect: "fail", markers: [/purchase intention is\s*70\s*%/i] },
  { id: "C7", expect: "fail", markers: [/satisfaction is\s*4\.2/i] },
  { id: "C8", expect: "fail", markers: [/NearTie|51\s*%.*49\s*%/i] },
  { id: "C9", expect: "fail", markers: [/16 respondents|small subgroup/i] },
  { id: "C10", expect: "fail", markers: [/Advertising caused/i] },
];
const PASSING = new Set(["robust", "use_with_caution"]);

test("real-model quality on golden-thread-1: claim verdicts, omitted effect, figure traceability, cost", async ({ page }, testInfo) => {
  // REAL_MODEL_QUALITY_HARNESS_TEST=1 runs it on a replay stack to test the harness itself; its output
  // is then marked as a harness test, never a quality result.
  const harnessTest = process.env.REAL_MODEL_QUALITY_HARNESS_TEST === "1";
  test.skip(target.modelMode !== "real-model" && !harnessTest, "Replay stack: model quality cannot be measured from replay answers.");
  test.setTimeout(60 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  const out = { fixture: "golden-thread-1", modelMode: target.modelMode, harnessTestOnly: target.modelMode !== "real-model", startedAt: new Date().toISOString() };
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `real-model-${Date.now()}` });
    out.runId = run.id;
    await ui.upload(run, path.join(FIXTURE, "golden-survey-documented.xlsx"), "table");
    await ui.upload(run, path.join(FIXTURE, "report.docx"), "report");
    await ui.expectReadyOrActionableRecovery(run);
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Business decisions/ }).first().click();
    const form = page.locator("form", { has: page.getByRole("button", { name: "Add decision" }) });
    const decision = "Choose whether to prioritize convenience improvements, and whether a gender-specific offer is justified";
    await form.locator("textarea").fill(decision);
    await form.getByRole("button", { name: "Add decision" }).click();
    await expect.poll(async () => (await db.query("select decision_statement from runs where id=$1", [run.id])).rows[0].decision_statement, { timeout: 300_000 }).toBe(decision);

    // Run analysis, then wait for the pipeline: the in-memory progress tracker reports "done".
    await page.goto(run.url, { waitUntil: "networkidle" });
    // The "Run analysis" control sits in the Findings section's toolbar.
    await page.getByRole("button", { name: /^Findings(\s*\d+)?$/ }).first().click();
    await page.getByRole("button", { name: "Run analysis", exact: true }).first().click({ timeout: 120_000 });
    const origin = new URL(run.url).origin;
    const progress = async () => (await (await page.request.get(`${origin}/api/runs/${run.id}/process-progress`)).json()).progress;
    // Started: the action stamps a process_run_batch trace row before any model call.
    await expect.poll(async () => Number((await db.query("select count(*) from trace where run_id=$1 and event='process_run_batch'", [run.id])).rows[0].count), { timeout: 120_000, intervals: [2000] }).toBeGreaterThan(0);
    // Finished: the in-memory tracker reads "done" (or has already been dropped after finishing).
    await expect.poll(async () => (await progress())?.phase ?? "done", { timeout: 40 * 60_000, intervals: [10_000] }).toBe("done");
    // Verification can settle just after the tracker: wait for two equal readings of findings and verdicts.
    let last = "";
    await expect.poll(async () => {
      const r = (await db.query("select (select count(*) from findings where run_id=$1) as f, (select count(*) from verdicts v join findings f on f.id=v.finding_id where f.run_id=$1) as v", [run.id])).rows[0];
      const now = `${r.f}/${r.v}`;
      const stable = now === last;
      last = now;
      return stable;
    }, { timeout: 15 * 60_000, intervals: [20_000] }).toBe(true);

    // Synthesis.
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Insights(\s*\d+)?$/ }).first().click();
    const synth = page.getByRole("button", { name: /^(Run synthesis|Re-run synthesis)$/ }).first();
    // Synthesis needs insights; when none were drafted it produces nothing, which is recorded, not
    // a harness failure, so the measurements below always run.
    if (await synth.isVisible().catch(() => false)) {
      await synth.click();
      try {
        await expect.poll(async () => Number((await db.query("select count(*) from synthesized_insights where run_id=$1", [run.id])).rows[0].count), { timeout: Number(process.env.REAL_MODEL_QUALITY_SYNTH_TIMEOUT_MS ?? 15 * 60_000), intervals: [10_000] }).toBeGreaterThan(0);
      } catch {
        out.synthesis = "no synthesized insight appeared within the wait";
      }
    } else {
      out.synthesis = "Run synthesis was not offered";
    }

    // ---- measurements -------------------------------------------------------------------
    const findings = (await db.query(
      `select f.id, f.origin, f.finding_kind, f.finding_text, f.status, v.verdict_tier, v.rationale
         from findings f
         left join lateral (select verdict_tier, rationale from verdicts lv where lv.finding_id = f.id order by lv.created_at desc, lv.id desc limit 1) v on true
        where f.run_id = $1 order by f.created_at`,
      [run.id],
    )).rows;
    out.findingCounts = { total: findings.length, byOrigin: findings.reduce((m, f) => ((m[f.origin] = (m[f.origin] ?? 0) + 1), m), {}) };
    const fromReport = findings.filter((f) => f.origin !== "generated");
    out.claims = CLAIMS.map((c) => {
      const label = new RegExp(`\\b${c.id}\\b\\s*[:.]`);
      const matched = fromReport.filter((f) => label.test(f.finding_text) || c.markers.some((m) => m.test(f.finding_text)));
      const verdicts = matched.map((f) => f.verdict_tier ?? "none");
      const judged = verdicts.filter((v) => v !== "none");
      const passed = judged.some((v) => PASSING.has(v));
      const outcome = matched.length === 0 ? "not extracted" : judged.length === 0 ? "not verified" : (c.expect === "pass") === passed ? "agrees" : "disagrees";
      return { id: c.id, expected: key.claims[c.id], expectedOutcome: c.expect, extracted: matched.length, verdicts, outcome, texts: matched.map((f) => f.finding_text.slice(0, 160)), rationale: matched[0]?.rationale?.slice(0, 300) ?? null };
    });
    out.claimSummary = out.claims.reduce((m, c) => ((m[c.outcome] = (m[c.outcome] ?? 0) + 1), m), {});
    const generated = findings.filter((f) => f.origin === "generated");
    const omitted = generated.filter((f) => /convenien/i.test(f.finding_text) && /70/.test(f.finding_text) && /50/.test(f.finding_text));
    const insightsText = (await db.query("select headline || ' ' || observation as t from synthesized_insights where run_id=$1 union all select headline || ' ' || observation from insights where run_id=$1", [run.id])).rows.map((r) => r.t);
    out.omittedEffect = {
      expected: key.omitted_effect,
      foundAsFinding: omitted.map((f) => f.finding_text.slice(0, 200)),
      foundInInsights: insightsText.filter((t) => /convenien/i.test(t) && /(men|male).*(women|female)|(women|female).*(men|male)/i.test(t)).map((t) => t.slice(0, 200)),
    };
    const figure = (await db.query(
      `select 'synthesized' as kind, figure_check->>'status' as status, count(*)::int as n from synthesized_insights where run_id=$1 group by 2
       union all select 'recommendation', figure_check->>'status', count(*)::int from recommendations where run_id=$1 group by 2`,
      [run.id],
    ).catch((e) => ({ rows: [{ error: String(e) }] }))).rows;
    out.figureChecks = figure;
    out.counts = {
      insights: Number((await db.query("select count(*) from insights where run_id=$1", [run.id])).rows[0].count),
      synthesized: Number((await db.query("select count(*) from synthesized_insights where run_id=$1", [run.id])).rows[0].count),
      recommendations: Number((await db.query("select count(*) from recommendations where run_id=$1", [run.id])).rows[0].count),
    };
    const usage = (await db.query("select detail from trace where run_id=$1 and event='api_usage'", [run.id])).rows.map((r) => r.detail);
    out.appUsage = { calls: usage.length, inputTokens: usage.reduce((s, u) => s + (u.input_tokens ?? 0), 0), outputTokens: usage.reduce((s, u) => s + (u.output_tokens ?? 0), 0) };
    const gatewayLog = path.resolve("e2e-results/model-gateway-log.json");
    if (existsSync(gatewayLog)) {
      const g = JSON.parse(readFileSync(gatewayLog, "utf8"));
      out.gateway = { budgetUsd: g.budgetUsd, spentUsd: g.spentUsd, calls: g.calls.length, refused: g.calls.filter((c) => c.status === 402).length, failed: g.calls.filter((c) => c.status !== 200 && c.status !== 402).length };
    }
    expect(out.findingCounts.total, "the pipeline produced findings").toBeGreaterThan(0);
  } finally {
    out.finishedAt = new Date().toISOString();
    writeFileSync(testInfo.outputPath("real-model-quality.json"), JSON.stringify(out, null, 2));
    writeFileSync(path.resolve("e2e-results/real-model-quality.json"), JSON.stringify(out, null, 2));
    console.log("REAL_MODEL_QUALITY", JSON.stringify(out));
    await db.end();
  }
});
