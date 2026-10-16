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
const model = vi.hoisted(() => ({ soWhat: "" }));
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
      create: vi.fn(async (req: { tool_choice?: { name?: string } }) => ({
        stop_reason: "tool_use",
        usage: {},
        content: [
          {
            type: "tool_use",
            name: req.tool_choice?.name,
            input: {
              executive_summary: "Leadership NPS is 25.",
              situation: "Leaders were surveyed.",
              complication: "Advocacy is modest.",
              question: "Whether to invest in advocacy",
              governing_thought: "Advocacy is a modest asset worth building on.",
              pillars: [{ theme: "Advocacy", headline: "Leadership NPS is 25.", so_what: model.soWhat, insight_indices: [0] }],
              recommendations_intro: "The actions follow.",
              caveats: ["Only one insight is available."],
            },
          },
        ],
      })),
    },
  },
}));

vi.setConfig({ testTimeout: 60000 });

describe.skipIf(!TEST_DATABASE_URL)("narrative wrong-group grounding (real database)", () => {
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
});
describe.skipIf(!!TEST_DATABASE_URL)("narrative wrong-group grounding (real database)", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
