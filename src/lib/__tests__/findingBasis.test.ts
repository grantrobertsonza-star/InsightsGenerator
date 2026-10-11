import { describe, expect, it } from "vitest";
import { codeVerdict, findingBasis } from "../findingBasis";

const gen = (pattern_type: string, stated_stats: Record<string, unknown>) => ({ origin: "generated", pattern_type, stated_stats });

describe("findingBasis", () => {
  it("treats crosstab and passed scan differences as tested", () => {
    expect(findingBasis(gen("segment_difference", { testType: "column_proportion_vs_rest", pValue: 0.01 }))).toBe("tested_significant");
    expect(findingBasis(gen("segment_difference", { significant: true }))).toBe("tested_significant");
    expect(findingBasis(gen("segment_difference", { significant: false }))).toBe("tested_not_significant");
  });
  it("does not call untested patterns significant", () => {
    expect(findingBasis(gen("relationship", { r: 0.4 }))).toBe("descriptive");
    expect(findingBasis(gen("outlier", { z: 2.5 }))).toBe("heuristic");
    expect(findingBasis(gen("cluster_profile", { kind: "cluster_profile" }))).toBe("descriptive");
  });
  it("reads caveats first", () => {
    expect(findingBasis(gen("banner_comparison", { testType: "x", caveats: ["not_significant"] }))).toBe("tested_not_significant");
    expect(findingBasis(gen("banner_comparison", { testType: "descriptive_summary", caveats: ["insufficient_n_for_test"] }))).toBe("descriptive");
  });
  it("catches 'nothing significant' model and wave findings", () => {
    expect(findingBasis(gen("model_association", { kind: "model_association", termsSignificant: 0 }))).toBe("tested_not_significant");
    expect(findingBasis(gen("model_association", { kind: "model_association", termsSignificant: 3 }))).toBe("reported_statistics");
    expect(findingBasis(gen("trend", { kind: "wave_change_model", changed: 0 }))).toBe("tested_not_significant");
    expect(findingBasis(gen("trend", { kind: "wave_change_model", changed: 2 }))).toBe("tested_significant");
    expect(findingBasis(gen("segment_proportions", { kind: "estimates_with_se", z: 0.8 }))).toBe("tested_not_significant");
    expect(findingBasis(gen("segment_proportions", { kind: "proportion_gap" }))).toBe("reported_statistics");
  });
  it("handles other origins and missing stats", () => {
    expect(findingBasis({ origin: "stated" })).toBe("stated");
    expect(findingBasis({ origin: "coded" })).toBe("coded");
    expect(findingBasis({ origin: "generated", stated_stats: null })).toBe("unknown");
  });
});

describe("codeVerdict", () => {
  it("rates by basis", () => {
    expect(codeVerdict("tested_significant", [], []).tier).toBe("robust");
    expect(codeVerdict("tested_significant", ["small base"], []).tier).toBe("use_with_caution");
    expect(codeVerdict("tested_not_significant", [], []).tier).toBe("not_supported");
    expect(codeVerdict("descriptive", [], []).tier).toBe("use_with_caution");
    expect(codeVerdict("descriptive", [], ["insufficient_n_for_test"]).tier).toBe("not_supported");
    expect(codeVerdict("heuristic", [], []).tier).toBe("use_with_caution");
    expect(codeVerdict("unknown", [], []).tier).toBe("use_with_caution");
  });
  it("never says significant for an untested finding", () => {
    for (const b of ["descriptive", "heuristic", "tested_not_significant", "unknown"] as const) {
      expect(/^statistically significant/.test(codeVerdict(b, [], []).rationale.toLowerCase())).toBe(false);
    }
  });
  it("notes missing multiplicity correction", () => {
    expect(/No correction/.test(codeVerdict("tested_significant", [], ["uncorrected_multiple_comparisons"]).rationale)).toBe(true);
  });

  it("reads wide findings as a reading and a null result, and neither is called significant", () => {
    expect(findingBasis({ origin: "generated", pattern_type: "level", stated_stats: { testType: "nps" } })).toBe("reading");
    expect(findingBasis({ origin: "generated", pattern_type: "no_difference", stated_stats: { caveats: ["not_significant"] } })).toBe("null_result");
    expect(codeVerdict("reading", [], []).tier).toBe("robust");
    expect(codeVerdict("reading", ["small base"], []).tier).toBe("use_with_caution");
    expect(codeVerdict("null_result", [], []).tier).toBe("use_with_caution");
    expect(/significant/i.test(codeVerdict("reading", [], []).rationale)).toBe(false);
  });
});
