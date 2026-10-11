import { describe, it, expect } from "vitest";
import { compareGroupMeans, pearsonCorrelation, studentTTwoSidedP } from "../stats";

// Reference values from scipy.stats (t.sf, ttest_ind with equal_var=False, pearsonr).
describe("studentTTwoSidedP", () => {
  it("matches known two-sided tail probabilities", () => {
    expect(Math.abs(studentTTwoSidedP(2.228, 10) - 0.05001)).toBeLessThan(0.0005);
    expect(Math.abs(studentTTwoSidedP(2.0, 8) - 0.08052)).toBeLessThan(0.0005);
    expect(Math.abs(studentTTwoSidedP(1.96, 100000) - 0.05)).toBeLessThan(0.0005);
  });
});

describe("compareGroupMeans", () => {
  it("does not call a small-group gap significant on a normal curve", () => {
    const r = compareGroupMeans([1, 2, 3, 4, 5], [3, 4, 5, 6, 7.5]);
    // |t| is about 1.99, just over the normal cut-off of 1.96, but p is about 0.082 on 7.9 df.
    expect(r.significant).toBe(false);
    expect(Math.abs((r.pValue ?? 0) - 0.0817)).toBeLessThan(0.002);
    expect(Math.abs((r.df ?? 0) - 7.9)).toBeLessThan(0.1);
  });
  it("still finds a clear difference", () => {
    const r = compareGroupMeans([10, 11, 12, 13, 14, 12, 11], [20, 21, 19, 22, 20, 21, 23]);
    expect(r.significant).toBe(true);
  });
});

describe("pearsonCorrelation", () => {
  it("returns the p value of r against zero", () => {
    const r = pearsonCorrelation([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [2, 1, 4, 3, 7, 5, 9, 6, 10, 8]);
    expect(r.r).toBe(0.87);
    expect(Math.abs((r.pValue ?? 1) - 0.0012)).toBeLessThan(0.0003);
  });
  it("a strong r on only five pairs is not distinguishable from zero", () => {
    const r = pearsonCorrelation([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]);
    expect((r.pValue ?? 0) > 0.05).toBe(true);
  });
});
