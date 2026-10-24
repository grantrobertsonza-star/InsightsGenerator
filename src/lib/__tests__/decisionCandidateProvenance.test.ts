// Permanent regression test for the overnight queue's package 5 (DEC-001): "preserve human
// edit provenance through edit -> re-accept -> regenerate -> reload. Re-accepting without new
// wording must never make human wording eligible for deletion. Test actual actions and
// regeneration." This exercises the actual acceptDecisionCandidate and generateDecisionCandidates
// entry points against one shared in-memory fake Postgres client, not reimplementations of
// either function's logic. Only the LLM call (anthropic.messages.create) and the two other
// pipeline side effects not under test (refreshInsights, refreshRecommendations and the refresh-owed
// marker) are mocked.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../anthropic", () => ({ anthropic: { messages: { create: vi.fn() } }, CLAUDE_MODEL: "test-model" }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../insightGenerator", () => ({ refreshInsights: vi.fn() }));
vi.mock("../recommendationAgent", () => ({ refreshRecommendations: vi.fn() }));
// The refresh-owed marker and the post-commit refresh are covered by decisionRefreshReconciliation.db.test.ts.
vi.mock("../decisionRefresh", () => ({ markDecisionRefreshPending: vi.fn(), refreshDecisionDependants: vi.fn(async () => null) }));
vi.mock("../db", () => ({ withTenant: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { acceptDecisionCandidate } from "../decisionCandidateActions";
import { generateDecisionCandidates } from "../decisionFramer";
import { anthropic } from "../anthropic";
import { withTenant } from "../db";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

type Row = { id: string; run_id: string; candidate_text: string; status: string; edited: boolean; source: string };

function makeFakeDb(rows: Row[]) {
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      const s = sql.toLowerCase().replace(/\s+/g, " ").trim();

      // The owned-run lock every candidate change takes first (runSync.lockRunForContextChange,
      // Codex OBJ500-F01): the project exists for this tenant.
      if (s.startsWith("select id from runs where id = $1 and tenant_id = $2 for update")) {
        return { rows: [{ id: params[0] }], rowCount: 1 };
      }
      if (s.startsWith("select candidate_text, edited from decision_candidates where id")) {
        const [id, runId] = params as [string, string];
        const r = rows.find((row) => row.id === id && row.run_id === runId);
        return { rows: r ? [{ candidate_text: r.candidate_text, edited: r.edited }] : [] };
      }
      if (s.startsWith("update decision_candidates set status = 'accepted', candidate_text")) {
        const [text, edited, id] = params as [string, boolean, string];
        const r = rows.find((row) => row.id === id);
        if (r) {
          r.candidate_text = text;
          r.edited = edited;
          r.status = "accepted";
        }
        return { rows: [] };
      }
      if (s.startsWith("select candidate_text from decision_candidates where run_id") && s.includes("status = 'accepted'")) {
        const [runId] = params as [string];
        return { rows: rows.filter((r) => r.run_id === runId && r.status === "accepted").map((r) => ({ candidate_text: r.candidate_text })) };
      }
      if (s.startsWith("update runs set decision_statement")) {
        return { rows: [] };
      }
      if (s.startsWith("select business_problem, research_objective, decision_statement, audience, entry_point from runs")) {
        return { rows: [{ business_problem: null, research_objective: null, decision_statement: null, audience: null, entry_point: "validate" }] };
      }
      // The findings read now also returns each finding's latest verification status (golden-thread
      // repair, decisionFramer.ts); the fixture finding is unverified. Provenance logic unaffected.
      if (s.startsWith("select f.finding_text, f.theme, f.origin, v.verdict_tier, v.verification_basis")) {
        return {
          rows: [{ finding_text: "Customers want faster delivery.", theme: "Logistics", origin: "stated", verdict_tier: null, verification_basis: null }],
        };
      }
      if (s.startsWith("update runs set evidence_synthesis")) {
        return { rows: [] };
      }
      if (s === "begin") return { rows: [] };
      if (s === "commit") return { rows: [] };
      if (s === "rollback") return { rows: [] };
      if (s.startsWith("delete from decision_candidates where run_id") && s.includes("edited = false")) {
        const [runId] = params as [string];
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) {
          const r = rows[i];
          if (r.run_id === runId && r.source === "ai_suggested" && r.status !== "rejected" && r.edited === false) {
            rows.splice(i, 1);
          }
        }
        return { rowCount: before - rows.length };
      }
      // Regeneration reads the wording still on the run so a suggestion repeating it is not re-inserted.
      if (s.startsWith("select candidate_text from decision_candidates where run_id = $1") && !s.includes("status")) {
        const [runId] = params as [string];
        return { rows: rows.filter((r) => r.run_id === runId).map((r) => ({ candidate_text: r.candidate_text })) };
      }
      if (s.startsWith("insert into decision_candidates")) {
        const [, runId, candidateText] = params as [string, string, string, string];
        const id = `new-${rows.length + 1}`;
        rows.push({ id, run_id: runId, candidate_text: candidateText, status: "accepted", edited: false, source: "ai_suggested" });
        return { rows: [{ id, candidate_text: candidateText }] };
      }
      throw new Error("unhandled mock query: " + sql);
    },
  };
  vi.mocked(withTenant).mockImplementation(async (_tenantId: string, cb: Parameters<typeof withTenant>[1]) => cb(client as never) as never);
  return { client, rows };
}

function mockLlmCandidates(candidates: { candidate_text: string; rationale: string }[]) {
  vi.mocked(anthropic.messages.create)
    .mockResolvedValueOnce({
      content: [{ type: "tool_use", input: { synthesis: "Customers want faster delivery across the board." } }],
      usage: {},
    } as never)
    .mockResolvedValueOnce({
      content: [{ type: "tool_use", input: { candidates } }],
      usage: {},
      stop_reason: "tool_use",
    } as never);
}

describe("decision-candidate human-edit provenance survives re-accept and regenerate (overnight queue, package 5, DEC-001)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("edit -> re-accept (no new wording) -> regenerate -> reload: the human's edited wording is never deleted", async () => {
    const { rows } = makeFakeDb([
      { id: "cand-1", run_id: "run-1", candidate_text: "Whether to expand warehouse capacity or outsource fulfillment.", status: "pending", edited: false, source: "ai_suggested" },
    ]);

    // 1. Edit: the researcher accepts with new wording.
    await acceptDecisionCandidate("run-1", "cand-1", "Whether to build a second warehouse in-house or outsource fulfillment to a 3PL.");
    expect(rows[0].edited).toBe(true);
    expect(rows[0].candidate_text).toBe("Whether to build a second warehouse in-house or outsource fulfillment to a 3PL.");

    // 2. Re-accept with NO new wording - this is exactly the DEC-001 gap: the old code computed
    // `wasEdited` from this call's own (absent) edit alone and reset `edited` back to false.
    await acceptDecisionCandidate("run-1", "cand-1");
    expect(rows[0].edited).toBe(true); // must still be true
    expect(rows[0].candidate_text).toBe("Whether to build a second warehouse in-house or outsource fulfillment to a 3PL.");

    // 3. Regenerate: decisionFramer.ts's real delete-then-insert sequence runs for real against
    // the same fake client. Before the fix, edited having been reset to false in step 2 would
    // make this real DELETE (edited = false) remove the researcher's own wording right here.
    mockLlmCandidates([
      { candidate_text: "Whether to raise prices or hold steady through the next quarter.", rationale: "Pricing pressure theme." },
    ]);
    await generateDecisionCandidates("tenant-1", "run-1");

    // 4. Reload: the human-edited candidate survives, untouched, alongside the new AI suggestion.
    const reloaded = rows.find((r) => r.id === "cand-1");
    expect(reloaded).toBeDefined();
    expect(reloaded!.candidate_text).toBe("Whether to build a second warehouse in-house or outsource fulfillment to a 3PL.");
    expect(reloaded!.edited).toBe(true);
    expect(rows.some((r) => r.candidate_text === "Whether to raise prices or hold steady through the next quarter.")).toBe(true);
  });

  it("regression: a never-edited AI candidate is still correctly deleted on regenerate", async () => {
    const { rows } = makeFakeDb([
      { id: "cand-untouched", run_id: "run-1", candidate_text: "Whether to launch in a new region or deepen the existing one.", status: "accepted", edited: false, source: "ai_suggested" },
    ]);
    mockLlmCandidates([{ candidate_text: "Whether to rebrand or keep the current identity.", rationale: "Brand theme." }]);
    await generateDecisionCandidates("tenant-1", "run-1");
    expect(rows.find((r) => r.id === "cand-untouched")).toBeUndefined();
    expect(rows.some((r) => r.candidate_text === "Whether to rebrand or keep the current identity.")).toBe(true);
  });

  it("re-accepting with wording that's typed back to match what's already stored still keeps edited true if it was already true", async () => {
    const { rows } = makeFakeDb([
      { id: "cand-1", run_id: "run-1", candidate_text: "Whether to expand or hold.", status: "pending", edited: true, source: "ai_suggested" },
    ]);
    // No edit this call (editedText omitted) on an already-edited candidate.
    await acceptDecisionCandidate("run-1", "cand-1");
    expect(rows[0].edited).toBe(true);
  });
});
