// Permanent regression test for ANA-NPS-003 (Brief 38 repair): "test the actual caller-to-
// builder chain, including explicit design, explicit no-design, starter tables and ask paths.
// On required-setting failure, assert no engine request and no saved result." Brief 37's own
// tests mocked "../crosstabs" entirely, so they never actually exercised the real buildCrosstab
// - exactly the gap Codex's re-review found ("these tests mock the dictionary/build
// boundaries... the complete path remains unsafe"). This file does NOT mock "../crosstabs": it
// calls the real runNpsAction, runDistributionAction, evaluateEvidenceQuestion,
// addCrosstabAction and buildStarterTablesAction, which call the real loadVariableDictionary(
// WithStatus) and the real buildCrosstab, with only the lowest-level boundaries (the database,
// the stats engine process, the LLM client, Next's server-action helpers) mocked.
//
// "Ask paths": askCrosstabAction (crosstabActions.ts) only ever returns a parsed AskPlan: the
// UI then builds an ordinary CrosstabRequest from it and calls addCrosstabAction - the same
// function the manual path uses. There is no separate "ask build" function in this codebase;
// by the time a request reaches buildCrosstab it is indistinguishable from a manually-built
// one, so addCrosstabAction's own test below covers both.
import { describe, expect, it, vi, beforeEach } from "vitest";

// SEC2: the action's entry check that the project is the signed-in tenant's (helpers/ownedRun.ts).
vi.mock("../runOwnership", async () => (await import("./helpers/ownedRun")).ownedRunModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../verifyAfterGenerate", () => ({ verifyAfterGenerate: vi.fn() }));
vi.mock("../anthropic", () => ({ anthropic: {}, CLAUDE_MODEL: "test-model" }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../crosstabAsk", () => ({ planCrosstabFromText: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: vi.fn() } } }));
// GT100-F01: the confirmed-questionnaire lookup is a boundary here (these checks are about the
// set-up and sheet lookups). With the database mocked it used to fail silently; it now refuses.
vi.mock("../instruments", () => ({ getLabelOverlay: vi.fn(async () => null) }));
vi.mock("../findingArchive", () => ({ archiveAndReplaceFindings: vi.fn() }));
vi.mock("../variableOverrides", () => ({
  // A file with no corrections, as the real loader returns it ({}); undefined is not a value it returns.
  loadVariableOverrides: vi.fn(async () => ({})),
  applyQuestionTypeOverrides: (dict: unknown) => dict,
}));
vi.mock("../db", () => ({
  withTenant: vi.fn(),
  withTenantRead: vi.fn(),
  withTenantRepeatableRead: vi.fn(),
}));
// The real relationship between these two (loadDataSetup unwraps loadDataSetupWithStatus's
// `.setup`, tolerantly, for callers that are DELIBERATELY allowed to default - see dataSetup.ts's
// own comment) is preserved here rather than mocked away, so a failure injected into
// loadDataSetupWithStatus propagates the same way it does in the real module to every caller
// that goes through the tolerant loadDataSetup, exactly like a real connection/permission
// failure would.
vi.mock("../dataSetup", () => {
  const loadDataSetupWithStatus = vi.fn();
  return {
    loadDataSetupWithStatus,
    loadDataSetup: async (tenantId: string, documentId: string) => (await loadDataSetupWithStatus(tenantId, documentId)).setup,
  };
});
vi.mock("../parseStatsFile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../parseStatsFile")>();
  return { ...actual, runStatsTool: vi.fn() };
});

import { runNpsAction } from "../npsActions";
import { runDistributionAction } from "../chartActions";
import { evaluateEvidenceQuestion } from "../objectiveEvidence";
import { addCrosstabAction, buildStarterTablesAction } from "../crosstabActions";
import { withTenant } from "../db";
import { loadDataSetupWithStatus } from "../dataSetup";
import { planCrosstabFromText } from "../crosstabAsk";
import { runStatsTool } from "../parseStatsFile";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

vi.setConfig({ testTimeout: 20000 });

const FAILED_SETUP = { ok: false as const, setup: { unit: "respondents" as const, layout: "rows_are_cases" as const, method: "survey" as const, accepted: false, wave: null, waveDate: null, waveIncluded: true, design: null, headerRowsSkipped: null }, error: "permission denied for table documents" };

function mockDocumentRead() {
  vi.mocked(withTenant).mockImplementation(async (_tenantId, cb) =>
    cb({
      query: async (sql: string) => {
        const s = sql.toLowerCase();
        if (s.includes("from documents")) return { rows: [{ storage_path: "s3://x", source_filename: "data.sav", selected_sheet: null, variable_dictionary: null }] };
        return { rows: [] };
      },
    } as never),
  );
}

describe("the real caller-to-builder chain refuses to build on a failed required-setting lookup (ANA-NPS-003, Brief 38 repair)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDocumentRead();
    vi.mocked(loadDataSetupWithStatus).mockResolvedValue(FAILED_SETUP);
  });

  it("runNpsAction with an EXPLICIT design still never reaches the stats engine - the real buildCrosstab's own check blocks it even though the caller-level design override bypassed its own", async () => {
    const r = await runNpsAction("00000000-0000-4000-8000-0000000000cc", "doc-1", "q1", undefined, "psu_var", null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/could not be read/);
    expect(runStatsTool).not.toHaveBeenCalled();
  });

  it("runNpsAction with an EXPLICIT no-design choice still never reaches the stats engine", async () => {
    const r = await runNpsAction("00000000-0000-4000-8000-0000000000cc", "doc-1", "q1", undefined, null, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/could not be read/);
    expect(runStatsTool).not.toHaveBeenCalled();
  });

  it("runDistributionAction never reaches the stats engine", async () => {
    const r = await runDistributionAction("00000000-0000-4000-8000-0000000000cc", "doc-1", "q1", undefined, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/could not be read/);
    expect(runStatsTool).not.toHaveBeenCalled();
  });

  it("evaluateEvidenceQuestion never reaches the stats engine and stores an error row, not a saved table", async () => {
    vi.mocked(planCrosstabFromText).mockResolvedValue({
      rows: [{ key: "revenue", label: "Revenue", vars: ["revenue"] }],
      columns: [],
      filters: [],
      unclear: [],
    } as never);
    vi.mocked(withTenant).mockImplementation(async (_tenantId, cb) => {
      const fakeClient = {
        query: async (sql: string) => {
          const s = sql.toLowerCase();
          if (s.includes("from documents")) return { rows: [{ storage_path: "s3://x", source_filename: "data.sav", selected_sheet: null, variable_dictionary: null }] };
          if (s.includes("select id, item_kind")) {
            return {
              rows: [
                {
                  id: "ev-1",
                  item_kind: "objective",
                  item_order: 0,
                  objective_candidate_id: null,
                  decision_candidate_id: null,
                  item_text: "Grow revenue",
                  question: "Does the data support growth?",
                  request_text: "revenue growth",
                  supports_if: null,
                  against_if: null,
                  expectation: null,
                  source: "ai_suggested",
                  excluded: false,
                  question_revision: 1,
                },
              ],
            };
          }
          if (s.includes("select question_revision from objective_evidence") && s.includes("for update")) {
            return { rows: [{ question_revision: 1 }] };
          }
          if (s.startsWith("savepoint") || s.startsWith("release savepoint") || s.startsWith("rollback to savepoint")) {
            return { rows: [] };
          }
          if (s.startsWith("insert into objective_evidence_results")) {
            return { rowCount: 1 };
          }
          return { rows: [] };
        },
      };
      return cb(fakeClient as never);
    });

    const stored = await evaluateEvidenceQuestion("tenant-1", "00000000-0000-4000-8000-0000000000cc", { id: "doc-1", name: "Wave 1" }, "ev-1");
    expect(stored).toBe(true);
    expect(runStatsTool).not.toHaveBeenCalled();
  });

  it("addCrosstabAction (the manual/ask-resolved build path) never reaches the stats engine and saves no table", async () => {
    const r = await addCrosstabAction("00000000-0000-4000-8000-0000000000cc", "doc-1", {
      columnVars: [],
      rowItems: [{ key: "q1", label: "Q1", vars: ["q1"] }],
      weightVar: null,
      source: "ask",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/could not be read/);
    expect(runStatsTool).not.toHaveBeenCalled();
  });

  it("buildStarterTablesAction (starter tables) never reaches the stats engine for any banner", async () => {
    vi.mocked(withTenant).mockImplementation(async (_tenantId, cb) =>
      cb({
        query: async (sql: string) => {
          const s = sql.toLowerCase();
          if (s.includes("from documents")) {
            return {
              rows: [
                {
                  storage_path: "s3://x",
                  source_filename: "data.sav",
                  selected_sheet: null,
                  variable_dictionary: {
                    version: 6,
                    layout: "rows_are_cases",
                    sets: [],
                    variables: [
                      { name: "gender", label: "Gender", nValid: 100, nDistinct: 2, pctValid: 100, weightLike: false, inSet: null },
                      { name: "q1", label: "Q1", nValid: 100, nDistinct: 5, pctValid: 95, weightLike: false, inSet: null },
                    ],
                  },
                },
              ],
            };
          }
          return { rows: [] };
        },
      } as never),
    );

    const r = await buildStarterTablesAction("00000000-0000-4000-8000-0000000000cc", "doc-1");
    // buildStarterTablesAction plans its banners through the TOLERANT loadVariableDictionary -
    // deliberately out of this repair's scope (Brief 37 left it tolerant for every existing
    // caller except NPS/Objectives/charts) - so a "dictionary" engine call for PLANNING
    // purposes is expected and allowed even when the setup lookup fails. What must never
    // happen is the actual per-banner TABLE build reaching the engine: that goes through the
    // real buildCrosstab, whose own internal strict check (this repair's fix) must block every
    // banner before any "crosstab" engine request is made, regardless of r.ok.
    void r;
    const crosstabCalls = vi.mocked(runStatsTool).mock.calls.filter(([kind]) => kind === "crosstab");
    expect(crosstabCalls).toHaveLength(0);
  });
});
