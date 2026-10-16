// Closing assertions for OBJ-REV-004, OBJ-SET-002 and the business-decisions remainder that the
// existing lifecycle suite does not reach (independent acceptance, 2026-10-16):
//   - a rejected AI suggestion and an accepted human edit survive a regeneration that actually
//     replaces suggestions (the model returns a usable candidate), while an undecided pending
//     suggestion is replaced;
//   - an own-objective addition whose post-commit quality refresh fails is retried safely: one row;
//   - the accepted decision statement holds exactly the accepted decisions, never an unaccepted or
//     rejected one.
// Real disposable PostgreSQL. Only the model and the downstream refreshes are controlled.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const state = vi.hoisted(() => ({ failObjectiveRefresh: 0, suggestions: [] as { candidate_text: string; rationale: string }[] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../insightGenerator", () => ({ refreshInsights: vi.fn(async () => {}) }));
vi.mock("../recommendationAgent", () => ({ refreshRecommendations: vi.fn(async () => {}) }));
vi.mock("../objectiveQualityScorer", () => ({
  refreshObjectiveQuality: vi.fn(async () => {
    if (state.failObjectiveRefresh > 0) { state.failObjectiveRefresh -= 1; throw new Error("quality refresh unavailable"); }
  }),
}));
vi.mock("../objectiveValidator", () => ({ refreshObjectiveValidationQuietly: vi.fn(async () => {}) }));
vi.mock("../anthropic", () => ({
  anthropic: { messages: { create: vi.fn(async () => ({ content: [{ type: "tool_use", input: { candidates: state.suggestions } }], usage: { input_tokens: 0, output_tokens: 0 } })) } },
  CLAUDE_MODEL: "controlled",
}));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../extractFindings", () => ({ readContextDocument: vi.fn() }));

describe.skipIf(!TEST_DATABASE_URL)("objective and decision closing assertions (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic closure')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id,project_name,initial_research_objective,stated_objectives_text,objective_candidates_seeded) values($1,'Closure','Original brief',null,true) returning id", [tenant])).rows[0].id;
    await db.pool.query("insert into findings(tenant_id,run_id,origin,finding_text) values($1,$2,'generated','Synthetic evidence')", [tenant, run]);
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); });
  const rows = async (kind: "objective" | "decision") =>
    (await db.pool.query(`select id,candidate_text,status,source,edited from ${kind}_candidates where run_id=$1 order by created_at,id`, [run])).rows;

  it("OBJ-REV-004: regeneration keeps a rejected suggestion rejected, keeps human wording, replaces only undecided suggestions", async () => {
    const a = await import("../objectiveCandidateActions");
    const { generateObjectiveCandidates } = await import("../objectiveFramer");
    await a.addOwnObjectiveCandidate(run, "Human objective");
    const human = (await rows("objective"))[0].id;
    await a.acceptObjectiveCandidate(run, human, "Researcher wording");
    state.suggestions = [
      { candidate_text: "Suggestion to reject", rationale: "first" },
      { candidate_text: "Suggestion left pending", rationale: "first" },
    ];
    await generateObjectiveCandidates(tenant, run);
    const rejectedId = (await rows("objective")).find((r) => r.candidate_text === "Suggestion to reject")!.id;
    await a.rejectObjectiveCandidate(run, rejectedId);

    // The model proposes the rejected wording again (with stray spaces), the researcher's own
    // wording, a duplicate within its own answer, and one new suggestion.
    state.suggestions = [
      { candidate_text: "  Suggestion to reject ", rationale: "again" },
      { candidate_text: "Researcher wording", rationale: "again" },
      { candidate_text: "Fresh suggestion", rationale: "new" },
      { candidate_text: "Fresh suggestion", rationale: "repeated in the same answer" },
    ];
    await generateObjectiveCandidates(tenant, run);
    const after = await rows("objective");
    expect(after.filter((r) => r.candidate_text.trim() === "Suggestion to reject")).toEqual([
      expect.objectContaining({ id: rejectedId, status: "rejected", source: "ai_suggested" }),
    ]);
    expect(after.filter((r) => r.candidate_text === "Researcher wording")).toEqual([
      expect.objectContaining({ id: human, status: "accepted", source: "researcher_authored", edited: true }),
    ]);
    expect(after.some((r) => r.candidate_text === "Suggestion left pending")).toBe(false);
    expect(after.filter((r) => r.candidate_text === "Fresh suggestion")).toEqual([
      expect.objectContaining({ status: "pending", source: "ai_suggested" }),
    ]);
    expect((await db.pool.query("select initial_research_objective from runs where id=$1", [run])).rows[0].initial_research_objective).toBe("Original brief");
  });

  it("decision regeneration does not bring a rejected decision back as accepted or into the statement", async () => {
    const a = await import("../decisionCandidateActions");
    const { generateDecisionCandidates } = await import("../decisionFramer");
    state.suggestions = [
      { candidate_text: "Launch in region A", rationale: "first" },
      { candidate_text: "Hold pricing", rationale: "first" },
    ];
    await generateDecisionCandidates(tenant, run);
    const launch = (await rows("decision")).find((r) => r.candidate_text === "Launch in region A")!.id;
    await a.rejectDecisionCandidate(run, launch);
    const statementBefore = (await db.pool.query("select decision_statement from runs where id=$1", [run])).rows[0].decision_statement;
    expect(statementBefore).toBe("Hold pricing");

    state.suggestions = [
      { candidate_text: "Launch in region A", rationale: "again" },
      { candidate_text: "Review the channel mix", rationale: "new" },
    ];
    await generateDecisionCandidates(tenant, run);
    const after = await rows("decision");
    expect(after.filter((r) => r.candidate_text === "Launch in region A")).toEqual([
      expect.objectContaining({ id: launch, status: "rejected" }),
    ]);
    const statement = (await db.pool.query("select decision_statement from runs where id=$1", [run])).rows[0].decision_statement as string;
    expect(statement).toContain("Review the channel mix");
    expect(statement).not.toContain("Launch in region A");
  });

  it("a regeneration that only repeats existing wording changes nothing and says so", async () => {
    const { generateObjectiveCandidates } = await import("../objectiveFramer");
    const before = await rows("objective");
    expect(before.some((r) => r.status === "pending")).toBe(true);
    state.suggestions = [{ candidate_text: "Suggestion to reject", rationale: "only a repeat" }];
    await expect(generateObjectiveCandidates(tenant, run)).rejects.toThrow(/every suggestion repeats wording already on this run/);
    expect(await rows("objective")).toEqual(before);
  });

  it("business remainder: the statement holds exactly the accepted decisions", async () => {
    const a = await import("../decisionCandidateActions");
    const own = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'Statement') returning id", [tenant])).rows[0].id as string;
    const decisions = async () => (await db.pool.query("select id,candidate_text,status from decision_candidates where run_id=$1", [own])).rows;
    await a.addOwnDecisionCandidate(own, "Decision A");
    await a.addOwnDecisionCandidate(own, "Decision B");
    await a.addOwnDecisionCandidate(own, "Decision C");
    const id = async (t: string) => (await decisions()).find((r) => r.candidate_text === t)!.id;
    const statement = async () => (await db.pool.query("select decision_statement from runs where id=$1", [own])).rows[0].decision_statement as string | null;
    await a.unacceptDecisionCandidate(own, await id("Decision A"));
    await a.rejectDecisionCandidate(own, await id("Decision C"));
    expect(await statement()).toBe("Decision B");
    await a.restoreDecisionCandidate(own, await id("Decision C"));
    const restored = (await decisions()).find((r) => r.candidate_text === "Decision C")!.status;
    const s = await statement();
    expect(s).toContain("Decision B");
    expect(s).not.toContain("Decision A");
    if (restored === "accepted") expect(s).toContain("Decision C");
    else expect(s).not.toContain("Decision C");
  });

  it("OBJ-SET-002: an own addition whose quality refresh fails is retried without a duplicate", async () => {
    const a = await import("../objectiveCandidateActions");
    state.failObjectiveRefresh = 1;
    await expect(a.addOwnObjectiveCandidate(run, "Retried objective")).rejects.toThrow("quality refresh unavailable");
    expect((await rows("objective")).filter((r) => r.candidate_text === "Retried objective")).toHaveLength(1);
    await a.addOwnObjectiveCandidate(run, " Retried objective ");
    expect((await rows("objective")).filter((r) => r.candidate_text.trim() === "Retried objective")).toEqual([
      expect.objectContaining({ status: "accepted", source: "researcher_authored" }),
    ]);
  });
});
