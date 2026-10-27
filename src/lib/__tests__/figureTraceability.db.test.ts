// Numerical traceability applied to every agreed AI-output path, against a REAL PostgreSQL
// (disposable database from every migration, including 0101) through the app's own db.ts. The
// ACTUAL generators, assistant revision, loaders and export routes run; only the model client,
// usage logging, the quality scorers, the contradiction refresh, storage and Next's cache are
// mocked. Model responses are scripted per tool and per input.
//   - pre-insights: an unsupported figure keeps that pre-insight out (traced as partial, the
//     finding stays eligible); a figure needing review is saved WITH its check
//   - synthesized insights: an unsupported figure fails the gate (not published, reason in the
//     summary trace); a traced one is published with its check
//   - recommendations: a conflicting figure is held back (the run reports it missing, with the
//     reason); a proposed target needs review and is saved with its check; a researcher's edit
//     clears the check (no claim about human wording)
//   - assistant narrative revision: an unsupported figure refuses the revision (narrative
//     unchanged, the reply says why); a figure needing review is applied with its check
//   - screen loader and exports carry what needs review: the run loader, the synthesized-insight
//     spreadsheet column and the story deck's evidence-status slide
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

const TENANT = "00000000-0000-4000-8000-0000000000c9";
const model = vi.hoisted(() => ({ assistant: null as null | Record<string, unknown> }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/narrativeFreshness", async () => await import("../narrativeFreshness"));
vi.mock("@/lib/evidenceTrail", async () => await import("../evidenceTrail"));
vi.mock("@/lib/evidenceTrailSlides", async () => await import("../evidenceTrailSlides"));
vi.mock("@/lib/objectiveCoverage", async () => await import("../objectiveCoverage"));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/deckSlides", async () => await import("../deckSlides"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/narrativeSupportSummary", async () => await import("../narrativeSupportSummary"));
vi.mock("@/lib/supportStatus", async () => await import("../supportStatus"));
vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));
vi.mock("@/lib/figureChecks", async () => await import("../figureChecks"));
vi.mock("@/lib/numberTrace", async () => await import("../numberTrace"));
vi.mock("@/lib/caveatLabels", async () => await import("../caveatLabels"));
vi.mock("@/lib/storyNarrative", async () => await import("../storyNarrative"));
vi.mock("@/lib/discoverySlides", () => ({ addDiscoverySlides: vi.fn() }));
// Discovery data is not what these tests are about: an empty section, with the real support rule.
vi.mock("@/lib/discoveryReport", async () => ({
  ...(await import("../discoveryReport")),
  loadDiscoveryReportData: vi.fn(async () => ({ inputState: "complete", netNewSources: [], verificationNote: null, netNewInsights: [], netNewFindings: [], netNewFindingsOmitted: 0, contradictions: [] })),
}));
vi.mock("@/lib/exportChartImages", () => ({ buildChartImagesByTheme: vi.fn(async () => []) }));
vi.mock("@/lib/latestVerdict", async () => await import("../latestVerdict"));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../recommendationQualityScorer", () => ({ refreshRecommendationQuality: vi.fn() }));
vi.mock("../objectiveQualityScorer", () => ({ refreshObjectiveQuality: vi.fn() }));
vi.mock("../contradictionDetector", () => ({ refreshContradictions: vi.fn() }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { tool_choice?: { name?: string }; messages: { content: string }[] }) => {
        const content = req.messages[0].content;
        const tool = (input: unknown) => ({ stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", name: req.tool_choice?.name, input }] });
        switch (req.tool_choice?.name) {
          case "record_insights": {
            // Findings in eligible order: satisfaction (0), loyalty (1).
            return tool({
              insights: [
                { index: 0, headline: "Satisfaction is high", observation: "Satisfaction is 72% among recent customers.", tension: "About 72 in every hundred are content.", implication: "Protect it." },
                { index: 1, headline: "Loyalty is solid", observation: "Loyalty is 55% among members.", tension: "t", implication: "i" },
              ],
            });
          }
          case "record_clusters":
            return tool({ clusters: [{ label: "Trust", member_indices: [0, 1] }, { label: "Price", member_indices: [2, 3] }] });
          case "record_synthesized_insight": {
            const price = /Price sensitivity/.test(content);
            return tool({
              headline: price ? "Price sensitivity rose 30% this year" : "Trust is 72% among customers",
              observation: price ? "Price sensitivity is rising." : "Trust is 72% among customers, across two sources.",
              tension: "t",
              implication: "i",
              action_plan_status: "has_action",
              materiality_rationale: "m",
              passes_validity_gate: true,
            });
          }
          case "record_synthesized_recommendations":
          case "record_recommendations": {
            const recs = [...content.matchAll(/^(\d+)\. Headline: (.*)$/gm)].map((m) => {
              const loyalty = /Loyalty/.test(m[2]);
              return {
                index: Number(m[1]),
                action_text: loyalty ? "Treat loyalty as 40 points among members." : "Lift trust to 80% among customers.",
                owner_role: "Lead",
                owner_feasibility_note: "n",
                timeline: "Q1 2027",
                metric: "m",
                priority: "high",
                assumptions_and_risks: "a",
                alternatives_considered: "b",
              };
            });
            return tool({ recommendations: recs });
          }
          default:
            return { stop_reason: "tool_use", usage: {}, content: [{ type: "text", text: "Done." }, { type: "tool_use", name: "revise_narrative", input: model.assistant }] };
        }
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 60000 });

describe.skipIf(!TEST_DATABASE_URL)("numerical traceability on every AI-output path (real database)", () => {
  let db: DisposableDb;
  const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows as T[];
  const one = async (sql: string, p: unknown[]) => (await q<{ id: string }>(sql, p))[0].id;
  const newRun = () => one(`insert into runs (tenant_id, decision_statement, project_name) values ($1, 'Decide', 'Figures') returning id`, [TENANT]);
  const verdict = (f: string) =>
    q(
      `insert into verdicts (tenant_id, finding_id, verdict_tier, rationale, statistical_checks, verification_method, corroboration_level, due_care)
       values ($1, $2, 'robust', 'Checked.', '{}', 'single_pass', 'single_source', '{}')`,
      [TENANT, f],
    );
  const finding = async (run: string, text: string, theme: string) => {
    const f = await one(`insert into findings (tenant_id, run_id, origin, finding_text, status, theme) values ($1, $2, 'stated', $3, 'accepted', $4) returning id`, [
      TENANT,
      run,
      text,
      theme,
    ]);
    await verdict(f);
    return f;
  };
  const synthesized = async (run: string, headline: string, observation: string) => {
    const f = await finding(run, observation, "T");
    const pi = await one(
      `insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, $4, $5, 't', 'i') returning id`,
      [TENANT, run, f, headline, observation],
    );
    const si = await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count, review_status, action_plan_status)
       values ($1, $2, $3, $4, 't', 'i', 1, 1, 'accepted', 'has_action') returning id`,
      [TENANT, run, headline, observation],
    );
    await q(`insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id) values ($1, $2, $3)`, [TENANT, si, pi]);
    return si;
  };

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = TENANT;
    await q(`insert into tenants (id, name) values ($1, 'T')`, [TENANT]);
  }, 120000);
  afterAll(async () => {
    // The assistant now takes a capacity slot from the claim pool (RR-F08): both pools are closed
    // before the database is dropped (Codex RR-M03).
    const { pool, claimPool } = await import("../db");
    await pool?.end?.();
    await claimPool?.end?.();
    await db?.drop();
  });

  it("pre-insights: an unsupported figure keeps that one out (traced as partial); a figure needing review is saved with its check", async () => {
    const run = await newRun();
    const fSat = await finding(run, "Satisfaction is 72% among recent customers.", "A");
    const fLoy = await finding(run, "Loyalty is 40% among members.", "B");
    const { generateInsights } = await import("../insightGenerator");
    await generateInsights(TENANT, run);
    const rows = await q<{ finding_id: string; figure_check: { status: string; figures: { text: string; status: string }[] } }>(
      `select finding_id, figure_check from insights where run_id = $1`,
      [run],
    );
    expect(rows.map((r) => r.finding_id)).toEqual([fSat]);
    expect(rows[0].figure_check).toMatchObject({ status: "needs_review", figures: [{ text: "72", status: "needs_review" }] });
    expect(rows.some((r) => r.finding_id === fLoy)).toBe(false);
    const trace = await q<{ detail: { failures: string[] } }>(`select detail from trace where run_id = $1 and event = 'insight_generator_partial'`, [run]);
    expect(trace[0].detail.failures.join(" ")).toMatch(/55: 55 does not appear in the cited evidence/);
  });

  it("synthesized insights: an unsupported figure fails the gate (not published, reason traced); a traced one is published with its check", async () => {
    const run = await newRun();
    const pre = async (text: string, theme: string) => {
      const f = await finding(run, text, theme);
      return one(
        `insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, $4, $4, 't', 'i') returning id`,
        [TENANT, run, f, text],
      );
    };
    await pre("Trust is 72% among customers.", "A");
    await pre("Trust is 72% among customers in the second survey.", "A");
    await pre("Price sensitivity is high among students.", "B");
    await pre("Price sensitivity is high among retirees.", "B");
    const { synthesizeInsights } = await import("../insightSynthesizer");
    await synthesizeInsights(TENANT, run);
    const published = await q<{ headline: string; figure_check: { status: string } }>(`select headline, figure_check from synthesized_insights where run_id = $1`, [run]);
    expect(published).toEqual([{ headline: "Trust is 72% among customers", figure_check: expect.objectContaining({ status: "traced" }) }]);
    const summary = await q<{ detail: { outcomes: { outcome: string; gate_failure_reason: string | null }[] } }>(
      `select detail from trace where run_id = $1 and event = 'insight_synthesizer_summary'`,
      [run],
    );
    const failed = summary[0].detail.outcomes.find((o) => o.outcome === "gate_failed")!;
    expect(failed.gate_failure_reason).toMatch(/figures not supported by the clustered pre-insights: 30 \(30 does not appear/);
  });

  it("recommendations: a conflicting figure is held back and reported; a proposed target is saved needing review; an edit clears the check", async () => {
    const run = await newRun();
    const trust = await synthesized(run, "Trust is 72% among customers", "Trust is 72% among customers.");
    const loyalty = await synthesized(run, "Loyalty is 40% among members", "Loyalty is 40% among members.");
    const { generateSynthesizedRecommendations } = await import("../recommendationAgent");
    await expect(generateSynthesizedRecommendations(TENANT, run)).rejects.toThrow(
      /written for 1 of 2 insights.*held back for figures not supported by their insight: 40: 40 is in points here but a percentage in the evidence/,
    );
    const recs = await q<{ id: string; synthesized_insight_id: string; figure_check: { status: string; figures: { text: string }[] } }>(
      `select id, synthesized_insight_id, figure_check from recommendations where run_id = $1`,
      [run],
    );
    expect(recs.map((r) => r.synthesized_insight_id)).toEqual([trust]);
    expect(recs[0].figure_check).toMatchObject({ status: "needs_review", figures: [{ text: "80" }] });
    expect(recs.some((r) => r.synthesized_insight_id === loyalty)).toBe(false);

    const { updateAndAcceptRecommendation } = await import("../recommendationActions");
    await updateAndAcceptRecommendation(run, recs[0].id, {
      action_text: "Lift trust among customers.",
      owner_role: "Lead",
      owner_feasibility_note: "n",
      timeline: "Q1",
      metric: "m",
      priority: "high",
      assumptions_and_risks: "a",
      alternatives_considered: "b",
    });
    expect((await q(`select figure_check from recommendations where id = $1`, [recs[0].id]))[0]).toEqual({ figure_check: null });
  });

  it("assistant revision: an unsupported figure is refused (narrative unchanged); a figure needing review is applied with its check; loader and exports carry it", async () => {
    const run = await newRun();
    const si = await synthesized(run, "Leadership NPS is 25", "NPS is 25 (95% interval 14.4 to 35.6, base 200).");
    await q(
      `insert into deck_narratives (tenant_id, run_id, executive_summary, situation, complication, question, governing_thought, pillars, recommendations_intro, caveats, generated_at)
       values ($1, $2, 'Leadership NPS is 25.', 's', 'c', 'q', 'g', $3, 'r', '[]', now())`,
      [TENANT, run, JSON.stringify([{ theme: "Advocacy", headline: "Leadership NPS is 25.", so_what: "w", insight_ids: [si], insight_overflow_count: 0 }])],
    );
    const { askResearchAssistant } = await import("../researchAssistant");

    model.assistant = { executive_summary: "NPS is 25, give or take 15 points." };
    const refused = await askResearchAssistant(TENANT, run, "Tighten the summary");
    expect(refused.reply).toMatch(/The revision was not applied: it states figures the evidence does not support \(executive summary: 15/);
    expect((await q(`select executive_summary from deck_narratives where run_id = $1`, [run]))[0]).toEqual({ executive_summary: "Leadership NPS is 25." });

    model.assistant = { executive_summary: "Leaders are net promoters at 25." };
    const applied = await askResearchAssistant(TENANT, run, "Reword the summary");
    expect(applied.revisedFields).toEqual(["executive_summary"]);
    const stored = (await q<{ executive_summary: string; figure_check: { status: string } }>(`select executive_summary, figure_check from deck_narratives where run_id = $1`, [run]))[0];
    expect(stored).toMatchObject({ executive_summary: "Leaders are net promoters at 25.", figure_check: { status: "needs_review" } });

    const { loadRunFigureChecks } = await import("../figureChecks");
    const client = await db.pool.connect();
    try {
      const checks = await loadRunFigureChecks(client, run);
      expect(checks.available).toBe(true);
      expect(checks.narrative).toMatchObject({ status: "needs_review" });
    } finally {
      client.release();
    }

    const { GET } = await import("../../app/api/runs/[id]/story/export/route");
    const res = await GET(new Request("http://x/"), { params: Promise.resolve({ id: run }) });
    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const xml = await Promise.all(Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => zip.file(n)!.async("string")));
    const deck = xml.join("\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(deck).toMatch(/Report narrative\. Figures need review: 25 \(/);
  });

  it("the synthesized-insight spreadsheet states the figure check per row: needs review, all traced, or not checked", async () => {
    const run = await newRun();
    const legacy = await synthesized(run, "Legacy insight", "Loyalty is 40% among members.");
    const traced = await synthesized(run, "Traced insight", "Trust is 72% among customers.");
    const review = await synthesized(run, "Review insight", "NPS is 25.");
    await q(`update synthesized_insights set figure_check = $2 where id = $1`, [traced, JSON.stringify({ status: "traced", checked: 1, figures: [], checked_at: "x" })]);
    await q(`update synthesized_insights set figure_check = $2 where id = $1`, [
      review,
      JSON.stringify({ status: "needs_review", checked: 1, figures: [{ field: "headline", text: "25", status: "needs_review", reason: "context not matched" }], checked_at: "x" }),
    ]);
    const { GET } = await import("../../app/api/runs/[id]/synthesized-insights/export/route");
    const res = await GET(new Request("http://x/"), { params: Promise.resolve({ id: run }) });
    const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[wb.SheetNames[0]]);
    const by = (h: string) => rows.find((r) => r.Headline === h)!.Figures;
    expect(by("Review insight")).toBe("Figures need review: 25 (context not matched).");
    expect(by("Traced insight")).toBe("All traced to the cited evidence");
    expect(by("Legacy insight")).toBe("Not checked");
    expect(legacy).toBeTruthy();
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("numerical traceability on every AI-output path (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
