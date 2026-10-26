// CE-1 (evidence chain, 26 October 2026): objective coverage keyed by identity and known to be current
// or not. Real disposable PostgreSQL through the app's own db.ts; the model is the mocked boundary.
//   - a check records each row's accepted objective or decision id, cites insights through the link
//     table, and reads back as current;
//   - rejecting an insight, accepting a new objective, or deleting a cited insight makes it out of date
//     (before, the same verdicts were shown as current), and the qualification reaches the export text,
//     the stage status and the research assistant's reading;
//   - an automatic re-check that fails leaves it out of date, never current;
//   - inputs that change while the model is answering: nothing is saved and the earlier rows stand;
//   - rows from before migration 0119 read as unknown; "suggest objectives from unmatched insights"
//     refuses on coverage that is not current.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const model = vi.hoisted(() => ({ answer: null as null | (() => Promise<unknown>) }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "synthetic",
  anthropic: { messages: { create: async () => ({ content: [{ type: "tool_use", input: await model.answer!() }], usage: {} }) } },
}));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../objectiveFramer", () => ({ generateObjectiveCandidates: vi.fn() }));
vi.mock("../objectiveQualityScorer", () => ({ refreshObjectiveQuality: vi.fn() }));

describe.skipIf(!TEST_DATABASE_URL)("CE-1 objective coverage identity and freshness", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string, objA: string, objB: string, decision: string, si1: string, si2: string;
  const q = async (sql: string, args: unknown[] = []) => (await db.pool.query(sql, args)).rows;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await q("insert into tenants(id,name) values($1,'Synthetic coverage')", [tenant]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });
  beforeEach(async () => {
    run = (await q("insert into runs(tenant_id) values($1) returning id", [tenant]))[0].id;
    const cand = async (table: string, text: string) => (await q(`insert into ${table}(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,$3,'Synthetic','researcher_authored','accepted') returning id`, [tenant, run, text]))[0].id;
    objA = await cand("objective_candidates", "Understand why members leave");
    objB = await cand("objective_candidates", "Size the switching intent");
    decision = await cand("decision_candidates", "Whether to fund retention or acquisition");
    const ins = async (h: string) => (await q("insert into synthesized_insights(tenant_id,run_id,headline,observation,tension,implication,review_status) values($1,$2,$3,'o','t','i','accepted') returning id", [tenant, run, h]))[0].id;
    si1 = await ins("Fees drive leaving");
    si2 = await ins("Switching intent is low");
    model.answer = async () => ({
      validations: [
        { item_index: 0, status: "resolved", conclusion: "Fees explain it.", insight_indices: [0] },
        { item_index: 1, status: "partial", conclusion: "Some intent.", insight_indices: [1, 0] },
        { item_index: 2, status: "gap", conclusion: "Nothing yet.", insight_indices: [] },
      ],
    });
  });
  const coverage = async () => {
    const { withTenantRead } = await import("../db");
    const { loadObjectiveCoverage } = await import("../objectiveCoverage");
    return withTenantRead(tenant, (client) => loadObjectiveCoverage(client, run));
  };
  const check = async () => (await import("../objectiveValidator")).generateObjectiveValidation(tenant, run);

  it("records candidate ids and cited insights by link, and reads back current", async () => {
    await check();
    const c = await coverage();
    expect(c.freshness).toEqual({ state: "current" });
    const byText = Object.fromEntries(c.rows.map((r) => [r.item_text, r]));
    expect(byText["Understand why members leave"]).toMatchObject({ objective_candidate_id: objA, decision_candidate_id: null, synthesized_insight_ids: [si1] });
    expect(byText["Size the switching intent"].objective_candidate_id).toBe(objB);
    expect(byText["Whether to fund retention or acquisition"]).toMatchObject({ decision_candidate_id: decision, objective_candidate_id: null, synthesized_insight_ids: [] });
    // Cited in the model's order, through rows with foreign keys.
    expect(new Set(byText["Size the switching intent"].synthesized_insight_ids)).toEqual(new Set([si1, si2]));
    expect((await q("select count(*)::int as n from objective_validation_insights l join objective_validations v on v.id = l.validation_id where v.run_id = $1", [run]))[0].n).toBe(3);
  });

  it("is out of date after an insight is rejected, an objective is added or a cited insight is deleted, and says so downstream", async () => {
    await check();
    await q("update synthesized_insights set review_status = 'rejected' where id = $1", [si2]);
    let c = await coverage();
    expect(c.freshness).toEqual({ state: "stale", changed: ["insights"] });
    const { coverageFreshnessNote, qualifiedConclusion } = await import("../objectiveCoverage");
    expect(coverageFreshnessNote(c.freshness)).toMatch(/^Out of date: the accepted insights changed after this evidence check/);
    expect(qualifiedConclusion(c.rows[0], c.freshness)).toMatch(/\(Out of date: the accepted insights changed/);

    await q("insert into objective_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'A new objective','Synthetic','researcher_authored','accepted')", [tenant, run]);
    c = await coverage();
    expect(c.freshness).toMatchObject({ state: "stale" });
    expect((c.freshness as { changed: string[] }).changed.sort()).toEqual(["insights", "objectives"]);

    // A deleted insight leaves no dangling id: its link row is gone with it.
    await q("delete from synthesized_insights where id = $1", [si1]);
    c = await coverage();
    expect(c.rows.flatMap((r) => r.synthesized_insight_ids)).not.toContain(si1);

    const { loadProjectStageFacts } = await import("../projectStageFacts");
    const facts = await loadProjectStageFacts(tenant, run);
    expect(facts.objectives.coverageStale).toMatch(/^Out of date/);
  });

  it("an automatic re-check that fails after a change leaves the coverage out of date, not current", async () => {
    await check();
    await q("update synthesized_insights set review_status = 'rejected' where id = $1", [si2]);
    model.answer = async () => {
      throw new Error("model unavailable");
    };
    const { refreshObjectiveValidationQuietly } = await import("../objectiveValidator");
    await refreshObjectiveValidationQuietly(tenant, run);
    expect((await coverage()).freshness).toEqual({ state: "stale", changed: ["insights"] });
  });

  it("saves nothing when the inputs change while the model is answering, and keeps the earlier rows", async () => {
    await check();
    const before = await q("select id, conclusion, inputs from objective_validations where run_id = $1 order by item_kind, item_order", [run]);
    model.answer = async () => {
      // Another request rejects an insight mid-check.
      await q("update synthesized_insights set review_status = 'rejected' where id = $1", [si2]);
      return { validations: [0, 1, 2].map((i) => ({ item_index: i, status: "gap", conclusion: "Changed", insight_indices: [] })) };
    };
    const { CoverageInputsChangedError } = await import("../objectiveValidator");
    await expect(check()).rejects.toBeInstanceOf(CoverageInputsChangedError);
    expect(await q("select id, conclusion, inputs from objective_validations where run_id = $1 order by item_kind, item_order", [run])).toEqual(before);
    expect((await coverage()).freshness).toMatchObject({ state: "stale" });
  });

  it("reads rows without recorded inputs as unknown, and refuses to suggest objectives from coverage that is not current", async () => {
    await check();
    await q("update objective_validations set inputs = null where run_id = $1", [run]);
    const c = await coverage();
    expect(c.freshness).toEqual({ state: "unknown" });
    const { coverageFreshnessNote } = await import("../objectiveCoverage");
    expect(coverageFreshnessNote(c.freshness)).toMatch(/^Not known to be current/);
    const { suggestObjectivesFromUnmatched } = await import("../objectiveCoverageActions");
    expect(await suggestObjectivesFromUnmatched(run)).toMatchObject({ ok: false, error: expect.stringMatching(/^Not known to be current/) });
    const { generateObjectiveCandidates } = await import("../objectiveFramer");
    expect(generateObjectiveCandidates).not.toHaveBeenCalled();
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("CE-1 objective coverage identity and freshness", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
