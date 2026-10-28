// CE-3, EF-REP-F01 (Codex, batch 63): the report narrative is framed with the accepted recommendations
// (action, owner, timeline, priority and anchor insight are given to the model), so a change to that
// action plan qualifies the saved narrative wherever it is read: the screen and assistant reader
// (narrativeFreshnessNote, which both call), the assistant's prompt, and both report exports. Before
// the fix the fingerprint held no recommendation at all and every change below read as current.
// Runs the ACTUAL generator, freshness reader, assistant and Word and Slides export routes on a REAL
// disposable PostgreSQL; only the model, usage logging, scorers, storage and Next's cache are mocked.
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The export routes import through "@/lib"; map each to the real module.
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/deckSlides", async () => await import("../deckSlides"));
vi.mock("@/lib/docxReport", async () => await import("../docxReport"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/narrativeSupportSummary", async () => await import("../narrativeSupportSummary"));
vi.mock("@/lib/narrativeFreshness", async () => await import("../narrativeFreshness"));
vi.mock("@/lib/supportStatus", async () => await import("../supportStatus"));
vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));
vi.mock("@/lib/figureChecks", async () => await import("../figureChecks"));
vi.mock("@/lib/numberTrace", async () => await import("../numberTrace"));
vi.mock("@/lib/caveatLabels", async () => await import("../caveatLabels"));
vi.mock("@/lib/storyNarrative", async () => await import("../storyNarrative"));
vi.mock("@/lib/evidenceTrail", async () => await import("../evidenceTrail"));
vi.mock("@/lib/evidenceTrailSlides", async () => await import("../evidenceTrailSlides"));
vi.mock("@/lib/objectiveCoverage", async () => await import("../objectiveCoverage"));
vi.mock("@/lib/latestVerdict", async () => await import("../latestVerdict"));
vi.mock("@/lib/findingsChartData", async () => await import("../findingsChartData"));
vi.mock("@/lib/methodologyStatus", async () => await import("../methodologyStatus"));
vi.mock("@/lib/discoverySlides", () => ({ addDiscoverySlides: vi.fn() }));
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

const TENANT = "00000000-0000-4000-8000-0000000000e3";
// during: run once while the narrative model call is in flight (a change made during generation).
// stop: the narrative call's stop reason ("refusal" makes generation fail). assistant: assistant requests.
const model = vi.hoisted(() => ({ during: null as null | (() => Promise<unknown>), stop: "tool_use", assistant: [] as string[] }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { tool_choice?: { name?: string } }) => {
        if (req.tool_choice?.name !== "record_narrative") {
          model.assistant.push(JSON.stringify(req));
          return { stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: "Noted." }] };
        }
        if (model.during) {
          const change = model.during;
          model.during = null;
          await change();
        }
        return {
          stop_reason: model.stop,
          usage: {},
          content: [
            {
              type: "tool_use",
              name: "record_narrative",
              input: {
                executive_summary: "Invest in advocacy training led by the research director this quarter.",
                situation: "Leaders were surveyed.",
                complication: "Advocacy is modest.",
                question: "Whether to invest in advocacy",
                governing_thought: "Advocacy is a modest asset worth building on.",
                pillars: [{ theme: "Advocacy", headline: "Leadership NPS is 25.", so_what: "Leadership NPS is 25.", insight_indices: [0] }],
                recommendations_intro: "The actions follow.",
                caveats: ["Only one insight is available."],
              },
            },
          ],
        };
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 60000 });

const CHANGED = /^Written for an earlier version of the project: the accepted recommendations changed after this report narrative was generated/;

describe.skipIf(!TEST_DATABASE_URL)("CE-3 report narrative and the accepted recommendations it was framed with (real database)", () => {
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
    // The assistant takes a capacity slot from the claim pool (RR-F08): both pools close before the drop.
    const { pool, claimPool } = await import("../db");
    await pool?.end?.();
    await claimPool?.end?.();
    await db?.drop();
  });

  const SUMMARY = "Invest in advocacy training led by the research director this quarter.";
  async function project() {
    const run = await one(`insert into runs (tenant_id, decision_statement, project_name) values ($1, 'Decide', 'Action plan') returning id`, [TENANT]);
    const text = "Leadership NPS is 25.";
    const f = await one(`insert into findings (tenant_id, run_id, origin, finding_text, status, theme) values ($1, $2, 'stated', $3, 'accepted', 'T') returning id`, [TENANT, run, text]);
    await q(
      `insert into verdicts (tenant_id, finding_id, verdict_tier, rationale, statistical_checks, verification_method, corroboration_level, due_care) values ($1, $2, 'robust', 'Checked.', '{}', 'single_pass', 'single_source', '{}')`,
      [TENANT, f],
    );
    const pi = await one(`insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, 'Leadership NPS', $4, 't', 'i') returning id`, [TENANT, run, f, text]);
    const si = await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count, review_status, action_plan_status)
       values ($1, $2, 'Leadership NPS', $3, 't', 'i', 1, 1, 'accepted', 'has_action') returning id`,
      [TENANT, run, text],
    );
    await q(`insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id) values ($1, $2, $3)`, [TENANT, si, pi]);
    const rec = (action: string, status = "accepted") =>
      one(
        `insert into recommendations (tenant_id, run_id, synthesized_insight_id, action_text, owner_role, timeline, owner_feasibility_note, metric, priority, assumptions_and_risks, alternatives_considered, status)
         values ($1, $2, $3, $4, 'Research director', 'This quarter', 'Feasible', 'Advocacy', 'high', 'Limited evidence', 'Delay', $5) returning id`,
        [TENANT, run, si, action, status],
      );
    const first = await rec("Invest in advocacy training");
    const second = await rec("Brief the board on advocacy");
    return { run, first, second, rec };
  }
  const note = async (run: string) => {
    const { narrativeFreshnessNote } = await import("../narrativeFreshness");
    const client = await db.pool.connect();
    try {
      return await narrativeFreshnessNote(client, run);
    } finally {
      client.release();
    }
  };
  const generate = async (run: string) => (await import("../storyNarrative")).generateStoryNarrative(TENANT, run);
  const summary = async (run: string) => (await q<{ executive_summary: string }>("select executive_summary from deck_narratives where run_id = $1", [run]))[0].executive_summary;
  const exported = async (run: string) => {
    const out: Record<string, string> = {};
    for (const format of ["docx", "pptx"] as const) {
      const route = format === "docx" ? await import("../../app/api/runs/[id]/story/export-docx/route") : await import("../../app/api/runs/[id]/story/export/route");
      const res = await route.GET(new Request("http://localhost/report"), { params: Promise.resolve({ id: run }) });
      expect(res.status, format).toBe(200);
      const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
      const names = Object.keys(zip.files).filter((n) => (format === "docx" ? n === "word/document.xml" : /^ppt\/slides\/slide\d+\.xml$/.test(n)));
      out[format] = (await Promise.all(names.map((n) => zip.files[n].async("string")))).join(" ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    }
    return out;
  };

  it("unchanged and reordered controls stay current; a newly rejected (never accepted) row does not count", async () => {
    const { run, first, rec } = await project();
    await generate(run);
    expect(await note(run)).toBeNull();
    // Reorder: the generator lists recommendations by insight quality then created_at; swapping their
    // order changes the listing, not the set.
    await q("update recommendations set created_at = now() + interval '1 day' where id = $1", [first]);
    expect(await note(run)).toBeNull();
    // A recommendation that is not accepted is not part of the framing.
    await rec("Something proposed but rejected", "rejected");
    expect(await note(run)).toBeNull();
    // The narrative says nothing about recommendations in its exports when current.
    const out = await exported(run);
    for (const f of ["docx", "pptx"]) expect(out[f], f).not.toMatch(/accepted recommendations changed/);
  });

  const changes: [string, (ids: Awaited<ReturnType<typeof project>>) => Promise<unknown>][] = [
    ["action wording", ({ first }) => q("update recommendations set action_text = 'Stop advocacy training' where id = $1", [first])],
    ["owner", ({ first }) => q("update recommendations set owner_role = 'Operations director' where id = $1", [first])],
    ["timeline", ({ first }) => q("update recommendations set timeline = 'Next year' where id = $1", [first])],
    ["priority", ({ first }) => q("update recommendations set priority = 'low' where id = $1", [first])],
    ["rejection", ({ first }) => q("update recommendations set status = 'rejected' where id = $1", [first])],
    ["deletion", ({ second }) => q("delete from recommendations where id = $1", [second])],
    ["addition", ({ rec }) => rec("Run a member advocacy pilot")],
  ];
  for (const [label, change] of changes) {
    it(`a change to the accepted action plan (${label}) qualifies the preserved narrative on screen, for the assistant and in both exports`, async () => {
      const ids = await project();
      await generate(ids.run);
      expect(await note(ids.run)).toBeNull();
      await change(ids);
      const text = await note(ids.run);
      expect(text).toMatch(CHANGED);
      // The narrative is preserved as written.
      expect(await summary(ids.run)).toBe(SUMMARY);
      // Both exports carry the old narrative with the qualification.
      const out = await exported(ids.run);
      for (const f of ["docx", "pptx"]) {
        expect(out[f], f).toContain(SUMMARY);
        expect(out[f], f).toContain("the accepted recommendations changed after this report narrative was generated");
      }
    });
  }

  it("the assistant reads the narrative with the qualification", async () => {
    const { run, first } = await project();
    await generate(run);
    await q("update recommendations set owner_role = 'Operations director' where id = $1", [first]);
    model.assistant = [];
    const { askResearchAssistant } = await import("../researchAssistant");
    await askResearchAssistant(TENANT, run, "What does the report recommend?");
    expect(model.assistant.length).toBeGreaterThan(0);
    expect(model.assistant[0]).toContain("Note: Written for an earlier version of the project: the accepted recommendations changed");
  });

  it("a change made while the narrative is being generated leaves it qualified; regenerating clears it; a failed regeneration keeps the last report and its qualification", async () => {
    const { run, first } = await project();
    model.during = () => q("update recommendations set timeline = 'Next year' where id = $1", [first]);
    await generate(run);
    expect(model.during).toBeNull();
    expect(await note(run)).toMatch(CHANGED);

    // Recovery: regenerating against the current plan clears the qualification.
    await generate(run);
    expect(await note(run)).toBeNull();

    // Change again, then a regeneration that fails: the saved report and its inputs are untouched,
    // so it is still qualified, not made current by the attempt.
    await q("update recommendations set action_text = 'Pause advocacy training' where id = $1", [first]);
    const before = await q("select executive_summary, inputs, generated_at from deck_narratives where run_id = $1", [run]);
    model.stop = "refusal";
    try {
      await expect(generate(run)).rejects.toThrow(/declined/);
    } finally {
      model.stop = "tool_use";
    }
    expect(await q("select executive_summary, inputs, generated_at from deck_narratives where run_id = $1", [run])).toEqual(before);
    expect(await note(run)).toMatch(CHANGED);
    await generate(run);
    expect(await note(run)).toBeNull();
  });

  it("a narrative recorded before recommendations were part of its inputs reads unknown for them, never current or changed", async () => {
    const { run, first } = await project();
    await generate(run);
    await q("update deck_narratives set inputs = inputs - 'recommendations' where run_id = $1", [run]);
    // Nothing else changed: unknown, not current.
    expect(await note(run)).toMatch(/^Not known to be current: this report narrative was generated before the app recorded the accepted recommendations it was written for/);
    // Still unknown after a recommendation change (it cannot be told apart).
    await q("update recommendations set owner_role = 'Operations director' where id = $1", [first]);
    expect(await note(run)).toMatch(/^Not known to be current/);
    // A recorded part that changed is named, and the recommendations stay unknown, not "changed".
    await q("update runs set business_problem = 'Members are leaving' where id = $1", [run]);
    const text = await note(run);
    expect(text).toMatch(/^Written for an earlier version of the project: the business problem changed/);
    expect(text).toMatch(/Whether the accepted recommendations also changed is not known/);
    expect(text).not.toMatch(/the accepted recommendations changed after/);
    const out = await exported(run);
    for (const f of ["docx", "pptx"]) expect(out[f], f).toContain("Whether the accepted recommendations also changed is not known");
    // Recovery: regenerating records them.
    await generate(run);
    expect(await note(run)).toBeNull();
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("CE-3 report narrative and the accepted recommendations it was framed with (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
