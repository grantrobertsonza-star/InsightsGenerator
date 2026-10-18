// Business decisions, recommendation currentness (Codex review 2026-10-17, release 9225d95).
// A recommendation is framed against the accepted decisions current when the generator runs,
// whatever its insight recorded. The panel used to infer a recommendation's decisions from its
// insight, so a recommendation written for Decision A on a pre-decision (no-context) insight was
// never qualified after Decision A was reworded. Each AI recommendation now records the decisions
// its prompt used (migration 0102) and is judged on that (rules in decisionContext.ts).
// Drives the ACTUAL generators and decision actions against a REAL PostgreSQL through the app's own
// db.ts; only the model, the quality scorers, usage logging and the cache are mocked. The mocked
// model writes the decision it was shown into the action text, so the stored record can be checked
// against what the prompt actually said.
//   - Codex's replay: no-context insight, recommendation generated for Decision A, decision
//     reworded to C: counted after the (successful) refresh, wording kept; rewording back clears it
//   - insight recorded a different decision than its recommendation: each judged on its own,
//     so returning to the insight's decision does not clear the recommendation
//   - synthesized-insight recommendations follow the same rule
//   - a decision change committed while the model is drafting: the record is what the prompt saw
//   - recommendations with no record are "unknown" and counted; researcher-written and rejected
//     ones are not; another run's are not
//   - Codex's original DB probe assertion (no-context insight, older recommendation): qualified
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

const model = vi.hoisted(() => ({ duringCall: null as null | (() => Promise<void>) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../recommendationQualityScorer", () => ({ refreshRecommendationQuality: vi.fn() }));
vi.mock("../objectiveQualityScorer", () => ({ refreshObjectiveQuality: vi.fn() }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { messages: { content: string }[] }) => {
        const content = req.messages[0].content;
        const decision = /this project has confirmed: \\?"([^"\\]*)\\?"/.exec(JSON.stringify(req))?.[1] ?? "(none)";
        const count = (content.match(/^\d+\. (\[[^\]]*\] )?Headline:/gm) ?? []).length;
        if (model.duringCall) { const f = model.duringCall; model.duringCall = null; await f(); }
        const recommendations = Array.from({ length: count }, (_, index) => ({
          index, action_text: `Act for ${decision}`, owner_role: "Lead", owner_feasibility_note: "n", timeline: "Q1",
          metric: "m", priority: "high", assumptions_and_risks: "a", alternatives_considered: "b",
        }));
        return { stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", input: { recommendations } }] };
      }),
    },
  },
}));
vi.setConfig({ testTimeout: 60000 });

describe.skipIf(!TEST_DATABASE_URL)("recommendations are judged on the decisions they were generated for (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic recommendation context')", [tenant]);
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); });

  const id = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;
  const newRun = async (decision: string, entry = "generate") => {
    const run = await id("insert into runs(tenant_id,project_name,entry_point,decision_statement) values($1,'R',$2,$3) returning id", [tenant, entry, decision]);
    const candidate = await id("insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,$3,'r','ai_suggested','accepted') returning id", [tenant, run, decision]);
    return { run, candidate };
  };
  const insight = async (run: string, context: string | null, headline: string) => {
    const f = await id("insert into findings(tenant_id,run_id,origin,finding_text,status) values($1,$2,'generated',$3,'accepted') returning id", [tenant, run, headline]);
    return id("insert into insights(tenant_id,run_id,finding_id,decision_context,headline,observation,tension,implication) values($1,$2,$3,$4,$5,'o','t','i') returning id", [tenant, run, f, context, headline]);
  };
  const recsFor = async (column: "insight_id" | "synthesized_insight_id", anchor: string) =>
    (await db.pool.query(`select id, action_text, decision_context, edited from recommendations where ${column}=$1 order by created_at`, [anchor])).rows;
  const counts = async (run: string) => (await import("../decisionRefresh")).decisionContextMismatch(tenant, run);
  const reword = async (run: string, candidate: string, text: string) => {
    const a = await import("../decisionCandidateActions");
    expect(await a.acceptDecisionCandidate(run, candidate, text)).toEqual({ ok: true, refreshError: null });
    expect((await db.pool.query("select decision_statement from runs where id=$1", [run])).rows[0].decision_statement).toBe(text);
    expect(await (await import("../decisionRefresh")).decisionRefreshPending(tenant, run), "the refresh succeeded").toBe(false);
  };

  it("Codex's replay: a recommendation generated for Decision A on a no-context insight is counted after A is reworded, and clears when it matches again", async () => {
    const { generateRecommendations } = await import("../recommendationAgent");
    const { run, candidate } = await newRun("Decision A");
    const i = await insight(run, null, "Evidence before decisions");
    await generateRecommendations(tenant, run);
    const [rec] = await recsFor("insight_id", i);
    expect(rec).toMatchObject({ action_text: "Act for Decision A", decision_context: "Decision A" });
    expect(await counts(run), "current").toEqual({ insights: 0, recommendations: 0, recommendationsUnknown: 0 });
    // A researcher edits the wording; the edit must survive and the record stays the generator's.
    await db.pool.query("update recommendations set action_text='Researcher wording', edited=true where id=$1", [rec.id]);

    await reword(run, candidate, "Decision C replaces Decision A");
    expect(await counts(run), "written for earlier decisions").toEqual({ insights: 0, recommendations: 1, recommendationsUnknown: 0 });
    expect(await recsFor("insight_id", i)).toEqual([{ ...rec, action_text: "Researcher wording", edited: true }]);

    await reword(run, candidate, "Decision A");
    expect(await counts(run), "matches again").toEqual({ insights: 0, recommendations: 0, recommendationsUnknown: 0 });
  });

  it("an insight and its recommendation recorded different decisions: each is judged on its own record", async () => {
    const { generateRecommendations } = await import("../recommendationAgent");
    const { run, candidate } = await newRun("Decision A");
    const i = await insight(run, "Decision X", "Framed earlier");
    await generateRecommendations(tenant, run);
    expect(await recsFor("insight_id", i)).toMatchObject([{ action_text: "Act for Decision A", decision_context: "Decision A" }]);
    expect(await counts(run)).toEqual({ insights: 1, recommendations: 0, recommendationsUnknown: 0 });
    // Back to the insight's decision: the insight matches, its recommendation does not.
    await reword(run, candidate, "Decision X");
    expect(await counts(run)).toEqual({ insights: 0, recommendations: 1, recommendationsUnknown: 0 });
  });

  it("synthesized-insight recommendations record and are judged the same way", async () => {
    const { generateSynthesizedRecommendations } = await import("../recommendationAgent");
    const { run, candidate } = await newRun("Decision A");
    const pre = await insight(run, null, "Pre-insight");
    const si = await id(
      "insert into synthesized_insights(tenant_id,run_id,headline,observation,tension,implication,triangulation_count,source_theme_count,review_status) values($1,$2,'Synth','o','t','i',1,1,'accepted') returning id",
      [tenant, run],
    );
    await db.pool.query("insert into synthesized_insight_sources(tenant_id,synthesized_insight_id,pre_insight_id) values($1,$2,$3)", [tenant, si, pre]);
    await generateSynthesizedRecommendations(tenant, run);
    expect(await recsFor("synthesized_insight_id", si)).toMatchObject([{ action_text: "Act for Decision A", decision_context: "Decision A" }]);
    await reword(run, candidate, "Decision B");
    // The pre-insight's own recommendation (if the refresh drafted one) is current for Decision B.
    const c = await counts(run);
    expect(c).toEqual({ insights: 0, recommendations: 1, recommendationsUnknown: 0 });
  });

  it("a decision change committed while the model drafts: the record is what the prompt used", async () => {
    const { generateRecommendations } = await import("../recommendationAgent");
    const { run } = await newRun("Decision A");
    const i = await insight(run, null, "Concurrent");
    model.duringCall = async () => {
      await db.pool.query("update runs set decision_statement='Decision B committed meanwhile' where id=$1", [run]);
    };
    await generateRecommendations(tenant, run);
    expect(await recsFor("insight_id", i)).toMatchObject([{ action_text: "Act for Decision A", decision_context: "Decision A" }]);
    expect(await counts(run)).toEqual({ insights: 0, recommendations: 1, recommendationsUnknown: 0 });
  });

  it("no record is unknown and counted; researcher-written, rejected and other runs' recommendations are not", async () => {
    const { run } = await newRun("Decision A");
    const { run: other } = await newRun("Decision A");
    const rec = (r: string, anchor: string, source: string, status: string, context: string | null) =>
      db.pool.query(
        "insert into recommendations(tenant_id,run_id,insight_id,action_text,owner_role,owner_feasibility_note,timeline,metric,priority,assumptions_and_risks,alternatives_considered,source,status,decision_context) values($1,$2,$3,'x','o','f','t','m','medium','a','b',$4,$5,$6)",
        [tenant, r, anchor, source, status, context],
      );
    await rec(run, await insight(run, null, "Legacy"), "ai_suggested", "accepted", null);
    await rec(run, await insight(run, null, "Researcher"), "researcher_authored", "accepted", null);
    await rec(run, await insight(run, null, "Rejected"), "ai_suggested", "rejected", "Decision old");
    await rec(other, await insight(other, null, "Other"), "ai_suggested", "accepted", "Decision old");
    expect(await counts(run)).toEqual({ insights: 0, recommendations: 1, recommendationsUnknown: 1 });
  });

  it("Codex's original DB probe: an older recommendation on a no-context insight is qualified after a decision is added", async () => {
    const a = await import("../decisionCandidateActions");
    const { run } = await newRun("Decision one");
    const i = await insight(run, null, "Unframed headline");
    // As written before the decisions were recorded (Codex's probe inserts it without a record).
    await db.pool.query(
      "insert into recommendations(tenant_id,run_id,insight_id,action_text,owner_role,owner_feasibility_note,timeline,metric,priority,assumptions_and_risks,alternatives_considered,source,status,edited) values($1,$2,$3,'Researcher action for Decision one','o','f','t','m','medium','a','b','ai_suggested','accepted',true)",
      [tenant, run, i],
    );
    expect(await a.addOwnDecisionCandidate(run, "Decision two")).toEqual({ ok: true, refreshError: null });
    const c = await counts(run);
    expect(c && c.recommendations).toBeGreaterThan(0);
    expect(c).toEqual({ insights: 0, recommendations: 1, recommendationsUnknown: 1 });
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("recommendations are judged on the decisions they were generated for (real database)", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
