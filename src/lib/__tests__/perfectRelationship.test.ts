// EF-FND-F02 (batch 62): the shared Pearson test (stats.ts) on exact and near-exact relationships,
// and its consumers: imported-table discovery (tableComputation.ts) and the unweighted scatter
// finding (scatter.ts). Reference values are independent of the app: an exact affine relationship has
// r = +1 or -1 by definition and, with nonconstant data and n >= 3, the t-test's two-sided p tends to 0;
// the near-perfect control is the textbook pair x = 1..5, y = 2, 4, 5, 4, 5 with r = sqrt(0.6) and
// two-sided p = 0.1240270626575546 (scipy.stats.pearsonr, df = 3).
import { describe, expect, it } from "vitest";
import { pearsonCorrelation } from "../stats";
import { computeTablePatterns } from "../tableComputation";
import { scatterFinding } from "../scatter";

const xs = Array.from({ length: 30 }, (_, i) => i * 0.1 + 0.3);

describe("exact linear relationships", () => {
  it.each([
    ["translation", (x: number) => x + 1e6],
    ["scaling", (x: number) => x * 3.7],
    ["affine", (x: number) => 3 * x + 7],
    ["tiny scale", (x: number) => x * 1e-9 + 1e-9],
  ])("%s: r = 1, p = 0, marked exact", (_name, f) => {
    const r = pearsonCorrelation(xs, xs.map(f));
    expect(r).toMatchObject({ r: 1, pValue: 0, exact: true, n: 30 });
  });

  it("a perfect negative relationship: r = -1, p = 0", () => {
    expect(pearsonCorrelation(xs, xs.map((x) => 5 - 2 * x))).toMatchObject({ r: -1, pValue: 0, exact: true });
  });

  it("values whose floating-point r overshoots 1 are clamped, not dropped", () => {
    // Across many affine series, r computed in floating point lands on, above or just below 1; every
    // one must give a p-value, and r never leaves [-1, 1].
    for (let n = 3; n < 80; n++) {
      const x = Array.from({ length: n }, (_, i) => i + n * 0.37);
      const r = pearsonCorrelation(x, x.map((v) => 3 * v + 7));
      expect(r.r).toBe(1);
      expect(typeof r.pValue).toBe("number");
      expect(r.pValue!).toBeLessThan(1e-4);
    }
  });

  it("three pairs is enough; two is refused", () => {
    expect(pearsonCorrelation([1, 2, 3], [2, 4, 6])).toMatchObject({ r: 1, pValue: 0 });
    expect(() => pearsonCorrelation([1, 2], [2, 4])).toThrow();
  });
});

describe("undefined correlations stay undefined", () => {
  it("a constant variable gives no r and no p-value", () => {
    expect(pearsonCorrelation(xs, xs.map(() => 4))).toEqual({ r: null });
    expect(pearsonCorrelation(xs.map(() => 4), xs)).toEqual({ r: null });
  });
  it("a constant whose floating-point mean is not exact (0.1 repeated) is still constant", () => {
    const tenth = Array.from({ length: 37 }, () => 0.1);
    expect(pearsonCorrelation(tenth, xs.slice(0, 37).concat(xs).slice(0, 37))).toEqual({ r: null });
    expect(pearsonCorrelation(tenth, tenth)).toEqual({ r: null });
  });
});

describe("near-perfect and ordinary controls", () => {
  it("the textbook pair gives r = sqrt(0.6) and p = 0.1240 (scipy reference)", () => {
    const r = pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]);
    expect(r.r).toBe(0.77);
    expect(r.pValue).toBeCloseTo(0.1240270626575546, 4);
    expect(r.exact).toBeUndefined();
  });
  it("a near-perfect relationship keeps its computed, nonzero p-value", () => {
    const y = xs.map((x, i) => 2 * x + (i % 2 === 0 ? 1e-3 : -1e-3));
    const r = pearsonCorrelation(xs, y);
    expect(r.exact).toBeUndefined();
    expect(r.r).toBe(1);
    expect(r.pValue).toBeLessThan(1e-4);
  });
});

describe("consumers", () => {
  it("imported-table discovery reports an exact relationship as one", () => {
    const rows = xs.map((X) => ({ X, Y: 3 * X + 7 }));
    const { patterns } = computeTablePatterns(["X", "Y"], rows);
    const rel = patterns.find((p) => p.patternType === "relationship");
    expect(rel?.statedStats).toMatchObject({ r: 1, pValue: 0, exact: true, variable1: "X", variable2: "Y" });
    expect(rel?.description).toMatch(/exact linear relationship/);
  });
  it("imported-table discovery finds nothing for a constant column and says it examined it", () => {
    const rows = xs.map((X) => ({ X, C: 2 }));
    const { patterns, scan } = computeTablePatterns(["X", "C"], rows);
    expect(patterns.filter((p) => p.patternType === "relationship")).toHaveLength(0);
    expect(scan.examined.map((e) => e.name)).toEqual(["X", "C"]);
    expect(scan.testsRun.relationship).toBe(0);
  });
  it("the unweighted scatter finding states p < 0.001 for an exact relationship; weighted gives none", () => {
    const base = { x: { name: "a", label: "A" }, y: { name: "b", label: "B" }, xs, ys: xs.map((x) => 1 - x), casesInFile: 30 };
    const unweighted = scatterFinding({ ...base, ws: null, weightVar: null })!;
    expect(unweighted.statedStats).toMatchObject({ r: -1, pValue: 0 });
    expect(unweighted.text).toContain("p < 0.001");
    const weighted = scatterFinding({ ...base, ws: xs.map(() => 2), weightVar: "w" })!;
    expect(weighted.statedStats).toMatchObject({ r: -1, pValue: null });
  });
  it("the scatter finding of a constant variable is refused", () => {
    expect(scatterFinding({ x: { name: "a", label: "A" }, y: { name: "b", label: "B" }, xs, ys: xs.map(() => 1), ws: null, weightVar: null, casesInFile: 30 })).toBeNull();
  });
});
