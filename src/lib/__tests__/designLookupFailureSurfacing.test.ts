// Permanent regression tests for the Codex re-review's package 4/37 repair:
// - item 1 (ANA-NPS-003, original pass): "calculation callers must distinguish unavailable
//   saved configuration from genuinely absent configuration... surface an actionable failure
//   and avoid saving an apparently valid result" - the document's persisted DESIGN setting.
// - item 2 (ANA-NPS-003, Brief 37 repair): "dictionary/build paths used by NPS, Objectives and
//   charts still call loadDataSetup(), which substitutes defaults on failure... overriding
//   design alone must not authorize defaulting unrelated inputs" - the document's persisted
//   LAYOUT setting, read as part of building the variable dictionary, is a second, independent
//   required input that an explicit design override does NOT bypass.
// Each test calls the actual exported entry point (runDistributionAction, runNpsAction,
// evaluateEvidenceQuestion), not a reimplementation, with loadDataSetupWithStatus and
// loadVariableDictionaryWithStatus mocked to fail exactly as a permission/connection error would.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../crosstabs", () => ({
  loadVariableDictionaryWithStatus: vi.fn(),
  buildCrosstab: vi.fn(),
  loadCrosstab: vi.fn(),
}));
vi.mock("../dataSetup", () => ({ loadDataSetupWithStatus: vi.fn() }));
vi.mock("../db", () => ({ withTenant: vi.fn(), withTenantRead: vi.fn() }));
vi.mock("../crosstabAsk", () => ({ planCrosstabFromText: vi.fn() }));

import { runDistributionAction } from "../chartActions";
import { runNpsAction } from "../npsActions";
import { evaluateEvidenceQuestion } from "../objectiveEvidence";
import { loadVariableDictionaryWithStatus, buildCrosstab, loadCrosstab } from "../crosstabs";
import { loadDataSetupWithStatus } from "../dataSetup";
import { planCrosstabFromText } from "../crosstabAsk";
import { withTenant } from "../db";
import type { DataSetup } from "../dataSetupShared";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

const FAKE_DICT = {
  variables: [{ name: "q1", label: "Q1", nValid: 100, nDistinct: 5, pctValid: 95, weightLike: false, inSet: null }],
  sets: [],
} as any;

const BASE_SETUP: DataSetup = { unit: "respondents", layout: "rows_are_cases", method: "survey", accepted: false, wave: null, design: null };
const OK_SETUP_STATUS: { ok: true; setup: DataSetup } = { ok: true, setup: BASE_SETUP };
const FAILED_SETUP_STATUS = (error: string): { ok: false; setup: DataSetup; error: string } => ({
  ok: false,
  setup: BASE_SETUP,
  error,
});

describe("calculation callers surface a design-lookup failure instead of silently heuristic-computing (Codex re-review, package 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runDistributionAction (chartActions.ts) fails actionably and never builds a crosstab on design-lookup failure", async () => {
    vi.mocked(loadVariableDictionaryWithStatus).mockResolvedValue({ ok: true, dictionary: FAKE_DICT });
    vi.mocked(loadDataSetupWithStatus).mockResolvedValue(FAILED_SETUP_STATUS("permission denied for table documents"));

    const r = await runDistributionAction("run-1", "doc-1", "q1", undefined, null);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/could not be read/);
    // The critical assertion: no crosstab was silently built from a heuristic-guessed design
    // while the caller believed it had honestly checked for a persisted one.
    expect(buildCrosstab).not.toHaveBeenCalled();
    expect(loadCrosstab).not.toHaveBeenCalled();
  });

  it("runNpsAction (npsActions.ts) fails actionably when it has no explicit design of its own and the design lookup fails", async () => {
    vi.mocked(loadVariableDictionaryWithStatus).mockResolvedValue({ ok: true, dictionary: FAKE_DICT });
    vi.mocked(loadDataSetupWithStatus).mockResolvedValue(FAILED_SETUP_STATUS("connection terminated unexpectedly"));

    // No `design` argument passed (undefined) - this call defers entirely to the persisted
    // setting, so the lookup failure must block it.
    const r = await runNpsAction("run-1", "doc-1", "q1", undefined);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/could not be read/);
    expect(buildCrosstab).not.toHaveBeenCalled();
  });

  it("runNpsAction proceeds normally when the CALLER supplies its own explicit design, even if the persisted DESIGN lookup fails - it would never have been consulted anyway", async () => {
    vi.mocked(loadVariableDictionaryWithStatus).mockResolvedValue({ ok: true, dictionary: FAKE_DICT });
    vi.mocked(loadDataSetupWithStatus).mockResolvedValue(FAILED_SETUP_STATUS("permission denied for table documents"));
    vi.mocked(buildCrosstab).mockResolvedValue({ tableId: "table-1" } as any);
    vi.mocked(loadCrosstab).mockResolvedValue({ result: null } as any);

    // An explicit design (including explicit null) always wins over the persisted setting per
    // effectiveDesignChoice, so a failed lookup of a setting that would never be consulted must
    // not block this call.
    const r = await runNpsAction("run-1", "doc-1", "q1", undefined, null, null);

    expect(buildCrosstab).toHaveBeenCalled();
    // (The call still fails downstream here because loadCrosstab returned no result - that's
    // unrelated to this test's point, which is only that the DESIGN lookup failure alone didn't
    // block it.)
    expect(r.ok).toBe(false);
  });

  it("evaluateEvidenceQuestion (objectiveEvidence.ts) stores an actionable error row, never a silently-computed stance, on design-lookup failure", async () => {
    const storedResults: { params: unknown[] }[] = [];
    const fakeClient = {
      query: async (sql: string, params: unknown[] = []) => {
        const s = sql.toLowerCase().replace(/\s+/g, " ").trim();
        if (s.startsWith("select id, item_kind")) {
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
        // storeResult wraps its insert in a savepoint so the migration-guarded fallback (an
        // older database missing the had_table column) can roll back without aborting the
        // rest of the transaction - see storeResult's own comment. A fake client needs to
        // accept these as no-ops, or the unhandled-query throw below gets mistaken for the
        // "had_table column missing" signal it checks for and masks the real assertion.
        if (s.startsWith("savepoint") || s.startsWith("release savepoint") || s.startsWith("rollback to savepoint")) {
          return { rows: [] };
        }
        if (s.startsWith("insert into objective_evidence_results")) {
          storedResults.push({ params });
          return { rowCount: 1 };
        }
        throw new Error("unhandled mock query: " + sql);
      },
    };
    vi.mocked(withTenant).mockImplementation(async (_tenantId: string, cb: any) => cb(fakeClient));
    vi.mocked(planCrosstabFromText).mockResolvedValue({
      rows: [{ key: "revenue", label: "Revenue", vars: ["revenue"] }],
      columns: [],
      filters: [],
      unclear: [],
    } as any);
    vi.mocked(loadVariableDictionaryWithStatus).mockResolvedValue({ ok: true, dictionary: FAKE_DICT });
    vi.mocked(loadDataSetupWithStatus).mockResolvedValue(FAILED_SETUP_STATUS("permission denied for table documents"));

    const stored = await evaluateEvidenceQuestion("tenant-1", "run-1", { id: "doc-1", name: "Wave 1" }, "ev-1");

    expect(stored).toBe(true); // something WAS durably stored - an error row, not nothing
    expect(buildCrosstab).not.toHaveBeenCalled(); // never silently computed a stance on a guess
    expect(storedResults).toHaveLength(1);
    // params order matches the insert's column list in storeResult: ... stance(7), basis(8),
    // estimate(9), summary(10), error(11) ...
    const params = storedResults[0].params;
    expect(params[6]).toBeNull(); // stance: not silently judged/computed
    expect(params[7]).toBeNull(); // basis
    expect(String(params[10])).toMatch(/could not be read/); // the actionable error message
  });
});

describe("ANA-NPS-003 (Brief 37 repair): a layout/dictionary lookup failure is just as blocking as a design-lookup failure - including when an explicit design override is supplied", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The design lookup itself succeeds in every test below - only the dictionary/layout
    // lookup is made to fail, to isolate that this is a genuinely separate required input.
    vi.mocked(loadDataSetupWithStatus).mockResolvedValue(OK_SETUP_STATUS);
  });

  it("runDistributionAction fails actionably when the dictionary/layout lookup fails", async () => {
    vi.mocked(loadVariableDictionaryWithStatus).mockResolvedValue({ ok: false, error: "permission denied for table documents" });

    const r = await runDistributionAction("run-1", "doc-1", "q1", undefined, null);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/could not be read/);
    expect(buildCrosstab).not.toHaveBeenCalled();
    expect(loadCrosstab).not.toHaveBeenCalled();
  });

  it("runNpsAction with NO explicit design fails actionably when the dictionary/layout lookup fails", async () => {
    vi.mocked(loadVariableDictionaryWithStatus).mockResolvedValue({ ok: false, error: "connection terminated unexpectedly" });

    const r = await runNpsAction("run-1", "doc-1", "q1", undefined);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/could not be read/);
    expect(buildCrosstab).not.toHaveBeenCalled();
  });

  it("runNpsAction with an EXPLICIT design still fails actionably when the dictionary/layout lookup fails - the design override does not authorize defaulting this unrelated input", async () => {
    vi.mocked(loadVariableDictionaryWithStatus).mockResolvedValue({ ok: false, error: "permission denied for table documents" });

    // Explicit design, including explicit null strata - exactly the shape that bypasses the
    // DESIGN lookup entirely. It must NOT also bypass the layout/dictionary lookup.
    const r = await runNpsAction("run-1", "doc-1", "q1", undefined, "psu_var", null);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/could not be read/);
    expect(buildCrosstab).not.toHaveBeenCalled();
  });

  it("runNpsAction with an EXPLICIT no-design choice (design: null) still fails actionably when the dictionary/layout lookup fails", async () => {
    vi.mocked(loadVariableDictionaryWithStatus).mockResolvedValue({ ok: false, error: "permission denied for table documents" });

    // design: null, groupVar: null - an explicit, deliberate "no design this time" choice.
    const r = await runNpsAction("run-1", "doc-1", "q1", undefined, null, null);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/could not be read/);
    expect(buildCrosstab).not.toHaveBeenCalled();
  });

  it("evaluateEvidenceQuestion stores an actionable error row, never a silently-computed stance, when the dictionary/layout lookup fails", async () => {
    const storedResults: { params: unknown[] }[] = [];
    const fakeClient = {
      query: async (sql: string, params: unknown[] = []) => {
        const s = sql.toLowerCase().replace(/\s+/g, " ").trim();
        if (s.startsWith("select id, item_kind")) {
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
          storedResults.push({ params });
          return { rowCount: 1 };
        }
        throw new Error("unhandled mock query: " + sql);
      },
    };
    vi.mocked(withTenant).mockImplementation(async (_tenantId: string, cb: any) => cb(fakeClient));
    vi.mocked(planCrosstabFromText).mockResolvedValue({
      rows: [{ key: "revenue", label: "Revenue", vars: ["revenue"] }],
      columns: [],
      filters: [],
      unclear: [],
    } as any);
    vi.mocked(loadVariableDictionaryWithStatus).mockResolvedValue({ ok: false, error: "permission denied for table documents" });

    const stored = await evaluateEvidenceQuestion("tenant-1", "run-1", { id: "doc-1", name: "Wave 1" }, "ev-1");

    expect(stored).toBe(true);
    expect(buildCrosstab).not.toHaveBeenCalled();
    expect(storedResults).toHaveLength(1);
    const params = storedResults[0].params;
    expect(params[6]).toBeNull();
    expect(params[7]).toBeNull();
    expect(String(params[10])).toMatch(/could not be read/);
  });
});
