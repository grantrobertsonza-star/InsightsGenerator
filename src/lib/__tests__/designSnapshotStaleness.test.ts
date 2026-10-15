// Permanent regression test for the Codex re-review's package 4 repair, item 4, and its Brief 37
// follow-up: "downstream staleness is not established... reading current settings for new
// calculations does not demonstrate invalidation or visible staleness in existing findings."
// Brief 37's re-review went further: "a swallowed lookup failure can produce designStale: false
// ... the actual findings loader also returned false for a legacy null snapshot" - a confirmed
// match and an uncheckable state must not collapse into the same value. designFreshnessStatus is
// the exported, pure comparison this repair's findings-level staleness check (src/app/runs/[id]/
// page.tsx's getFindings) and the pre-existing crosstab-listing check (listCrosstabs) now BOTH
// call, so a fix to one can no longer silently miss the other - see resolveDesignPickerState's
// dataSetupShared.ts for the same two-copies-drift pattern applied to the picker-reset bug.
import { describe, expect, it, vi } from "vitest";

// crosstabs.ts pulls in ./db (withTenant/withTenantRead) and ./parseStatsFile (which eagerly
// constructs the real supabaseAdmin client at module load) at its own top level, even though
// designFreshnessStatus itself is a pure function with no I/O. The same mocking pattern
// sheetSelectionConsistency.test.ts already established for this exact problem ("Error:
// supabaseUrl is required" - no vitest.config.ts/env-loading mechanism supplies
// NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SECRET_KEY during a bare `vitest run`) applies here too.
vi.mock("../db", () => ({ withTenant: vi.fn(), withTenantRead: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: vi.fn() } } }));
vi.mock("../parseStatsFile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../parseStatsFile")>();
  return { ...actual, runStatsTool: vi.fn() };
});

import { designFreshnessStatus, type CurrentDesignSnapshotStatus } from "../crosstabs";

const OK = (snapshot: string): CurrentDesignSnapshotStatus => ({ ok: true, snapshot });
const FAILED: CurrentDesignSnapshotStatus = { ok: false, error: "permission denied for table documents" };

describe("designFreshnessStatus (crosstabs.ts) - findings/listings design-freshness comparison", () => {
  it("is unknown (not current, not stale) when no design snapshot was recorded at all - undefined (legacy row)", () => {
    expect(designFreshnessStatus(undefined, OK(JSON.stringify({ psu: "q1", strata: null })))).toBe("unknown");
  });

  it("is unknown when the design snapshot is explicitly null (migration-guarded fallback shape) - Brief 37's exact 'legacy null snapshot returned false' finding", () => {
    expect(designFreshnessStatus(null, OK(JSON.stringify({ psu: "q1", strata: null })))).toBe("unknown");
  });

  it("is unknown when resolving the document's CURRENT design failed, even though a snapshot WAS recorded - Brief 37's 'a swallowed lookup failure can produce designStale: false' finding", () => {
    const recorded = { design: { psu: "q1", strata: null } };
    expect(designFreshnessStatus(recorded, FAILED)).toBe("unknown");
  });

  it("is current when the recorded design matches the current resolution exactly", () => {
    const design = { psu: "q1", strata: null };
    expect(designFreshnessStatus({ design }, OK(JSON.stringify(design)))).toBe("current");
  });

  it("is stale when the document's current design no longer matches what was recorded at build time", () => {
    const recorded = { design: { psu: "q1", strata: null } };
    const current = OK(JSON.stringify({ psu: "q2", strata: "region" }));
    expect(designFreshnessStatus(recorded, current)).toBe("stale");
  });

  it("is stale when the recorded design was null (no design applied then) but a design is now resolved", () => {
    const recorded = { design: null };
    const current = OK(JSON.stringify({ psu: "q1", strata: null }));
    expect(designFreshnessStatus(recorded, current)).toBe("stale");
  });

  it("is current when neither the recorded nor the current resolution ever had a design", () => {
    const recorded = { design: null };
    const current = OK(JSON.stringify(null));
    expect(designFreshnessStatus(recorded, current)).toBe("current");
  });
});
