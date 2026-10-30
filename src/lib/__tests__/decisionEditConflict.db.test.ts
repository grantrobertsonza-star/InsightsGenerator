// Codex DEC500-F01 (2026-10-24): a decision editor opened before another editor's save replaced the
// winner without a conflict, and a save for a decision deleted meanwhile returned success with nothing
// stored, so the panel closed the editor and the draft was lost. acceptDecisionCandidate now takes the
// wording the editor opened with and refuses a changed or missing target under the run lock.
// Real disposable PostgreSQL and the actual action; model refreshes are controlled.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.setConfig({ testTimeout: 30_000 });
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The dependent refresh succeeds (its failure path is decisionRefreshReconciliation.db.test.ts):
// insights return their error or null, recommendations a list of errors; here none.
vi.mock("../insightGenerator", () => ({ refreshInsights: vi.fn(async () => null) }));
vi.mock("../recommendationAgent", () => ({ refreshRecommendations: vi.fn(async () => []) }));
vi.mock("../anthropic", () => ({ anthropic: { messages: { create: vi.fn() } }, CLAUDE_MODEL: "controlled" }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

describe.skipIf(!TEST_DATABASE_URL)("DEC500-F01 a stale or deleted decision editor is refused, never reported saved (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const otherTenant = randomUUID();
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic decisions'),($2,'Other organisation')", [tenant, otherTenant]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  async function runWith(text: string, tenantId = tenant) {
    const run = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'D') returning id", [tenantId])).rows[0].id as string;
    const id = (
      await db.pool.query(
        "insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,$3,'Seeded','ai_suggested','pending') returning id",
        [tenantId, run, text],
      )
    ).rows[0].id as string;
    return { run, id };
  }
  const rows = async (run: string) =>
    (await db.pool.query("select id, candidate_text, status from decision_candidates where run_id = $1 order by created_at, id", [run])).rows;

  it("a stale editor is refused with the current wording; the winner is kept; replacing it deliberately saves", async () => {
    const a = await import("../decisionCandidateActions");
    const { run, id } = await runWith("Launch the scheme");
    // Two editors open on "Launch the scheme"; the first saves.
    expect(await a.acceptDecisionCandidate(run, id, "Launch the scheme in Gauteng", "Launch the scheme")).toEqual({ ok: true, refreshError: null });
    const stale = await a.acceptDecisionCandidate(run, id, "Launch the scheme nationally", "Launch the scheme");
    expect(stale).toMatchObject({ ok: false, conflict: true, currentText: "Launch the scheme in Gauteng" });
    expect((stale as { error: string }).error).toMatch(/changed after you opened it, so your edit was not saved/);
    expect(await rows(run)).toEqual([{ id, candidate_text: "Launch the scheme in Gauteng", status: "accepted" }]);
    expect((await db.pool.query("select decision_statement from runs where id = $1", [run])).rows[0].decision_statement).toBe("Launch the scheme in Gauteng");
    // "Replace with mine": the editor now expects what is stored, and the save goes through.
    expect(await a.acceptDecisionCandidate(run, id, "Launch the scheme nationally", "Launch the scheme in Gauteng")).toEqual({ ok: true, refreshError: null });
    expect((await rows(run))[0].candidate_text).toBe("Launch the scheme nationally");
  });

  it("a decision deleted while its editor was open: refused, nothing stored, for an edit and for a plain accept", async () => {
    const a = await import("../decisionCandidateActions");
    const { run, id } = await runWith("Price the plan");
    await a.deleteDecisionCandidate(run, id);
    const edit = await a.acceptDecisionCandidate(run, id, "Price the plan at R99", "Price the plan");
    expect(edit).toMatchObject({ ok: false, conflict: true, currentText: null });
    expect((edit as { error: string }).error).toMatch(/no longer in the project/);
    expect(await a.acceptDecisionCandidate(run, id)).toMatchObject({ ok: false, conflict: true, currentText: null });
    expect(await rows(run)).toEqual([]);
    expect((await db.pool.query("select decision_statement from runs where id = $1", [run])).rows[0].decision_statement).toBeNull();
  });

  it("deleted and recreated with the same wording: the old editor's save is refused and the new decision is untouched", async () => {
    const a = await import("../decisionCandidateActions");
    const { run, id } = await runWith("Enter the market");
    await a.deleteDecisionCandidate(run, id);
    const fresh = (
      await db.pool.query(
        "insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Enter the market','Seeded','researcher_authored','pending') returning id",
        [tenant, run],
      )
    ).rows[0].id as string;
    expect(await a.acceptDecisionCandidate(run, id, "Enter the market in 2027", "Enter the market")).toMatchObject({ ok: false, conflict: true, currentText: null });
    expect(await rows(run)).toEqual([{ id: fresh, candidate_text: "Enter the market", status: "pending" }]);
  });

  it("controls: a current editor saves; a plain accept with no editor saves; another organisation's run is refused with nothing changed", async () => {
    const a = await import("../decisionCandidateActions");
    const { run, id } = await runWith("  Keep the brand  ");
    // The opened wording is compared trimmed, as the stored wording is.
    expect(await a.acceptDecisionCandidate(run, id, "Keep the brand name", "Keep the brand")).toEqual({ ok: true, refreshError: null });
    const second = await runWith("Cut the price");
    expect(await a.acceptDecisionCandidate(second.run, second.id)).toEqual({ ok: true, refreshError: null });
    expect((await rows(second.run))[0].status).toBe("accepted");
    const foreign = await runWith("Other organisation's decision", otherTenant);
    await expect(a.acceptDecisionCandidate(foreign.run, foreign.id, "Changed", "Other organisation's decision")).rejects.toThrow(/not available/);
    expect(await rows(foreign.run)).toEqual([{ id: foreign.id, candidate_text: "Other organisation's decision", status: "pending" }]);
  });
});
