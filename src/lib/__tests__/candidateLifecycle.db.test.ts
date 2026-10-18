import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, DISPOSABLE_DB_SKIP_REASON, type DisposableDb } from "./helpers/disposableDb";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

const state = vi.hoisted(() => ({ failRefresh: false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../insightGenerator", () => ({ refreshInsights: vi.fn(async () => { if (state.failRefresh) throw new Error("refresh unavailable"); }) }));
vi.mock("../recommendationAgent", () => ({ refreshRecommendations: vi.fn(async () => {}) }));
vi.mock("../objectiveQualityScorer", () => ({ refreshObjectiveQuality: vi.fn(async () => {}) }));
vi.mock("../objectiveValidator", () => ({ refreshObjectiveValidationQuietly: vi.fn(async () => {}) }));
vi.mock("../anthropic", () => ({ anthropic: { messages: { create: vi.fn(async () => ({ content: [{ type: "tool_use", input: { candidates: [{ candidate_text: "To assess synthetic evidence", rationale: "Retained synthetic finding" }] } }], usage: { input_tokens: 0, output_tokens: 0 } })) } }, CLAUDE_MODEL: "controlled" }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../extractFindings", () => ({ readContextDocument: vi.fn() }));

describe.skipIf(!TEST_DATABASE_URL)("candidate lifecycle persistence (real database; model refresh controlled)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string, other: string;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic lifecycle')", [tenant]);
    const rows = (await db.pool.query("insert into runs(tenant_id,project_name,initial_research_objective,stated_objectives_text,objective_candidates_seeded) values($1,'A','Original immutable brief','Initial objective',true),($1,'B',null,null,false) returning id", [tenant])).rows;
    [run, other] = rows.map(r => r.id);
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); });
  const candidates = async (kind: "objective" | "decision") => (await db.pool.query(`select id,candidate_text,status,source,edited from ${kind}_candidates where run_id=$1 order by created_at,id`, [run])).rows;

  it("SET-001/002: Setup and Review share identity; duplicate/concurrent own additions persist once", async () => {
    const a = await import("../objectiveCandidateActions");
    const setup = await import("../runContextActions");
    await Promise.all([a.addOwnObjectiveCandidate(run, "Initial objective"), a.addOwnObjectiveCandidate(run, " Initial objective ")]);
    expect((await candidates("objective"))).toHaveLength(1);
    const id = (await candidates("objective"))[0].id;
    await setup.editStatedObjective(run, "Initial objective", "Updated in Setup");
    expect((await candidates("objective"))[0]).toMatchObject({ id, candidate_text: "Updated in Setup" });
    await a.acceptObjectiveCandidate(run, id, "Edited in Review");
    expect((await candidates("objective"))[0]).toMatchObject({ id, candidate_text: "Edited in Review" });
    await a.deleteObjectiveCandidate(run, id);
    expect(await candidates("objective")).toEqual([]);
    expect((await db.pool.query("select initial_research_objective from runs where id=$1", [run])).rows[0].initial_research_objective).toBe("Original immutable brief");
  });

  it("REV-004: accept/reject/restore retains human wording and excludes another run", async () => {
    const a = await import("../objectiveCandidateActions");
    await a.addOwnObjectiveCandidate(run, "Human objective");
    const id = (await candidates("objective"))[0].id;
    await a.acceptObjectiveCandidate(run, id, "Researcher edited objective");
    await a.rejectObjectiveCandidate(other, id);
    expect((await candidates("objective"))[0].status).toBe("accepted");
    await a.rejectObjectiveCandidate(run, id);
    await a.restoreObjectiveCandidate(run, id);
    await a.unacceptObjectiveCandidate(run, id);
    await a.acceptObjectiveCandidate(run, id);
    expect((await candidates("objective"))[0]).toMatchObject({ id, candidate_text: "Researcher edited objective", status: "accepted", source: "researcher_authored", edited: true });
  });

  it("SET-003/REV-004: regeneration preserves current wording and decisions, then never resurrects a deleted original", async () => {
    const a = await import("../objectiveCandidateActions");
    const setup = await import("../runContextActions");
    const { generateObjectiveCandidates } = await import("../objectiveFramer");
    await db.pool.query("insert into findings(tenant_id,run_id,origin,finding_text) values($1,$2,'generated','Retained synthetic evidence')", [tenant, run]);
    await a.addOwnObjectiveCandidate(run, "Lifecycle A");
    const id = (await candidates("objective")).find(r => r.candidate_text === "Lifecycle A")!.id;
    await setup.editStatedObjective(run, "Lifecycle A", "Lifecycle B");
    await setup.editStatedObjective(run, "Lifecycle B", "Lifecycle C");
    await a.acceptObjectiveCandidate(run, id);
    await generateObjectiveCandidates(tenant, run);
    expect((await candidates("objective")).find(r => r.id === id)).toMatchObject({ candidate_text: "Lifecycle C", status: "accepted" });
    expect((await candidates("objective")).some(r => ["Lifecycle A", "Lifecycle B", "Original immutable brief"].includes(r.candidate_text))).toBe(false);
    await a.deleteObjectiveCandidate(run, id);
    await generateObjectiveCandidates(tenant, run);
    expect((await candidates("objective")).some(r => ["Lifecycle A", "Lifecycle B", "Lifecycle C", "Original immutable brief"].includes(r.candidate_text))).toBe(false);
    expect((await db.pool.query("select initial_research_objective from runs where id=$1", [run])).rows[0].initial_research_objective).toBe("Original immutable brief");
  });

  it("SET-003 Setup-only first save marks seeding before edits and deletion, preserving the original brief", async () => {
    const setup = await import("../runContextActions");
    const { generateObjectiveCandidates } = await import("../objectiveFramer");
    const form = new FormData(); form.set("researchObjective", "Setup-only A");
    await setup.saveRunContext(other, form);
    await setup.editStatedObjective(other, "Setup-only A", "Setup-only B");
    await setup.editStatedObjective(other, "Setup-only B", "Setup-only C");
    await db.pool.query("insert into findings(tenant_id,run_id,origin,finding_text) values($1,$2,'generated','Synthetic Setup-only evidence')", [tenant,other]);
    await generateObjectiveCandidates(tenant, other);
    const texts = async () => (await db.pool.query("select candidate_text from objective_candidates where run_id=$1", [other])).rows.map(r => r.candidate_text);
    expect(await texts()).toContain("Setup-only C");
    expect(await texts()).not.toContain("Setup-only A");
    expect(await texts()).not.toContain("Setup-only B");
    await setup.editStatedObjective(other, "Setup-only C", null);
    await generateObjectiveCandidates(tenant, other);
    expect(await texts()).not.toContain("Setup-only C");
    expect((await db.pool.query("select initial_research_objective,objective_candidates_seeded from runs where id=$1", [other])).rows[0]).toMatchObject({ initial_research_objective: "Setup-only A", objective_candidates_seeded: true });
  });

  it("business remainder: reject/restore/unaccept/delete/bulk and accepted statement stay aligned", async () => {
    const a = await import("../decisionCandidateActions");
    await a.addOwnDecisionCandidate(run, "Decision A");
    await a.addOwnDecisionCandidate(run, "Decision B");
    const id = (await candidates("decision")).find(r => r.candidate_text === "Decision A")!.id;
    await a.acceptDecisionCandidate(run, id, "Human decision A");
    await a.rejectDecisionCandidate(other, id);
    expect((await candidates("decision")).find(r => r.id === id)).toMatchObject({ status: "accepted" });
    await a.rejectDecisionCandidate(run, id);
    await a.restoreDecisionCandidate(run, id);
    await a.unacceptDecisionCandidate(run, id);
    await a.acceptAllDecisionCandidates(run);
    expect((await candidates("decision")).find(r => r.id === id)).toMatchObject({ candidate_text: "Human decision A", edited: true, status: "accepted" });
    await a.unacceptDecisionCandidate(run, id);
    await a.deleteAllDecisionCandidates(run);
    await a.deleteDecisionCandidate(run, (await candidates("decision"))[0].id);
    expect(await candidates("decision")).toEqual([]);
    expect((await db.pool.query("select decision_statement from runs where id=$1", [run])).rows[0].decision_statement).toBeNull();
  });

  it("business failed-refresh retry never duplicates an already persisted researcher decision", async () => {
    const a = await import("../decisionCandidateActions");
    state.failRefresh = true;
    // The addition commits; the failed refresh is reported, not thrown (decisionRefresh.ts).
    expect(await a.addOwnDecisionCandidate(run, "Retry this decision")).toEqual({ ok: true, refreshError: "refresh unavailable" });
    state.failRefresh = false;
    await a.addOwnDecisionCandidate(run, "Retry this decision");
    expect((await candidates("decision")).filter(r => r.candidate_text === "Retry this decision")).toHaveLength(1);
    await Promise.all([a.addOwnDecisionCandidate(run, "Concurrent decision"), a.addOwnDecisionCandidate(run, " Concurrent decision ")]);
    const matching = (await candidates("decision")).filter(r => r.candidate_text === "Concurrent decision");
    expect(matching).toHaveLength(1);
    await a.rejectDecisionCandidate(run, matching[0].id);
    await a.addOwnDecisionCandidate(run, "Concurrent decision");
    expect((await candidates("decision")).find(r => r.id === matching[0].id)).toMatchObject({ status: "rejected", source: "researcher_authored" });
  });
  it("SET-002 missing-index/savepoint path handles concurrent additions without duplicate human objectives", async () => {
    const a = await import("../objectiveCandidateActions");
    await db.pool.query("drop index objective_candidates_researcher_text_uniq");
    await db.pool.query("create function delay_fallback_insert() returns trigger language plpgsql as $$ begin if new.candidate_text='Fallback objective' then perform pg_sleep(0.1); end if; return new; end $$; create trigger delay_fallback_insert before insert on objective_candidates for each row execute function delay_fallback_insert()");
    await Promise.all([a.addOwnObjectiveCandidate(run, "Fallback objective"), a.addOwnObjectiveCandidate(run, " Fallback objective ")]);
    expect((await candidates("objective")).filter(r => r.candidate_text === "Fallback objective")).toHaveLength(1);
    await a.addOwnObjectiveCandidate(run, "Fallback objective");
    expect((await candidates("objective")).filter(r => r.candidate_text === "Fallback objective")).toHaveLength(1);
  });
  it("SET-003 legacy seed backfill prevents old upfront wording returning after regeneration or deletion", async () => {
    const legacy = (await db.pool.query("insert into runs(tenant_id,initial_research_objective,stated_objectives_text,objective_candidates_seeded) values($1,'Legacy A','Legacy C',false) returning id", [tenant])).rows[0].id;
    const candidate = (await db.pool.query("insert into objective_candidates(tenant_id,run_id,candidate_text,rationale,source,status,edited) values($1,$2,'Legacy C','Synthetic researcher wording','researcher_authored','accepted',true) returning id",[tenant,legacy])).rows[0].id;
    await db.pool.query("insert into findings(tenant_id,run_id,origin,finding_text) values($1,$2,'generated','Synthetic legacy evidence')",[tenant,legacy]);
    await db.pool.query(readFileSync(path.join(process.cwd(),"supabase/migrations/0084_objective_candidates_seeded.sql"),"utf8"));
    expect((await db.pool.query("select objective_candidates_seeded from runs where id=$1",[legacy])).rows[0].objective_candidates_seeded).toBe(true);
    const { generateObjectiveCandidates } = await import("../objectiveFramer");
    const { deleteObjectiveCandidate } = await import("../objectiveCandidateActions");
    await generateObjectiveCandidates(tenant,legacy);
    expect((await db.pool.query("select candidate_text from objective_candidates where id=$1",[candidate])).rows[0].candidate_text).toBe("Legacy C");
    await deleteObjectiveCandidate(legacy,candidate);
    await generateObjectiveCandidates(tenant,legacy);
    expect((await db.pool.query("select candidate_text from objective_candidates where run_id=$1 and candidate_text in ('Legacy A','Legacy C')",[legacy])).rows).toEqual([]);
    expect((await db.pool.query("select initial_research_objective from runs where id=$1",[legacy])).rows[0].initial_research_objective).toBe("Legacy A");
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("candidate lifecycle persistence (real database; model refresh controlled)", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
