// Closing assertions for OBJ-REV-004, OBJ-SET-002 and the business-decisions remainder that the
// existing lifecycle suite does not reach (independent acceptance, 2026-10-16):
//   - a rejected AI suggestion and an accepted human edit survive a regeneration that actually
//     replaces suggestions (the model returns a usable candidate), while an undecided pending
//     suggestion is replaced;
//   - an own-objective addition whose post-commit quality refresh fails is retried safely: one row;
//   - the accepted decision statement holds exactly the accepted decisions, never an unaccepted or
//     rejected one.
//   - wording identity ignores only surrounding whitespace (spaces, tabs, line breaks), the same way
//     for stored and new wording, in both framers; inner wording, case and punctuation stay distinct.
// Real disposable PostgreSQL. Only the model and the downstream refreshes are controlled.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

const state = vi.hoisted(() => ({ failObjectiveRefresh: 0, suggestions: [] as { candidate_text: string; rationale: string }[], epoch: 0 }));
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
  // The mocked model answer (state.suggestions) is shared by every test in this file. A test that
  // times out is not stopped by vitest: its loop went on setting the answer while the next test ran,
  // which is how a full-suite timeout of the padded objective case made the padded decision case see
  // objective suggestions and no "Exit region B" (Codex, 2026-10-22). Each test now owns the answer
  // for its own epoch; a leftover loop from an earlier test throws at its next answer instead.
  beforeEach(() => {
    state.epoch += 1;
  });
  const answer = (epoch: number, list: { candidate_text: string; rationale: string }[]) => {
    if (epoch !== state.epoch) throw new Error("this test has already ended (timed out); its loop stops here");
    state.suggestions = list;
  };
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

  // Surrounding whitespace the model may add or drop: tab, line break, carriage return, a no-break
  // space and plain spaces, on either the stored or the new side.
  const PADDED = ["\t", "\n", "\r\n", "\u00a0", "   "];
  const freshRun = async (name: string) => {
    const id = (await db.pool.query("insert into runs(tenant_id,project_name,initial_research_objective,objective_candidates_seeded) values($1,$2,'Brief',true) returning id", [tenant, name])).rows[0].id as string;
    await db.pool.query("insert into findings(tenant_id,run_id,origin,finding_text) values($1,$2,'generated','Synthetic evidence')", [tenant, id]);
    return id;
  };
  const listOf = async (kind: "objective" | "decision", runId: string) =>
    (await db.pool.query(`select id,candidate_text,status,source,edited from ${kind}_candidates where run_id=$1 order by created_at,id`, [runId])).rows;

  // Each padded case runs 30 regenerations (5 stored paddings, each followed by 5 padded answers)
  // against the real database. Measured alone in the cloud workspace: 0.3 to 1.6 s (objectives) and
  // 0.2 to 2.3 s (decisions) over three runs; in Codex's full-library run under load the objective
  // case passed 5 s. The limit is raised for these two only, to 30 s, so load does not cut them off
  // part-way (the epoch guard above keeps a cut-off loop from touching the next test either way).
  it("objectives: rejected wording stored with surrounding tabs/line breaks stays rejected however the model pads it again", { timeout: 30_000 }, async () => {
    const mine = state.epoch;
    const a = await import("../objectiveCandidateActions");
    const { generateObjectiveCandidates } = await import("../objectiveFramer");
    for (const stored of PADDED) {
      const r = await freshRun(`objective whitespace ${JSON.stringify(stored)}`);
      await a.addOwnObjectiveCandidate(r, "Own objective");
      answer(mine, [{ candidate_text: `Measure loyalty${stored}`, rationale: "first" }, { candidate_text: "Undecided idea", rationale: "first" }]);
      await generateObjectiveCandidates(tenant, r);
      const rejected = (await listOf("objective", r)).find((x) => x.candidate_text.trim() === "Measure loyalty")!;
      await a.rejectObjectiveCandidate(r, rejected.id);
      for (const again of PADDED) {
        answer(mine, [
          { candidate_text: `${again}Measure loyalty${again}`, rationale: "repeat" },
          { candidate_text: "Measure  loyalty", rationale: "inner spacing differs: distinct" },
          { candidate_text: "measure loyalty", rationale: "case differs: distinct" },
          { candidate_text: `New idea${again}`, rationale: "new" },
          { candidate_text: `${again}New idea`, rationale: "same answer, padded differently" },
        ]);
        await generateObjectiveCandidates(tenant, r);
        const after = await listOf("objective", r);
        expect(after.filter((x) => x.candidate_text.trim() === "Measure loyalty")).toEqual([
          expect.objectContaining({ id: rejected.id, status: "rejected", candidate_text: `Measure loyalty${stored}` }),
        ]);
        expect(after.filter((x) => x.candidate_text === "Measure  loyalty")).toHaveLength(1);
        expect(after.filter((x) => x.candidate_text === "measure loyalty")).toHaveLength(1);
        expect(after.filter((x) => x.candidate_text.trim() === "New idea")).toHaveLength(1);
        expect(after.filter((x) => x.candidate_text === "Own objective")).toEqual([expect.objectContaining({ status: "accepted", source: "researcher_authored" })]);
      }
    }
  });

  it("decisions: padded rejected wording never returns as accepted or into the statement; distinct wording still lands", { timeout: 30_000 }, async () => {
    const mine = state.epoch;
    const a = await import("../decisionCandidateActions");
    const { generateDecisionCandidates } = await import("../decisionFramer");
    for (const stored of PADDED) {
      const r = await freshRun(`decision whitespace ${JSON.stringify(stored)}`);
      answer(mine, [{ candidate_text: `Exit region B${stored}`, rationale: "first" }, { candidate_text: "Keep prices", rationale: "first" }]);
      await generateDecisionCandidates(tenant, r);
      const exit = (await listOf("decision", r)).find((x) => x.candidate_text.trim() === "Exit region B")!;
      await a.rejectDecisionCandidate(r, exit.id);
      for (const again of PADDED) {
        answer(mine, [
          { candidate_text: `${again}Exit region B${again}`, rationale: "repeat" },
          { candidate_text: "Exit region B.", rationale: "punctuation differs: distinct" },
          { candidate_text: `Open channel C${again}`, rationale: "new" },
          { candidate_text: `${again}Open channel C`, rationale: "same answer, padded differently" },
        ]);
        await generateDecisionCandidates(tenant, r);
        const after = await listOf("decision", r);
        expect(after.filter((x) => x.candidate_text.trim() === "Exit region B")).toEqual([expect.objectContaining({ id: exit.id, status: "rejected" })]);
        expect(after.filter((x) => x.candidate_text.trim() === "Open channel C")).toHaveLength(1);
        expect(after.filter((x) => x.candidate_text === "Exit region B.")).toHaveLength(1);
        const statement = (await db.pool.query("select decision_statement from runs where id=$1", [r])).rows[0].decision_statement as string;
        expect(statement.split("\n").some((line) => line.replace(/^\d+\.\s*/, "").trim() === "Exit region B")).toBe(false);
        expect(statement).toContain("Open channel C");
      }
    }
  });

  it("an all-repeat answer padded with whitespace rolls back, keeps undecided suggestions and the statement, and a later usable answer succeeds", async () => {
    const mine = state.epoch;
    const a = await import("../decisionCandidateActions");
    const { generateDecisionCandidates } = await import("../decisionFramer");
    const { generateObjectiveCandidates } = await import("../objectiveFramer");
    const objectiveRun = await freshRun("objective all-repeat");
    await (await import("../objectiveCandidateActions")).addOwnObjectiveCandidate(objectiveRun, "Own objective");
    answer(mine, [{ candidate_text: "Pending objective idea", rationale: "first" }, { candidate_text: "Rejected objective idea", rationale: "first" }]);
    await generateObjectiveCandidates(tenant, objectiveRun);
    await (await import("../objectiveCandidateActions")).rejectObjectiveCandidate(objectiveRun, (await listOf("objective", objectiveRun)).find((x) => x.candidate_text === "Rejected objective idea")!.id);
    const objectivesBefore = await listOf("objective", objectiveRun);
    // Only wording that survives the undecided-suggestion delete counts as already on the run:
    // the rejected suggestion and the researcher's own objective, both padded differently.
    answer(mine, [{ candidate_text: "Rejected objective idea\n", rationale: "repeat" }, { candidate_text: "\tOwn objective", rationale: "repeat" }]);
    await expect(generateObjectiveCandidates(tenant, objectiveRun)).rejects.toThrow(/every suggestion repeats wording already on this run/);
    expect(await listOf("objective", objectiveRun)).toEqual(objectivesBefore);
    answer(mine, [{ candidate_text: "Retry objective idea", rationale: "usable" }]);
    await generateObjectiveCandidates(tenant, objectiveRun);
    const objectivesAfter = await listOf("objective", objectiveRun);
    expect(objectivesAfter.some((x) => x.candidate_text === "Retry objective idea")).toBe(true);
    expect(objectivesAfter.some((x) => x.candidate_text === "Pending objective idea")).toBe(false);

    const decisionRun = await freshRun("decision all-repeat");
    answer(mine, [{ candidate_text: "Keep prices", rationale: "first" }, { candidate_text: "Exit region B", rationale: "first" }]);
    await generateDecisionCandidates(tenant, decisionRun);
    await a.rejectDecisionCandidate(decisionRun, (await listOf("decision", decisionRun)).find((x) => x.candidate_text === "Exit region B")!.id);
    await a.acceptDecisionCandidate(decisionRun, (await listOf("decision", decisionRun)).find((x) => x.candidate_text === "Keep prices")!.id, "Keep prices for now");
    const decisionsBefore = await listOf("decision", decisionRun);
    const statementBefore = (await db.pool.query("select decision_statement from runs where id=$1", [decisionRun])).rows[0].decision_statement;
    expect(statementBefore).toBe("Keep prices for now");
    answer(mine, [{ candidate_text: "Exit region B\t", rationale: "repeat" }, { candidate_text: " Keep prices for now\r\n", rationale: "repeat" }]);
    await expect(generateDecisionCandidates(tenant, decisionRun)).rejects.toThrow(/every suggestion repeats wording already on this run/);
    expect(await listOf("decision", decisionRun)).toEqual(decisionsBefore);
    expect((await db.pool.query("select decision_statement from runs where id=$1", [decisionRun])).rows[0].decision_statement).toBe(statementBefore);
    answer(mine, [{ candidate_text: "Review channel mix", rationale: "usable" }]);
    await generateDecisionCandidates(tenant, decisionRun);
    const statementAfter = (await db.pool.query("select decision_statement from runs where id=$1", [decisionRun])).rows[0].decision_statement as string;
    expect(statementAfter).toContain("Keep prices for now");
    expect(statementAfter).toContain("Review channel mix");
    expect(statementAfter).not.toContain("Exit region B");
    expect((await listOf("decision", decisionRun)).find((x) => x.candidate_text === "Keep prices for now")).toMatchObject({ edited: true, status: "accepted" });
  });
});
