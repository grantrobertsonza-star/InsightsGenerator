// Business-decisions remainder (frozen acceptance: "failed refresh/retry visibly reconciles").
// Every decision change commits the status change and the decision statement together, then
// refreshes the insights and recommendations built on them. Before this repair a failed refresh
// was either swallowed (both refresh wrappers log and never throw, so the change looked complete
// while the dependants stayed built on the old decisions) or, when logging failed too, thrown
// after the commit, so the panel said "Not changed" about a saved change. Now, for each transition (accept with an
// edit, reject, restore, unaccept, delete, accept all, add your own):
//   - with the refresh failing, the action reports the change as saved with the refresh's reason,
//     the status and statement are committed (statement = the accepted set), and the run is
//     marked as owed a refresh; nothing changes in another run;
//   - a retry with the refresh working reports no problem and clears the marker.
// Plus the guarantee in decisionRefresh.ts: a change committed while a refresh is running stays
// owed after that refresh succeeds.
// Real disposable PostgreSQL through the app's own db.ts; only the two model-backed refreshes are
// controlled (they fail, succeed, or make a change mid-refresh on demand).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

// fail: the insight refresh reports a failure the way the real wrapper does (logged and
// returned, not thrown); throws: it throws, as when logging the failure itself fails.
const state = vi.hoisted(() => ({ fail: false, throws: false, during: null as null | (() => Promise<void>), insightRuns: 0 }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../insightGenerator", () => ({
  refreshInsights: vi.fn(async () => {
    state.insightRuns += 1;
    if (state.during) { const f = state.during; state.during = null; await f(); }
    if (state.throws) throw new Error("trace unavailable");
    return state.fail ? "refresh unavailable" : null;
  }),
}));
vi.mock("../recommendationAgent", () => ({ refreshRecommendations: vi.fn(async () => (state.fail ? ["model unavailable"] : [])) }));

describe.skipIf(!TEST_DATABASE_URL)("decision changes reconcile after a failed refresh (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string, other: string;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic decision refresh')", [tenant]);
    [run, other] = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'A'),($1,'B') returning id", [tenant])).rows.map((r) => r.id);
    for (const r of [run, other]) {
      await db.pool.query(
        "insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status,created_at) values($1,$2,'Decision one','r','ai_suggested','accepted',now()-interval '3 min'),($1,$2,'Decision two','r','ai_suggested','pending',now()-interval '2 min'),($1,$2,'Decision three','r','ai_suggested','pending',now()-interval '1 min')",
        [tenant, r],
      );
    }
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); });

  const rows = async (r: string) => (await db.pool.query("select id,candidate_text,status from decision_candidates where run_id=$1 order by created_at,id", [r])).rows;
  const statement = async (r: string) => (await db.pool.query("select decision_statement from runs where id=$1", [r])).rows[0].decision_statement as string | null;
  const expectedStatement = (texts: string[]) => (texts.length === 0 ? null : texts.length === 1 ? texts[0] : texts.map((t, i) => `${i + 1}. ${t}`).join("\n"));
  const pending = async () => (await import("../decisionRefresh")).decisionRefreshPending(tenant, run);
  const idOf = async (text: string) => (await rows(run)).find((x) => x.candidate_text === text)!.id as string;

  /** Runs one transition with the refresh failing, checks it saved and is owed, then retries. */
  async function failThenRetry(label: string, change: () => Promise<{ ok: true; refreshError: string | null } | void>, check: () => Promise<void>) {
    const a = await import("../decisionCandidateActions");
    const otherBefore = JSON.stringify(await rows(other));
    state.fail = true;
    const result = await change();
    expect(result, label).toEqual({ ok: true, refreshError: "insights: refresh unavailable; recommendations: model unavailable" });
    await check();
    const accepted = (await rows(run)).filter((x) => x.status === "accepted").map((x) => x.candidate_text);
    expect(await statement(run), `${label}: statement equals the accepted set`).toBe(expectedStatement(accepted));
    expect(await pending(), `${label}: owed a refresh`).toBe(true);
    expect(JSON.stringify(await rows(other)), `${label}: other run untouched`).toBe(otherBefore);
    state.fail = false;
    expect(await a.retryDecisionRefresh(run), `${label}: retry`).toEqual({ ok: true, refreshError: null });
    expect(await pending(), `${label}: reconciled`).toBe(false);
  }

  it("every transition reports a saved change with the refresh reason, stays owed, and a retry reconciles", async () => {
    const a = await import("../decisionCandidateActions");
    const status = async (text: string) => (await rows(run)).find((x) => x.candidate_text === text)?.status;
    await failThenRetry("accept with edit", async () => a.acceptDecisionCandidate(run, await idOf("Decision two"), "Decision two, edited"), async () => {
      expect(await status("Decision two, edited")).toBe("accepted");
    });
    await failThenRetry("reject", async () => a.rejectDecisionCandidate(run, await idOf("Decision one")), async () => {
      expect(await status("Decision one")).toBe("rejected");
    });
    await failThenRetry("restore", async () => a.restoreDecisionCandidate(run, await idOf("Decision one")), async () => {
      expect(await status("Decision one")).toBe("accepted");
    });
    await failThenRetry("unaccept", async () => a.unacceptDecisionCandidate(run, await idOf("Decision one")), async () => {
      expect(await status("Decision one")).toBe("pending");
    });
    await failThenRetry("accept all", async () => a.acceptAllDecisionCandidates(run), async () => {
      expect(await status("Decision one")).toBe("accepted");
      expect(await status("Decision three")).toBe("accepted");
    });
    await failThenRetry("delete", async () => a.deleteDecisionCandidate(run, await idOf("Decision three")), async () => {
      expect(await status("Decision three")).toBeUndefined();
    });
    await failThenRetry("add your own", async () => a.addOwnDecisionCandidate(run, "Researcher decision"), async () => {
      expect(await status("Researcher decision")).toBe("accepted");
    });
  });

  it("a change committed while a refresh runs stays owed after that refresh succeeds", async () => {
    const a = await import("../decisionCandidateActions");
    expect(await pending()).toBe(false);
    state.fail = false;
    // During the refresh triggered by this reject, another change commits (with its own refresh failing).
    state.during = async () => {
      state.fail = true;
      await a.restoreDecisionCandidate(run, await idOf("Decision one"));
      state.fail = false;
    };
    expect(await a.rejectDecisionCandidate(run, await idOf("Decision one"))).toEqual({ ok: true, refreshError: null });
    expect(await pending(), "the mid-refresh change is still owed").toBe(true);
    expect(await a.retryDecisionRefresh(run)).toEqual({ ok: true, refreshError: null });
    expect(await pending()).toBe(false);
  });

  it("a refresh that throws (its failure log failed too) is reported the same way", async () => {
    const a = await import("../decisionCandidateActions");
    state.throws = true;
    try {
      expect(await a.rejectDecisionCandidate(run, await idOf("Decision one"))).toEqual({ ok: true, refreshError: "trace unavailable" });
      expect(await pending()).toBe(true);
    } finally {
      state.throws = false;
    }
    expect(await a.retryDecisionRefresh(run)).toEqual({ ok: true, refreshError: null });
    expect(await pending()).toBe(false);
  });

  it("a change that cannot commit still fails as before and marks nothing", async () => {
    const a = await import("../decisionCandidateActions");
    await db.pool.query("alter table decision_candidates add constraint zz_refuse check (candidate_text <> 'Refused text') not valid");
    try {
      await expect(a.addOwnDecisionCandidate(run, "Refused text")).rejects.toThrow();
      expect(await pending()).toBe(false);
    } finally {
      await db.pool.query("alter table decision_candidates drop constraint zz_refuse");
    }
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("decision changes reconcile after a failed refresh (real database)", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
