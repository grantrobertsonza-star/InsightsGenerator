// OBJ-REV-001/002 Rule B (migration 0095): origin recording, edits, regeneration scope, missing-
// migration recovery, read failures and snapshot consistency - through the ACTUAL
// generateEvidenceQuestions / publishGeneratedQuestions / editEvidenceQuestion /
// loadObjectiveEvidenceWithCoverage and the actual server actions, with the REAL db.ts transaction
// wrappers. Controlled boundaries only: `pg` (./helpers/fakeObjectiveDb.ts), the model call, the
// variable dictionary (../crosstabs), API-usage logging, the Supabase client and revalidatePath.
// Not real PostgreSQL; the integration cases are listed in the handover.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeObjectiveDb, type FakeObjectiveDb, type Row } from "./helpers/fakeObjectiveDb";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

vi.setConfig({ testTimeout: 30000 });

const TENANT = vi.hoisted(() => {
  const id = "00000000-0000-4000-8000-000000000001";
  process.env.DEFAULT_TENANT_ID = id;
  return id;
});
const RUN = "run-1";

let db: FakeObjectiveDb;
const drafted: string[] = [];
vi.mock("pg", () => ({ Pool: class { async connect() { return db.connect(); } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => undefined) }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../crosstabs", () => ({
  loadVariableDictionary: vi.fn(async () => ({ variables: [{ name: "q1", label: "Uses mobile banking", weightLike: false, text: false }] })),
}));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "claude-sonnet-5",
  anthropic: {
    messages: {
      create: vi.fn(async (args: { messages: { content: string }[] }) => {
        drafted.push(args.messages[0].content);
        return {
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t", name: "submit_questions", input: { questions: [{ question: `Q for ${args.messages[0].content}`, request: "mobile banking by gender", supports_if: "higher", against_if: "lower", expectation: { kind: "none" } }] } }],
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      }),
    },
  },
}));

let created = 0;
function ev(id: string, kind: "objective" | "decision", order: number, link: string | null, text: string, extra: Row = {}): Row {
  return {
    id,
    tenant_id: TENANT,
    run_id: RUN,
    document_id: null,
    item_kind: kind,
    item_order: order,
    objective_candidate_id: kind === "objective" ? link : null,
    decision_candidate_id: kind === "decision" ? link : null,
    item_text: text,
    question: `Question ${id}`,
    request_text: "req",
    supports_if: "s",
    against_if: "a",
    expectation: null,
    source: "auto",
    excluded: false,
    question_revision: 1,
    generation_id: "gen-old",
    origin_candidate_id: null,
    origin_recorded: false,
    created_seq: created++,
    ...extra,
  };
}
const cand = (id: string, text: string, extra: Row = {}): Row => ({ id, run_id: RUN, candidate_text: text, source: "researcher_authored", status: "accepted", created_seq: created++, ...extra });

function world(extra: Partial<Parameters<typeof createFakeObjectiveDb>[0]> = {}, origin = true) {
  db = createFakeObjectiveDb(
    {
      runs: [{ id: RUN, tenant_id: TENANT, research_objective: null, decision_statement: null }],
      documents: [{ id: "doc-1", run_id: RUN, kind: "table", source_filename: "data.sav", ingestion_type: null }],
      generations: [{ id: "gen-old", tenant_id: TENANT, run_id: RUN, variables_truncated: false, pooled_count: 1, used_count: 1, is_current: true }],
      ...extra,
    },
    { origin },
  );
}

// db.ts caches its Pool on globalThis.pgPool, which survives vi.resetModules. Cleared before each
// test so this file's mocked Pool (bound to this file's fake) is the one db.ts constructs, and after
// the file so no pool bound to this fake leaks into another file sharing the worker thread.
const clearCachedPool = () => {
  delete (globalThis as { pgPool?: unknown }).pgPool;
};
afterAll(clearCachedPool);

beforeEach(() => {
  clearCachedPool();
  vi.resetModules();
  drafted.length = 0;
});

describe("Rule B origin recording at creation (actual generateEvidenceQuestions -> publishGeneratedQuestions)", () => {
  it("every inserted question records origin explicitly: the candidate for a candidate item, null for a free-text item, recorded = true", async () => {
    world({ objective_candidates: [cand("cand-A", "Grow digital adoption")], runs: [{ id: RUN, tenant_id: TENANT, research_objective: null, decision_statement: "1. Expand to Gauteng" }] });
    const { generateEvidenceQuestions } = await import("../objectiveEvidence");
    await generateEvidenceQuestions(TENANT, RUN);
    const inserted = db.store.evidence.filter((e) => String(e.id).startsWith("ev-new"));
    expect(inserted.map((e) => [e.item_kind, e.objective_candidate_id, e.decision_candidate_id, e.origin_candidate_id, e.origin_recorded])).toEqual([
      ["objective", "cand-A", null, "cand-A", true],
      ["decision", null, null, null, true],
    ]);
    // Explicit, not the column default: the insert names both origin columns and passes `true`.
    const inserts = db.log.filter((l) => l.sql.startsWith("insert into objective_evidence ("));
    expect(inserts.every((l) => l.sql.includes("origin_candidate_id, origin_recorded") && l.params[15] === true)).toBe(true);
  });

  it("an omitted-origin row (fail-closed default) stays origin unknown and never attaches", async () => {
    world({ runs: [{ id: RUN, tenant_id: TENANT, research_objective: "1. Grow digital adoption", decision_statement: null }], evidence: [ev("ev-omitted", "objective", 0, null, "Grow digital adoption")] });
    const { loadObjectiveEvidenceAction } = await import("../objectiveEvidenceActions");
    const res = await loadObjectiveEvidenceAction(RUN);
    if (!res.ok) throw new Error(res.error);
    expect(res.items).toEqual([expect.objectContaining({ key: "unknown:ev-omitted", identity: "unknown", orphaned: true })]);
  });
});

describe("Rule B: researcher edits preserve origin (actual editEvidenceQuestion)", () => {
  const seeded = () => [
    ev("ev-cand", "objective", 0, null, "Old", { ...{ origin_candidate_id: "cand-gone", origin_recorded: true } }),
    ev("ev-text", "objective", 1, null, "Text", { origin_recorded: true }),
    ev("ev-unknown", "objective", 2, null, "Legacy"),
  ];
  for (const [label, patch, changed] of [
    ["a wording change (source -> edited, generation_id cleared)", { question: "New researcher wording" }, true],
    ["an unchanged resubmission", { question: "Question ev-cand" }, false],
    ["an exclusion-only edit", { excluded: true }, false],
  ] as const) {
    it(`${label} leaves origin_candidate_id and origin_recorded exactly as they were`, async () => {
      world({ evidence: seeded() });
      const { editEvidenceQuestion } = await import("../objectiveEvidence");
      for (const id of ["ev-cand", "ev-text", "ev-unknown"]) {
        const patchFor = "question" in patch && patch.question === "Question ev-cand" ? { question: `Question ${id}` } : patch;
        await editEvidenceQuestion(TENANT, RUN, id, patchFor);
      }
      const byId: Record<string, Row> = Object.fromEntries(db.store.evidence.map((e) => [e.id as string, e]));
      expect([byId["ev-cand"].origin_candidate_id, byId["ev-cand"].origin_recorded]).toEqual(["cand-gone", true]);
      expect([byId["ev-text"].origin_candidate_id, byId["ev-text"].origin_recorded]).toEqual([null, true]);
      // Editing an unknown row never makes it a known free-text origin.
      expect([byId["ev-unknown"].origin_candidate_id, byId["ev-unknown"].origin_recorded]).toEqual([null, false]);
      if (changed) expect(Object.values(byId).every((e) => e.source === "edited" && e.generation_id === null)).toBe(true);
      else expect(Object.values(byId).every((e) => e.generation_id === "gen-old")).toBe(true);
      expect(db.log.filter((l) => l.sql.startsWith("update objective_evidence set")).every((l) => !/origin_/.test(l.sql))).toBe(true);
    });
  }
});

describe("Rule B regeneration scope (actual generateEvidenceQuestions)", () => {
  it("replaces only untouched automatic rows (including automatic orphans); manual, edited and excluded rows survive in every orphan state", async () => {
    world({
      objective_candidates: [cand("cand-A", "Grow digital adoption")],
      evidence: [
        ev("auto-orphan-deleted", "objective", 0, null, "Removed objective", { origin_candidate_id: "cand-gone", origin_recorded: true }),
        ev("auto-orphan-unknown", "objective", 1, null, "Legacy objective"),
        ev("auto-linked", "objective", 0, "cand-A", "Grow digital adoption", { origin_candidate_id: "cand-A", origin_recorded: true }),
        ev("manual-unknown", "objective", 0, null, "Legacy objective", { source: "manual", generation_id: null }),
        ev("edited-deleted", "objective", 1, null, "Removed objective", { source: "edited", generation_id: null, origin_candidate_id: "cand-gone", origin_recorded: true }),
        ev("excluded-auto-orphan", "objective", 2, null, "Removed objective", { excluded: true, origin_candidate_id: "cand-gone", origin_recorded: true }),
      ],
    });
    const { generateEvidenceQuestions } = await import("../objectiveEvidence");
    await generateEvidenceQuestions(TENANT, RUN);
    const ids = db.store.evidence.map((e) => e.id as string);
    expect(ids.filter((id) => !id.startsWith("ev-new")).sort()).toEqual(["edited-deleted", "excluded-auto-orphan", "manual-unknown"]);
    expect(db.store.evidence.find((e) => e.id === "manual-unknown")).toMatchObject({ source: "manual", origin_recorded: false });
    expect(db.store.evidence.find((e) => e.id === "edited-deleted")).toMatchObject({ source: "edited", origin_candidate_id: "cand-gone" });
  });

  it("protected orphans never suppress drafting for an unrelated current item in their old position; a protected attached row still does", async () => {
    world({
      runs: [{ id: RUN, tenant_id: TENANT, research_objective: "1. New free-text objective", decision_statement: null }],
      decision_candidates: [cand("dec-B", "Cut prices")],
      evidence: [
        ev("manual-unknown-0", "objective", 0, null, "New free-text objective", { source: "manual" }), // same text and position, unknown origin
        ev("edited-deleted-0", "objective", 0, null, "New free-text objective", { source: "edited", origin_candidate_id: "cand-gone", origin_recorded: true }),
        ev("edited-attached", "decision", 0, "dec-B", "Cut prices", { source: "edited", origin_candidate_id: "dec-B", origin_recorded: true }),
      ],
    });
    const { generateEvidenceQuestions } = await import("../objectiveEvidence");
    await generateEvidenceQuestions(TENANT, RUN);
    expect(drafted).toEqual(["Research objective: New free-text objective"]);
  });
});

describe("Rule B missing migration 0095: creation fails actionably, nothing changes", () => {
  it("generation is refused before any model call or write, with the 0095 recovery message through the actual action", async () => {
    world({ objective_candidates: [cand("cand-A", "Grow digital adoption")], evidence: [ev("human", "objective", 0, "cand-A", "Grow digital adoption", { source: "edited" })] }, false);
    const before = structuredClone(db.store);
    const { generateObjectiveEvidenceAction } = await import("../objectiveEvidenceActions");
    const res = await generateObjectiveEvidenceAction(RUN);
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/migration 0095_objective_evidence_origin has not been applied.*Nothing was changed/) });
    expect(drafted).toEqual([]);
    expect(db.store).toEqual(before);
  });

  it("publishGeneratedQuestions itself refuses before any write (run lock first, then the origin check)", async () => {
    world({}, false);
    const before = structuredClone(db.store);
    const { publishGeneratedQuestions } = await import("../objectiveEvidence");
    const client = db.connect();
    await client.query("begin");
    await expect(
      publishGeneratedQuestions(client as never, { tenantId: TENANT, runId: RUN, drafted: [], variablesTruncated: false, pooledCount: 0, usedCount: 0 }),
    ).rejects.toThrow(/0095/);
    await client.query("rollback");
    const statements = db.log.map((l) => l.sql);
    expect(statements[1]).toContain("select id from runs where id = $1 and tenant_id = $2 for update");
    expect(statements[2]).toContain("information_schema.columns");
    expect(statements.some((s) => /^(update|insert|delete)/.test(s))).toBe(false);
    expect(db.store).toEqual(before);
  });

  it("an origin column missing at INSERT time (race after the check) rolls the whole publication back, with the 0095 message", async () => {
    world({ objective_candidates: [cand("cand-A", "Grow digital adoption")], evidence: [ev("old-auto", "objective", 0, "cand-A", "Grow digital adoption", { origin_candidate_id: "cand-A", origin_recorded: true })] });
    db.failOn(/^insert into objective_evidence \(/, 'column "origin_candidate_id" of relation "objective_evidence" does not exist');
    const before = structuredClone(db.store);
    const { generateObjectiveEvidenceAction } = await import("../objectiveEvidenceActions");
    const res = await generateObjectiveEvidenceAction(RUN);
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/needs migration 0095/) });
    expect(db.store).toEqual(before); // prior generation still current, prior question in place
  });
});

describe("Rule B reads: missing 0095 recovers visibly; other failures fail visibly", () => {
  it("without 0095 the load succeeds with originAvailable = false: linked rows stay attached, unlinked rows read as origin unknown", async () => {
    world({
      runs: [{ id: RUN, tenant_id: TENANT, research_objective: "1. Free text", decision_statement: null }],
      decision_candidates: [cand("dec-B", "Cut prices")],
      evidence: [ev("linked", "decision", 0, "dec-B", "Cut prices"), ev("free", "objective", 0, null, "Free text")],
    }, false);
    const { loadObjectiveEvidenceAction } = await import("../objectiveEvidenceActions");
    const res = await loadObjectiveEvidenceAction(RUN);
    if (!res.ok) throw new Error(res.error);
    expect(res.originAvailable).toBe(false);
    expect(Object.fromEntries(res.items.map((i) => [i.key, [i.identity, i.orphaned]]))).toEqual({ "unknown:free": ["unknown", true], "id:dec-B": ["linked", false] });
    // Savepoint-safe fallback: the failed origin select is rolled back to its savepoint before the legacy select.
    const s = db.log.map((l) => l.sql);
    const failed = s.findIndex((x) => x.includes("origin_candidate_id, origin_recorded from objective_evidence"));
    expect(s[failed + 1]).toBe("rollback to savepoint objective_evidence_origin_read");
    expect(s[failed + 2]).toMatch(/^select id, item_kind.* from objective_evidence where run_id = \$1 order by/);
  });

  for (const [label, match, error] of [
    ["a permission failure on the evidence read", /from objective_evidence where run_id = \$1 order by/, "permission denied for table objective_evidence"],
    ["a permission failure on the current-objectives read", /from objective_candidates where run_id/, "permission denied for table objective_candidates"],
    ["a connection failure on the run read", /from runs where id = \$1$/, "Connection terminated unexpectedly"],
  ] as const) {
    it(`${label} fails the load visibly, never an empty or all-orphaned success`, async () => {
      world({ objective_candidates: [cand("cand-A", "Grow digital adoption")], evidence: [ev("x", "objective", 0, "cand-A", "Grow digital adoption")] });
      db.failOn(match, error);
      const { loadObjectiveEvidenceAction } = await import("../objectiveEvidenceActions");
      const res = await loadObjectiveEvidenceAction(RUN);
      expect(res).toEqual({ ok: false, error: expect.stringContaining(error) });
      expect(db.log.some((l) => l.sql === "rollback")).toBe(true);
      expect(db.releases).toBe(db.connections);
    });
  }

  it("a missing run is an error, not an empty current-objective list", async () => {
    world({ runs: [] });
    const { loadObjectiveEvidenceAction } = await import("../objectiveEvidenceActions");
    expect(await loadObjectiveEvidenceAction(RUN)).toEqual({ ok: false, error: "Project not found" });
  });
});

describe("Rule B snapshot: the added reads share the REPEATABLE READ client and snapshot (actual action -> wrapper)", () => {
  it("candidate deletion/acceptance, run-text change and new evidence committed between reads cannot mix versions", async () => {
    world({
      runs: [{ id: RUN, tenant_id: TENANT, research_objective: null, decision_statement: null }],
      objective_candidates: [cand("cand-A", "Grow digital adoption")],
      evidence: [ev("ev-a", "objective", 0, "cand-A", "Grow digital adoption", { origin_candidate_id: "cand-A", origin_recorded: true })],
    });
    // Fires right after this transaction's coverage read: another session commits changes.
    db.afterRead(/from objective_evidence_generations/, (live) => {
      live.objective_candidates = [cand("cand-NEW", "Brand new objective")];
      live.runs = [{ id: RUN, tenant_id: TENANT, research_objective: "1. Changed text", decision_statement: null }];
      live.evidence = live.evidence.map((e) => ({ ...e, objective_candidate_id: null }));
      live.evidence.push(ev("ev-new", "objective", 0, "cand-NEW", "Brand new objective", { origin_candidate_id: "cand-NEW", origin_recorded: true }));
    });
    const { loadObjectiveEvidenceAction } = await import("../objectiveEvidenceActions");
    const res = await loadObjectiveEvidenceAction(RUN);
    if (!res.ok) throw new Error(res.error);
    // Entirely the pre-commit version: cand-A current and linked, no new evidence.
    expect(res.items.map((i) => [i.key, i.orphaned])).toEqual([["id:cand-A", false]]);
    expect(res.variablesTruncated).toBe(false);
    // One client: isolation established first, every read on it, then commit and release.
    expect(db.connections).toBe(1);
    expect(db.log[0].sql).toMatch(/^begin isolation level repeatable read/);
    expect(new Set(db.log.map((l) => l.conn))).toEqual(new Set([1]));
    const reads = db.log.map((l) => l.sql);
    expect(reads.findIndex((x) => x.startsWith("select variables_truncated"))).toBeLessThan(reads.findIndex((x) => x.startsWith("select research_objective")));
    expect(reads.findIndex((x) => x.startsWith("select research_objective"))).toBeLessThan(reads.findIndex((x) => x.includes("from objective_evidence where run_id = $1 order by")));
    expect(reads.at(-1)).toBe("commit");
    expect(db.releases).toBe(1);
  });

  it("a failed added read rolls back and releases the one client", async () => {
    world({ objective_candidates: [cand("cand-A", "Grow digital adoption")] });
    db.failOn(/from decision_candidates where run_id/, "permission denied for table decision_candidates");
    const { loadObjectiveEvidenceAction } = await import("../objectiveEvidenceActions");
    const res = await loadObjectiveEvidenceAction(RUN);
    expect(res.ok).toBe(false);
    expect(db.connections).toBe(1);
    expect(db.log.at(-1)!.sql).toBe("rollback");
    expect(db.releases).toBe(1);
  });

  it("coverage keeps null versus false: a failed coverage read is null (savepoint rolled back); a recorded false stays false", async () => {
    world({ generations: [] });
    db.failOn(/from objective_evidence_generations/, "permission denied for table objective_evidence_generations");
    const { loadObjectiveEvidenceAction } = await import("../objectiveEvidenceActions");
    const failed = await loadObjectiveEvidenceAction(RUN);
    if (!failed.ok) throw new Error(failed.error);
    expect(failed.variablesTruncated).toBeNull();
    expect(db.log.some((l) => l.sql === "rollback to savepoint objective_evidence_coverage_read")).toBe(true);
    vi.resetModules();
    world();
    const { loadObjectiveEvidenceAction: again } = await import("../objectiveEvidenceActions");
    const ok = await again(RUN);
    if (!ok.ok) throw new Error(ok.error);
    expect(ok.variablesTruncated).toBe(false);
  });
});
