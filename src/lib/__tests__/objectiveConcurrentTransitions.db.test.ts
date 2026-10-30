// Codex OBJ500-F01 (2026-10-24): two researchers (or two pages) unaccepting, rejecting or deleting
// different objectives at the same moment each succeeded, but runs.research_objective kept one of
// them as accepted context (and the Word export with it); concurrent deletes could leave a deleted
// objective in the stated list. The same unlocked pattern was in the decision actions. Every
// candidate change now locks the owned run row first (runSync.lockRunForContextChange).
//
// Real disposable PostgreSQL and the actual actions; model refreshes are controlled. A separate
// connection holds the run row, both actions are started and seen waiting on a lock, then the hold
// is released: that makes the interleaving Codex found happen every time, without changing any
// application query, isolation level or status.
//   - concurrent unaccepts, rejects and deletes of two objectives: candidates, accepted statement
//     and stated list agree afterwards; a sequential control gives the same result
//   - a mixed unaccept and delete
//   - concurrent decision unaccepts: the decision statement agrees
//   - another tenant's run is refused with nothing changed
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

// Each case holds a lock and waits for two transactions; the first also loads the action modules.
vi.setConfig({ testTimeout: 30_000 });
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../insightGenerator", () => ({ refreshInsights: vi.fn(async () => {}) }));
vi.mock("../recommendationAgent", () => ({ refreshRecommendations: vi.fn(async () => {}) }));
vi.mock("../objectiveQualityScorer", () => ({ refreshObjectiveQuality: vi.fn(async () => {}) }));
vi.mock("../objectiveValidator", () => ({ refreshObjectiveValidationQuietly: vi.fn(async () => {}) }));
vi.mock("../anthropic", () => ({ anthropic: { messages: { create: vi.fn() } }, CLAUDE_MODEL: "controlled" }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../extractFindings", () => ({ readContextDocument: vi.fn() }));

describe.skipIf(!TEST_DATABASE_URL)("OBJ500-F01 concurrent objective and decision transitions (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const otherTenant = randomUUID();

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic concurrency'),($2,'Other organisation')", [tenant, otherTenant]);
    // Loaded and connected before any case holds a lock, so a case waits only for the operations.
    await import("../objectiveCandidateActions");
    await import("../decisionCandidateActions");
    await (await import("../db")).pool.query("select 1");
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  /** A run with two accepted researcher objectives A and B, both in the stated list. */
  async function runWithTwo(tenantId = tenant) {
    const run = (
      await db.pool.query(
        "insert into runs(tenant_id,project_name,initial_research_objective,stated_objectives_text,objective_candidates_seeded) values($1,'P','Brief','Objective A\nObjective B',true) returning id",
        [tenantId],
      )
    ).rows[0].id as string;
    const ids: string[] = [];
    for (const text of ["Objective A", "Objective B"]) {
      ids.push(
        (
          await db.pool.query(
            "insert into objective_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,$3,'Seeded','researcher_authored','accepted') returning id",
            [tenantId, run, text],
          )
        ).rows[0].id,
      );
    }
    await db.pool.query("update runs set research_objective = '1. Objective A\n2. Objective B' where id = $1", [run]);
    return { run, a: ids[0], b: ids[1] };
  }

  /** Holds the run row, starts both operations, waits until both are blocked on a lock, then releases. */
  async function interleaved(run: string, ops: (() => Promise<unknown>)[]) {
    const holder = new Client({ connectionString: db.url });
    await holder.connect();
    try {
      await holder.query("begin");
      await holder.query("select id from runs where id = $1 for update", [run]);
      const started = ops.map((op) => op());
      const deadline = Date.now() + 15_000;
      // Polled from another connection: inside the holder's transaction, pg_stat_activity keeps the
      // snapshot it first read, so it would never see the operations arrive.
      for (;;) {
        const waiting = (
          await db.pool.query("select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'")
        ).rows[0].n as number;
        if (waiting >= ops.length) break;
        if (Date.now() > deadline) throw new Error(`only ${waiting} of ${ops.length} operations reached a lock`);
        await new Promise((r) => setTimeout(r, 25));
      }
      await holder.query("commit");
      return await Promise.allSettled(started);
    } finally {
      await holder.end();
    }
  }

  const stateOf = async (run: string) => {
    const r = (await db.pool.query("select research_objective, stated_objectives_text, decision_statement from runs where id = $1", [run])).rows[0];
    const candidates = (await db.pool.query("select candidate_text, status from objective_candidates where run_id = $1 order by candidate_text", [run])).rows;
    return { ...r, candidates };
  };

  it("two concurrent unaccepts: both pending and no objective left as accepted context", async () => {
    const a = await import("../objectiveCandidateActions");
    const { run, a: idA, b: idB } = await runWithTwo();
    const results = await interleaved(run, [() => a.unacceptObjectiveCandidate(run, idA), () => a.unacceptObjectiveCandidate(run, idB)]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const s = await stateOf(run);
    expect(s.candidates.map((c: { status: string }) => c.status)).toEqual(["pending", "pending"]);
    expect(s.research_objective).toBeNull();
    // Sequential control: the same two unaccepts one after the other.
    const seq = await runWithTwo();
    await a.unacceptObjectiveCandidate(seq.run, seq.a);
    await a.unacceptObjectiveCandidate(seq.run, seq.b);
    expect((await stateOf(seq.run)).research_objective).toBeNull();
  });

  it("two concurrent rejects: both rejected and no rejected objective in the accepted statement", async () => {
    const a = await import("../objectiveCandidateActions");
    const { run, a: idA, b: idB } = await runWithTwo();
    await interleaved(run, [() => a.rejectObjectiveCandidate(run, idA), () => a.rejectObjectiveCandidate(run, idB)]);
    const s = await stateOf(run);
    expect(s.candidates.map((c: { status: string }) => c.status)).toEqual(["rejected", "rejected"]);
    expect(s.research_objective).toBeNull();
  });

  it("two concurrent deletes: both gone from candidates, the accepted statement and the stated list", async () => {
    const a = await import("../objectiveCandidateActions");
    const { run, a: idA, b: idB } = await runWithTwo();
    await interleaved(run, [() => a.deleteObjectiveCandidate(run, idA), () => a.deleteObjectiveCandidate(run, idB)]);
    const s = await stateOf(run);
    expect(s.candidates).toEqual([]);
    expect(s.research_objective).toBeNull();
    expect(s.stated_objectives_text).toBeNull();
    // The immutable brief is untouched.
    expect((await db.pool.query("select initial_research_objective from runs where id = $1", [run])).rows[0].initial_research_objective).toBe("Brief");
  });

  it("an unaccept and a delete at once: the kept objective is pending and stays in the stated list, the deleted one is gone", async () => {
    const a = await import("../objectiveCandidateActions");
    const { run, a: idA, b: idB } = await runWithTwo();
    await interleaved(run, [() => a.unacceptObjectiveCandidate(run, idA), () => a.deleteObjectiveCandidate(run, idB)]);
    const s = await stateOf(run);
    expect(s.candidates).toEqual([{ candidate_text: "Objective A", status: "pending" }]);
    expect(s.research_objective).toBeNull();
    expect(s.stated_objectives_text).toBe("Objective A");
  });

  it("two concurrent decision unaccepts: no decision left as accepted context", async () => {
    const d = await import("../decisionCandidateActions");
    const run = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'D') returning id", [tenant])).rows[0].id as string;
    const ids: string[] = [];
    for (const text of ["Decision A", "Decision B"]) {
      ids.push((await db.pool.query("insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,$3,'Seeded','researcher_authored','accepted') returning id", [tenant, run, text])).rows[0].id);
    }
    await db.pool.query("update runs set decision_statement = '1. Decision A\n2. Decision B' where id = $1", [run]);
    await interleaved(run, [() => d.unacceptDecisionCandidate(run, ids[0]), () => d.unacceptDecisionCandidate(run, ids[1])]);
    expect((await stateOf(run)).decision_statement).toBeNull();
    expect((await db.pool.query("select status from decision_candidates where run_id = $1", [run])).rows.map((r) => r.status)).toEqual(["pending", "pending"]);
  });

  it("another organisation's run is refused and nothing changes", async () => {
    const a = await import("../objectiveCandidateActions");
    const d = await import("../decisionCandidateActions");
    const { run, a: idA } = await runWithTwo(otherTenant);
    const before = await stateOf(run);
    await expect(a.unacceptObjectiveCandidate(run, idA)).rejects.toThrow(/not available/);
    await expect(a.deleteObjectiveCandidate(run, idA)).rejects.toThrow(/not available/);
    await expect(d.rejectDecisionCandidate(run, idA)).rejects.toThrow(/not available/);
    expect(await stateOf(run)).toEqual(before);
  });
});
