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
// Independent review 2026-10-17 found two gaps, replayed here:
//   - a failure after the commit outside the refreshes (the marker lookup) still threw, so the
//     panel said "Not saved" about a saved change; it is now reported as saved with the reason;
//   - a successful refresh cleared the warning while existing insights (which the refresh never
//     rewrites) still described the earlier decisions; those are now counted and marked, through
//     the panel's count and the insights export, until the decisions match again.
// Real disposable PostgreSQL through the app's own db.ts; only the two model-backed refreshes are
// controlled (they fail, succeed, or make a change mid-refresh on demand).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

// fail: the insight refresh reports a failure the way the real wrapper does (logged and
// returned, not thrown); throws: it throws, as when logging the failure itself fails.
// readFail: the next tenant read fails once (a database outage after the change committed).
const state = vi.hoisted(() => ({ fail: false, throws: false, during: null as null | (() => Promise<void>), insightRuns: 0, readFail: false }));
vi.mock("../db", async (original) => {
  const actual = await original<typeof import("../db")>();
  return { ...actual, withTenantRead: async (...args: Parameters<typeof actual.withTenantRead>) => {
    if (state.readFail) { state.readFail = false; throw new Error("Synthetic marker lookup outage"); }
    return actual.withTenantRead(...args);
  } };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The insights export route imports through the app alias, which vitest does not resolve here.
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/decisionContext", async () => await import("../decisionContext"));
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

  it("a failure after the commit outside the refreshes is reported as saved, stays owed, and a retry reconciles", async () => {
    const a = await import("../decisionCandidateActions");
    state.readFail = true;
    expect(await a.addOwnDecisionCandidate(run, "Committed before lookup outage")).toEqual({ ok: true, refreshError: "Synthetic marker lookup outage" });
    expect((await rows(run)).find((x) => x.candidate_text === "Committed before lookup outage")?.status).toBe("accepted");
    expect(await statement(run)).toContain("Committed before lookup outage");
    expect(await pending()).toBe(true);
    // The retry itself meeting the outage is reported the same way, not thrown.
    state.readFail = true;
    expect(await a.retryDecisionRefresh(run)).toEqual({ ok: true, refreshError: "Synthetic marker lookup outage" });
    expect(await pending()).toBe(true);
    // Repeating the same add does not duplicate the researcher's row.
    expect(await a.addOwnDecisionCandidate(run, "Committed before lookup outage")).toEqual({ ok: true, refreshError: null });
    expect((await rows(run)).filter((x) => x.candidate_text === "Committed before lookup outage")).toHaveLength(1);
    expect(await pending()).toBe(false);
  });

  it("existing insights written for earlier decisions stay marked after a successful refresh, with wording untouched", async () => {
    const a = await import("../decisionCandidateActions");
    const { decisionContextMismatch } = await import("../decisionRefresh");
    const XLSX = await import("xlsx");
    const [r3] = (await db.pool.query("insert into runs(tenant_id,project_name,decision_statement) values($1,'C','Decision one') returning id", [tenant])).rows.map((r) => r.id as string);
    await db.pool.query(
      "insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status,created_at) values($1,$2,'Decision one','r','ai_suggested','accepted',now()-interval '2 min'),($1,$2,'Decision two','r','ai_suggested','pending',now()-interval '1 min')",
      [tenant, r3],
    );
    const finding = async (r: string, text: string) => {
      const id = (await db.pool.query("insert into findings(tenant_id,run_id,origin,finding_text,status) values($1,$2,'generated',$3,'accepted') returning id", [tenant, r, text])).rows[0].id as string;
      await db.pool.query("insert into verdicts(tenant_id,finding_id,verdict_tier,rationale,verification_method,corroboration_level) values($1,$2,'robust','Synthetic','single_pass','single_source')", [tenant, id]);
      return id;
    };
    const insight = async (r: string, f: string, context: string | null, headline: string) =>
      (await db.pool.query("insert into insights(tenant_id,run_id,finding_id,decision_context,headline,observation,tension,implication) values($1,$2,$3,$4,$5,'o','t','i') returning id", [tenant, r, f, context, headline])).rows[0].id as string;
    // Written for the current decision; carries a recommendation the researcher reworded.
    const framed = await insight(r3, await finding(r3, "Framed finding"), "Decision one", "Framed headline");
    await db.pool.query(
      "insert into recommendations(tenant_id,run_id,insight_id,action_text,owner_role,owner_feasibility_note,timeline,metric,priority,assumptions_and_risks,alternatives_considered,source,status,edited,decision_context) values($1,$2,$3,'Researcher wording','o','f','t','m','medium','a','b','ai_suggested','accepted',true,'Decision one')",
      [tenant, r3, framed],
    );
    // Control: written before any decision existed (no recorded context), never marked.
    await insight(r3, await finding(r3, "Unframed finding"), null, "Unframed headline");
    await db.pool.query("insert into synthesized_insights(tenant_id,run_id,decision_context,headline,observation,tension,implication) values($1,$2,' Decision one ','Synth','o','t','i')", [tenant, r3]);
    // Control in another run: its own mismatch must not count here.
    await insight(other, await finding(other, "Other finding"), "Some other decision", "Other headline");

    expect(await decisionContextMismatch(tenant, r3), "whitespace alone is not a change").toEqual({ insights: 0, recommendations: 0, recommendationsUnknown: 0 });
    expect(await a.acceptDecisionCandidate(r3, (await rows(r3)).find((x) => x.candidate_text === "Decision two")!.id)).toEqual({ ok: true, refreshError: null });
    expect(await statement(r3)).toBe("1. Decision one\n2. Decision two");
    expect(await (await import("../decisionRefresh")).decisionRefreshPending(tenant, r3), "the refresh succeeded").toBe(false);
    expect(await decisionContextMismatch(tenant, r3), "still described by the earlier decision").toEqual({ insights: 2, recommendations: 1, recommendationsUnknown: 0 });
    const kept = (await db.pool.query("select i.headline, i.decision_context, r.action_text, r.edited from insights i join recommendations r on r.insight_id=i.id where i.id=$1", [framed])).rows[0];
    expect(kept).toEqual({ headline: "Framed headline", decision_context: "Decision one", action_text: "Researcher wording", edited: true });

    // The qualification travels into the insights export (the real route).
    const { GET } = await import("../../app/api/runs/[id]/insights/export/route");
    const response = await GET(new Request("http://local/export"), { params: Promise.resolve({ id: r3 }) });
    const sheet = XLSX.read(new Uint8Array(await response.arrayBuffer()), { type: "array" });
    const exported = XLSX.utils.sheet_to_json<Record<string, string>>(sheet.Sheets[sheet.SheetNames[0]]);
    const served = (headline: string) => exported.find((x) => x.Headline === headline)?.["Decision this serves"] ?? "";
    expect(served("Framed headline")).toMatch(/^Written for earlier decisions \(the accepted decisions have changed since\): Decision one$/);
    expect(served("Unframed headline")).toBe("");

    // Back to the decisions they were written for: nothing is marked any more.
    expect(await a.unacceptDecisionCandidate(r3, (await rows(r3)).find((x) => x.candidate_text === "Decision two")!.id)).toEqual({ ok: true, refreshError: null });
    expect(await statement(r3)).toBe("Decision one");
    expect(await decisionContextMismatch(tenant, r3)).toEqual({ insights: 0, recommendations: 0, recommendationsUnknown: 0 });
    // Unknown stays unknown.
    state.readFail = true;
    expect(await decisionContextMismatch(tenant, r3)).toBeNull();
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
