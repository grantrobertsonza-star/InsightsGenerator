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
//     refuses on coverage that is not current;
//   - B37-F01 (Codex): rejecting the only finding behind a cited insight (through the actual
//     setFindingStatus action) leaves the inputs unchanged, but every conclusion citing it is qualified
//     as not supported now, on the pane's note, the export text and the stage status; changed and
//     unchecked support are qualified too; a healthy control stays unqualified; a re-check never cites
//     the invalid insight, and with no supported insight left it refuses and keeps the last check.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { insertSupportedInsight } from "./helpers/supportedInsight";
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
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));
vi.mock("../objectiveFramer", () => ({ generateObjectiveCandidates: vi.fn() }));
vi.mock("../objectiveQualityScorer", () => ({ refreshObjectiveQuality: vi.fn() }));

describe.skipIf(!TEST_DATABASE_URL)("CE-1 objective coverage identity and freshness", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string, objA: string, objB: string, decision: string, si1: string, si2: string;
  const findingOf: Record<string, string> = {};
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
    // Each insight rests on one accepted finding with its support recorded (helpers/supportedInsight.ts),
    // so its support reads current until something changes.
    const ins = async (h: string) => {
      const { insightId, findingId } = await insertSupportedInsight(db.pool, tenant, run, h);
      findingOf[insightId] = findingId;
      return insightId;
    };
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
    return withTenantRead(tenant, (client) => loadObjectiveCoverage(client, run, tenant));
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
  // ---- B37-F01 ----
  const objectiveRow = (c: Awaited<ReturnType<typeof coverage>>, text: string) => c.rows.find((r) => r.item_text === text)!;
  const reject = async (finding: string) => {
    const { setFindingStatus } = await import("../findingActions");
    expect(await setFindingStatus(run, finding, "rejected")).toEqual({ ok: true });
  };

  it("B37-F01: rejecting the sole finding behind a cited insight qualifies every conclusion citing it, everywhere it is read", async () => {
    await check();
    const { coverageNote, coverageRowCurrent, qualifiedConclusion } = await import("../objectiveCoverage");
    // Healthy control first: current, cited support current, the conclusion unqualified.
    let c = await coverage();
    expect(objectiveRow(c, "Understand why members leave").support).toEqual({ status: "current", summary: "" });
    expect(qualifiedConclusion(objectiveRow(c, "Understand why members leave"), c.freshness)).toBe("Fees explain it.");
    expect(coverageNote(c)).toBeNull();

    await reject(findingOf[si1]);
    c = await coverage();
    // The inputs did not change (same accepted insights), which is why this used to read as current.
    expect(c.freshness).toEqual({ state: "current" });
    const a = objectiveRow(c, "Understand why members leave");
    const b = objectiveRow(c, "Size the switching intent");
    const d = objectiveRow(c, "Whether to fund retention or acquisition");
    expect(a.support).toMatchObject({ status: "invalid" });
    expect(b.support).toMatchObject({ status: "invalid" }); // cites si2 and si1: the worst stands
    expect(d.support).toBeNull(); // a gap cites nothing
    expect(a.status).toBe("resolved"); // the saved verdict and wording are kept
    expect(a.conclusion).toBe("Fees explain it.");
    expect(coverageRowCurrent(a, c.freshness)).toBe(false);
    expect(coverageRowCurrent(d, c.freshness)).toBe(true);
    expect(qualifiedConclusion(a, c.freshness)).toMatch(/^Fees explain it\. \(Not supported now: an insight this conclusion cites no longer has valid support \(.*rejected.*\)\. Update coverage to check again\.\)$/);
    expect(qualifiedConclusion(d, c.freshness)).toBe("Nothing yet.");
    expect(coverageNote(c)).toBe("2 conclusions cite an insight whose support is no longer valid, so they do not stand as answered. Update coverage to check again.");
    const { loadProjectStageFacts } = await import("../projectStageFacts");
    expect((await loadProjectStageFacts(tenant, run)).objectives.coverageStale).toMatch(/no longer valid/);
  });

  it("B37-F01: changed support and support that cannot be checked are qualified too, and recover", async () => {
    await check();
    const { qualifiedConclusion } = await import("../objectiveCoverage");
    // Changed: the finding's wording changed after the insight was drafted.
    await q("update findings set finding_text = 'Fees and service drive leaving' where id = $1", [findingOf[si1]]);
    let c = await coverage();
    expect(objectiveRow(c, "Understand why members leave").support).toMatchObject({ status: "stale" });
    expect(qualifiedConclusion(objectiveRow(c, "Understand why members leave"), c.freshness)).toMatch(/\(Support changed: an insight this conclusion cites has changed support since it was written/);
    await q("update findings set finding_text = 'Fees drive leaving (finding)' where id = $1", [findingOf[si1]]);
    expect(objectiveRow(await coverage(), "Understand why members leave").support).toMatchObject({ status: "current" });
    // Unchecked: the support reader fails; never current.
    await q("alter function finding_support_parts(uuid) rename to finding_support_parts_moved");
    try {
      c = await coverage();
      expect(objectiveRow(c, "Understand why members leave").support).toMatchObject({ status: "unknown" });
      expect(qualifiedConclusion(objectiveRow(c, "Understand why members leave"), c.freshness)).toMatch(/\(Support not checked: whether the insights this conclusion cites are still supported could not be checked/);
    } finally {
      await q("alter function finding_support_parts_moved(uuid) rename to finding_support_parts");
    }
    expect(objectiveRow(await coverage(), "Understand why members leave").support).toMatchObject({ status: "current" });
  });

  it("B37-F01: a re-check never cites an insight whose support is invalid; with none supported it refuses and keeps the last check", async () => {
    await check();
    await reject(findingOf[si1]);
    const prompts: string[] = [];
    const { anthropic } = await import("../anthropic");
    const create = anthropic.messages.create;
    (anthropic.messages as { create: unknown }).create = async (req: { system: string }) => {
      prompts.push(req.system);
      return create(req as never);
    };
    try {
      // The model is offered only si2 now, as index 0; it cites index 0 for every item.
      model.answer = async () => ({
        validations: [0, 1, 2].map((i) => ({ item_index: i, status: i === 2 ? "gap" : "resolved", conclusion: `Recheck ${i}.`, insight_indices: i === 2 ? [] : [0] })),
      });
      await check();
      expect(prompts[0]).toContain("Switching intent is low");
      expect(prompts[0]).not.toContain("Fees drive leaving");
      const c = await coverage();
      expect(c.rows.flatMap((r) => r.synthesized_insight_ids)).toEqual([si2, si2]);
      expect(objectiveRow(c, "Understand why members leave").support).toMatchObject({ status: "current" });
      const { coverageNote } = await import("../objectiveCoverage");
      expect(coverageNote(c)).toBeNull();
      // Every finding rejected: nothing supported is left to check against. Refused, the last check kept and still qualified.
      await reject(findingOf[si2]);
      const before = await q("select id, conclusion from objective_validations where run_id = $1 order by item_kind, item_order", [run]);
      await expect(check()).rejects.toThrow(/No accepted insight has valid support now.*The last check is kept/);
      expect(await q("select id, conclusion from objective_validations where run_id = $1 order by item_kind, item_order", [run])).toEqual(before);
      expect(objectiveRow(await coverage(), "Understand why members leave").support).toMatchObject({ status: "invalid" });
    } finally {
      (anthropic.messages as { create: unknown }).create = create;
    }
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("CE-1 objective coverage identity and freshness", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});

});
