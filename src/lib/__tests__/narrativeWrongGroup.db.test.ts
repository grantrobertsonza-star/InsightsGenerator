// FND-001 / REP-OUT-001 wrong-group grounding through the ACTUAL generateStoryNarrative on a REAL
// PostgreSQL (the existing case in narrativeFigureTrace.test.ts uses a scripted database client).
// The draft says the NPS of 25 belongs to customers while the cited insight gives it for leaders:
// the narrative is saved with its stored check "needs_review", never "traced"; the same figure for
// the right group is saved "traced". The run loader carries the stored check. Only the model
// (scripted record_narrative drafts), usage logging, scorers, contradiction refresh, storage and
// Next's cache are controlled, as in figureTraceability.db.test.ts.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const TENANT = "00000000-0000-4000-8000-0000000000d1";
// soWhat is the pillar's "so what" for every draft; queue, when not empty, supplies one per attempt
// first (the generator retries a draft whose figures are unsupported). prompts records each request.
const model = vi.hoisted(() => ({ soWhat: "", queue: [] as string[], prompts: [] as string[], stop: "tool_use" as string, patch: null as null | ((input: Record<string, unknown>) => Record<string, unknown>) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../recommendationQualityScorer", () => ({ refreshRecommendationQuality: vi.fn() }));
vi.mock("../objectiveQualityScorer", () => ({ refreshObjectiveQuality: vi.fn() }));
vi.mock("../contradictionDetector", () => ({ refreshContradictions: vi.fn() }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { tool_choice?: { name?: string }; messages?: unknown }) => {
        model.prompts.push(JSON.stringify(req.messages ?? ""));
        const soWhat = model.queue.length > 0 ? model.queue.shift()! : model.soWhat;
        const draft = (input: Record<string, unknown>) => (model.patch ? model.patch(input) : input);
        return {
        stop_reason: model.stop,
        usage: {},
        content: [
          {
            type: "tool_use",
            name: req.tool_choice?.name,
            input: draft({
              executive_summary: "Leadership NPS is 25.",
              situation: "Leaders were surveyed.",
              complication: "Advocacy is modest.",
              question: "Whether to invest in advocacy",
              governing_thought: "Advocacy is a modest asset worth building on.",
              pillars: [{ theme: "Advocacy", headline: "Leadership NPS is 25.", so_what: soWhat, insight_indices: [0] }],
              recommendations_intro: "The actions follow.",
              caveats: ["Only one insight is available."],
            }),
          },
        ],
        };
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 60000 });

describe.skipIf(!TEST_DATABASE_URL)("narrative wrong-group grounding, generator retry, rounding and invented ranges (real database)", () => {
  let db: DisposableDb;
  const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows as T[];
  const one = async (sql: string, p: unknown[]) => (await q<{ id: string }>(sql, p))[0].id;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = TENANT;
    await q(`insert into tenants (id, name) values ($1, 'T')`, [TENANT]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });

  it("a figure stated for the wrong group is saved needing review, the right group traced, and the loader carries it", async () => {
    const run = await one(`insert into runs (tenant_id, decision_statement, project_name) values ($1, 'Decide', 'Wrong group') returning id`, [TENANT]);
    const f = await one(`insert into findings (tenant_id, run_id, origin, finding_text, status, theme) values ($1, $2, 'stated', 'Leadership NPS is 25 (95% interval 14.4 to 35.6, base 200).', 'accepted', 'T') returning id`, [TENANT, run]);
    await q(`insert into verdicts (tenant_id, finding_id, verdict_tier, rationale, statistical_checks, verification_method, corroboration_level, due_care) values ($1, $2, 'robust', 'Checked.', '{}', 'single_pass', 'single_source', '{}')`, [TENANT, f]);
    const pi = await one(`insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, 'Leadership NPS is 25', 'Leadership NPS is 25 (95% interval 14.4 to 35.6, base 200).', 't', 'i') returning id`, [TENANT, run, f]);
    const si = await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count, review_status, action_plan_status)
       values ($1, $2, 'Leadership NPS is 25', 'Leadership NPS is 25 (95% interval 14.4 to 35.6, base 200).', 't', 'i', 1, 1, 'accepted', 'has_action') returning id`,
      [TENANT, run],
    );
    await q(`insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id) values ($1, $2, $3)`, [TENANT, si, pi]);
    const { generateStoryNarrative } = await import("../storyNarrative");
    const stored = async () => (await q<{ figure_check: { status: string; figures: { status: string; field: string }[] } }>(`select figure_check from deck_narratives where run_id = $1`, [run]))[0];

    model.soWhat = "Customers, rather than the surveyed leaders, have an NPS of 25.";
    await generateStoryNarrative(TENANT, run);
    const wrong = await stored();
    expect(wrong.figure_check.status).toBe("needs_review");
    expect(wrong.figure_check.figures).toEqual(expect.arrayContaining([expect.objectContaining({ field: "pillar 1 so what", status: "needs_review" })]));
    const { loadRunFigureChecks } = await import("../figureChecks");
    const client = await db.pool.connect();
    try {
      expect((await loadRunFigureChecks(client, run)).narrative).toMatchObject({ status: "needs_review" });
    } finally {
      client.release();
    }

    model.soWhat = "Leadership NPS is 25.";
    await generateStoryNarrative(TENANT, run);
    expect((await stored()).figure_check.status).toBe("traced");
    expect(await q(`select count(*)::int as n from deck_narratives where run_id = $1`, [run])).toEqual([{ n: 1 }]);
  });

  // Same real generator and database as above. Insight: "Leadership NPS is 25.4 (95% interval 14.4
  // to 35.6, base 200)". References:
  //   rounded      "NPS is 25" is the cited 25.4 at the output's own precision -> traced
  //   invented     "between 20 and 30" is a range the insight never states -> unsupported, so the
  //                draft is refused and retried with feedback naming that figure
  //   retry        an invented draft followed by a faithful one saves the faithful one (traced)
  //   exhausted    three invented drafts save nothing; the previous narrative stays unchanged
  async function runWithInsight(text: string) {
    const run = await one(`insert into runs (tenant_id, decision_statement, project_name) values ($1, 'Decide', 'Retry') returning id`, [TENANT]);
    const f = await one(`insert into findings (tenant_id, run_id, origin, finding_text, status, theme) values ($1, $2, 'stated', $3, 'accepted', 'T') returning id`, [TENANT, run, text]);
    await q(`insert into verdicts (tenant_id, finding_id, verdict_tier, rationale, statistical_checks, verification_method, corroboration_level, due_care) values ($1, $2, 'robust', 'Checked.', '{}', 'single_pass', 'single_source', '{}')`, [TENANT, f]);
    const pi = await one(`insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, 'Leadership NPS', $4, 't', 'i') returning id`, [TENANT, run, f, text]);
    const si = await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count, review_status, action_plan_status)
       values ($1, $2, 'Leadership NPS', $3, 't', 'i', 1, 1, 'accepted', 'has_action') returning id`,
      [TENANT, run, text],
    );
    await q(`insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id) values ($1, $2, $3)`, [TENANT, si, pi]);
    return run;
  }
  const stored = async (run: string) =>
    (await q<{ so_what: string; figure_check: { status: string } }>(`select pillars->0->>'so_what' as so_what, figure_check from deck_narratives where run_id = $1`, [run]))[0];
  const INSIGHT = "Leadership NPS is 25.4 (95% interval 14.4 to 35.6, base 200).";
  const INVENTED = "Leadership NPS lies between 20 and 30.";

  it("a figure rounded to the output's precision is traced", async () => {
    const run = await runWithInsight(INSIGHT);
    model.queue = []; model.soWhat = "Leadership NPS is 25.";
    const { generateStoryNarrative } = await import("../storyNarrative");
    await generateStoryNarrative(TENANT, run);
    expect((await stored(run)).figure_check.status).toBe("traced");
  });

  it("an invented range is refused and retried with feedback; the faithful retry is saved traced", async () => {
    const run = await runWithInsight(INSIGHT);
    model.prompts = []; model.queue = [INVENTED]; model.soWhat = "Leadership NPS is 25.4.";
    const { generateStoryNarrative } = await import("../storyNarrative");
    await generateStoryNarrative(TENANT, run);
    expect(model.prompts.length).toBe(2);
    expect(model.prompts[1]).toMatch(/does not support/);
    expect(model.prompts[1]).toMatch(/Do not compute new ranges/);
    const saved = await stored(run);
    expect(saved.so_what).toBe("Leadership NPS is 25.4.");
    expect(saved.figure_check.status).toBe("traced");
  });

  it("when every attempt invents a range nothing is saved and the previous narrative is unchanged", async () => {
    const run = await runWithInsight(INSIGHT);
    model.queue = []; model.soWhat = "Leadership NPS is 25.4.";
    const { generateStoryNarrative } = await import("../storyNarrative");
    await generateStoryNarrative(TENANT, run);
    const before = await stored(run);
    model.prompts = []; model.queue = [INVENTED, INVENTED, INVENTED];
    await expect(generateStoryNarrative(TENANT, run)).rejects.toThrow(/does not support/);
    expect(model.prompts.length).toBe(3);
    expect(await stored(run)).toEqual(before);
    expect(await q(`select count(*)::int as n from deck_narratives where run_id = $1`, [run])).toEqual([{ n: 1 }]);
  });

  // Codex RR-F06: a cut-off, refused or malformed generation never replaces a complete saved report.
  it("an unfinished or malformed generation leaves the saved narrative unchanged and is shown until a finished one", async () => {
    const run = await one(`insert into runs (tenant_id, decision_statement, project_name) values ($1, 'Decide', 'Cut-off') returning id`, [TENANT]);
    const f = await one(`insert into findings (tenant_id, run_id, origin, finding_text, status, theme) values ($1, $2, 'stated', 'Leadership NPS is 25 (base 200).', 'accepted', 'T') returning id`, [TENANT, run]);
    await q(`insert into verdicts (tenant_id, finding_id, verdict_tier, rationale, statistical_checks, verification_method, corroboration_level, due_care) values ($1, $2, 'robust', 'Checked.', '{}', 'single_pass', 'single_source', '{}')`, [TENANT, f]);
    const pi = await one(`insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, 'Leadership NPS is 25', 'Leadership NPS is 25 (base 200).', 't', 'i') returning id`, [TENANT, run, f]);
    const si = await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count, review_status, action_plan_status)
       values ($1, $2, 'Leadership NPS is 25', 'Leadership NPS is 25 (base 200).', 't', 'i', 1, 1, 'accepted', 'has_action') returning id`,
      [TENANT, run],
    );
    await q(`insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id) values ($1, $2, $3)`, [TENANT, si, pi]);
    const { generateStoryNarrative, latestNarrativeFailure } = await import("../storyNarrative");
    const summary = async () => (await q<{ executive_summary: string }>(`select executive_summary from deck_narratives where run_id = $1`, [run]))[0]?.executive_summary;
    const recordFailure = (message: string) => q(`insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'story_narrative_error', $3)`, [TENANT, run, JSON.stringify({ message })]);

    model.soWhat = "Leadership NPS is 25.";
    model.stop = "tool_use";
    model.patch = null;
    await generateStoryNarrative(TENANT, run);
    expect(await summary()).toBe("Leadership NPS is 25.");

    try {
      const cases: [string, string, ((i: Record<string, unknown>) => Record<string, unknown>) | null, RegExp][] = [
        ["cut off", "max_tokens", (i) => ({ ...i, executive_summary: "Incomplete summary stopping mid" }), /cut off before it finished/],
        ["refused", "refusal", null, /declined/],
        ["no summary", "tool_use", (i) => { const { executive_summary: _drop, ...rest } = i; void _drop; return rest; }, /without executive_summary/],
        ["pillars not a list", "tool_use", (i) => ({ ...i, pillars: "Advocacy" }), /without pillars/],
      ];
      for (const [label, stop, patch, message] of cases) {
        model.stop = stop;
        model.patch = patch;
        const err = await generateStoryNarrative(TENANT, run).catch((e) => e);
        expect(err?.message, label).toMatch(message);
        expect(await summary(), label).toBe("Leadership NPS is 25.");
        await recordFailure(err.message);
        expect(await latestNarrativeFailure(TENANT, run), label).toBe(err.message);
      }
    } finally {
      model.stop = "tool_use";
      model.patch = null;
    }
    // A finished generation replaces it, and the shown failure goes.
    model.patch = (i) => ({ ...i, executive_summary: "Leaders give an NPS of 25." });
    try {
      await generateStoryNarrative(TENANT, run);
    } finally {
      model.patch = null;
    }
    expect(await summary()).toBe("Leaders give an NPS of 25.");
    expect(await latestNarrativeFailure(TENANT, run)).toBeNull();
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("narrative wrong-group grounding, generator retry, rounding and invented ranges (real database)", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
