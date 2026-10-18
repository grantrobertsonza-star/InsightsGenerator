// Permanent regression test for the overnight queue's package 4 fix: "preserve per-wave
// missing-design, ambiguity and interval metadata." runWaveNpsAction (waveTrackingActions.ts)
// previously flattened each wave's full NpsResult into an NpsSegment that carried designBased/
// designExact/scale but silently dropped casesMissingDesign, designAmbiguous and intervalMethod -
// even though each wave is its own file and can genuinely have a different missing-design count
// or a different ambiguous-candidate set than the next wave. This exercises the actual
// runWaveNpsAction entry point, mocking only its one real dependency (runNpsAction), not a
// reimplementation of the segment-flattening logic.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: vi.fn() } } }));
vi.mock("../npsActions", () => ({ runNpsAction: vi.fn() }));

import { runWaveNpsAction, type WaveFile } from "../waveTrackingActions";
import { runNpsAction } from "../npsActions";
import type { NpsResult } from "../npsActions";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

function baseResult(overrides: Partial<NpsResult>): NpsResult {
  return {
    variable: "nps",
    label: "Likelihood to recommend",
    n: 100,
    rawN: 100,
    weightedBase: 100,
    effectiveN: 100,
    weighted: false,
    weightVariable: null,
    nps: 20,
    lo: 10,
    hi: 30,
    promoters: 40,
    passives: 40,
    detractors: 20,
    scale: [],
    designBased: false,
    designExact: false,
    groupVariable: null,
    groupLabel: null,
    segments: null,
    casesMissingDesign: null,
    designAmbiguous: null,
    intervalMethod: null,
    ...overrides,
  };
}

describe("runWaveNpsAction preserves per-wave design metadata (overnight queue, package 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("each wave's own casesMissingDesign, designAmbiguous and intervalMethod reach its segment, not just the latest wave's", async () => {
    const wave1 = baseResult({
      nps: 10,
      casesMissingDesign: 5,
      designAmbiguous: null,
      intervalMethod: "srs",
    });
    const wave2 = baseResult({
      nps: 20,
      casesMissingDesign: null,
      designAmbiguous: { psu: ["PSU_A", "PSU_B"], strata: [] },
      intervalMethod: null,
    });
    const wave3 = baseResult({
      nps: 30,
      casesMissingDesign: 0,
      designAmbiguous: null,
      intervalMethod: "design_based_contrast_se",
      designBased: true,
      designExact: true,
    });

    vi.mocked(runNpsAction)
      .mockResolvedValueOnce({ ok: true, result: wave1 })
      .mockResolvedValueOnce({ ok: true, result: wave2 })
      .mockResolvedValueOnce({ ok: true, result: wave3 });

    const files: WaveFile[] = [
      { documentId: "doc-1", filename: "w1.csv", wave: "Wave 1", uploadedAt: "2026-01-01" },
      { documentId: "doc-2", filename: "w2.csv", wave: "Wave 2", uploadedAt: "2026-02-01" },
      { documentId: "doc-3", filename: "w3.csv", wave: "Wave 3", uploadedAt: "2026-03-01" },
    ];

    const r = await runWaveNpsAction("run-1", files, "nps", null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const segs = r.result.segments!;
    expect(segs).toHaveLength(3);

    // Before the fix: NpsSegment had no casesMissingDesign/designAmbiguous/intervalMethod
    // fields at all, so none of the three waves' values below survived into the segment.
    expect(segs[0].casesMissingDesign).toBe(5);
    expect(segs[0].designAmbiguous).toBeNull();
    expect(segs[0].intervalMethod).toBe("srs");

    expect(segs[1].casesMissingDesign).toBeNull();
    expect(segs[1].designAmbiguous).toEqual({ psu: ["PSU_A", "PSU_B"], strata: [] });
    expect(segs[1].intervalMethod).toBeNull();

    expect(segs[2].casesMissingDesign).toBe(0);
    expect(segs[2].designAmbiguous).toBeNull();
    expect(segs[2].intervalMethod).toBe("design_based_contrast_se");
    expect(segs[2].designBased).toBe(true);
    expect(segs[2].designExact).toBe(true);
  });
});
