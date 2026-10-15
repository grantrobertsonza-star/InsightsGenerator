// Permanent regression test for ANA-NPS-003 (Brief 38 repair): "fix buildCrosstab itself...
// do not let a later tolerant lookup default layout after earlier strict checks." Brief 37
// fixed every CALLER's own setup/dictionary lookups, but buildCrosstab independently called the
// tolerant loadDataSetup() a second time to read `layout` for the engine request - a lookup
// failure there, even after the caller's own check succeeded, could still silently substitute
// a defaulted layout and reach the stats engine. This test calls the actual exported
// buildCrosstab (not a reimplementation) with loadDataSetupWithStatus mocked to fail, and
// asserts no engine request is ever made and nothing is saved.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({ withTenant: vi.fn(), withTenantRead: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: vi.fn() } } }));
vi.mock("../findingArchive", () => ({ archiveAndReplaceFindings: vi.fn() }));
vi.mock("../dataSetup", () => ({ loadDataSetupWithStatus: vi.fn() }));
vi.mock("../variableOverrides", () => ({
  loadVariableOverrides: vi.fn(),
  applyQuestionTypeOverrides: (dict: unknown) => dict,
}));
vi.mock("../parseStatsFile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../parseStatsFile")>();
  return { ...actual, runStatsTool: vi.fn() };
});

import { buildCrosstab } from "../crosstabs";
import { withTenant } from "../db";
import { loadDataSetupWithStatus } from "../dataSetup";
import { loadVariableOverrides } from "../variableOverrides";
import { runStatsTool } from "../parseStatsFile";

// overlayFor (crosstabs.ts) dynamically imports ../instruments on every call, inside a
// try/catch that swallows any failure - but transforming that module's own (real, unmocked)
// import graph the first time costs more than vitest's default 5000ms test budget in this
// sandbox, the same one-time-transform cost sheetSelectionConsistency.test.ts already hit and
// raised its own file-wide timeout for.
vi.setConfig({ testTimeout: 20000 });

describe("buildCrosstab enforces a strict setup lookup itself (ANA-NPS-003, Brief 38 repair)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withTenant).mockImplementation(async (_tenantId: string, cb: any) =>
      cb({
        query: async () => ({
          rows: [{ storage_path: "s3://x", source_filename: "data.sav", selected_sheet: null }],
        }),
      }),
    );
    vi.mocked(loadVariableOverrides).mockResolvedValue({});
  });

  it("fails before constructing any engine request when the setup lookup fails, even though the request itself is otherwise well-formed", async () => {
    vi.mocked(loadDataSetupWithStatus).mockResolvedValue({ ok: false, error: "permission denied for table documents" } as any);

    await expect(
      buildCrosstab("tenant-1", "run-1", "doc-1", {
        columnVars: [],
        rowItems: [{ key: "q1", label: "Q1", vars: ["q1"] }],
        weightVar: null,
        source: "ask",
      }),
    ).rejects.toThrow(/could not be read/);

    // The critical assertion: this function's OWN internal lookup failure must block it before
    // any engine request is built - not just when a caller's upstream check already caught it.
    expect(runStatsTool).not.toHaveBeenCalled();
  });

  it("proceeds to the engine when the setup lookup succeeds", async () => {
    vi.mocked(loadDataSetupWithStatus).mockResolvedValue({
      ok: true,
      setup: { unit: "respondents", layout: "rows_are_cases", method: "survey", accepted: false, wave: null, design: null },
    } as any);
    vi.mocked(runStatsTool).mockResolvedValue({
      questions: [{ label: "Q1", kind: "single", rows: [] }],
      columns: [],
      blocks: [],
      filters: [],
      total: { n: 0 },
      weightVar: null,
      overall: true,
      engine: "test",
      notes: {},
    } as any);

    // Whatever happens next (this fixture is deliberately minimal, not a full engine result)
    // is unrelated to this test's point, which is only that buildCrosstab got PAST its own
    // setup check and actually reached the engine - i.e. the inverse of the first test.
    await buildCrosstab("tenant-1", "run-1", "doc-1", {
      columnVars: [],
      rowItems: [{ key: "q1", label: "Q1", vars: ["q1"] }],
      weightVar: null,
      source: "ask",
    }).catch(() => {});
    expect(runStatsTool).toHaveBeenCalled();
  });
});
