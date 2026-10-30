import { describe, expect, it } from "vitest";
import { capByStride, FINDING_POINTS, jitterOffset, pearsonCorrelation, scatterFinding } from "../scatter";
import { pearsonCorrelation as sharedPearson } from "../stats";

describe("pearsonCorrelation", () => {
  // Hand computed: x = 1..5, y = 2,4,5,4,5. Means 3 and 4; deviations dx = -2,-1,0,1,2 and
  // dy = -2,0,1,0,1; sum dx*dy = 6, sum dx^2 = 10, sum dy^2 = 6, so r = 6 / sqrt(60) = 0.774597.
  const x = [1, 2, 3, 4, 5];
  const y = [2, 4, 5, 4, 5];

  it("matches the hand-computed unweighted value", () => {
    const out = pearsonCorrelation(x, y)!;
    expect(out.n).toBe(5);
    expect(out.r).toBeCloseTo(6 / Math.sqrt(60), 9);
    expect(out.r.toFixed(6)).toBe("0.774597");
  });

  it("weights a case as if it were repeated: weight 2 on (2, 4) equals listing it twice", () => {
    // Hand computed for x = 1,2,2,3,4,5 and y = 2,4,4,5,4,5: means 17/6 and 4; sum dx*dy = 6,
    // sum dx^2 = 65/6, sum dy^2 = 6, so r = 6 / sqrt(65) = 0.744208.
    const out = pearsonCorrelation(x, y, [1, 2, 1, 1, 1])!;
    expect(out.r).toBeCloseTo(6 / Math.sqrt(65), 9);
    expect(out.r.toFixed(6)).toBe("0.744208");
    expect(out.n).toBe(5);
    expect(pearsonCorrelation([1, 2, 2, 3, 4, 5], [2, 4, 4, 5, 4, 5])!.r).toBeCloseTo(out.r, 9);
  });

  it("is unchanged when every weight is multiplied by 10", () => {
    const w = [1, 2, 1, 3, 0.5];
    const a = pearsonCorrelation(x, y, w)!;
    const b = pearsonCorrelation(x, y, w.map((v) => v * 10))!;
    expect(b.r).toBeCloseTo(a.r, 12);
    expect(b.n).toBe(a.n);
  });

  it("leaves out incomplete cases and cases without a usable weight, and counts only those that entered", () => {
    const out = pearsonCorrelation([1, 2, 3, 4, 5, NaN, 7], [2, 4, 5, 4, 5, 3, NaN], [1, 1, 1, 1, 1, 1, 1])!;
    expect(out.n).toBe(5);
    expect(out.r).toBeCloseTo(6 / Math.sqrt(60), 9);
    expect(pearsonCorrelation(x, y, [1, 1, 1, 1, 0])!.n).toBe(4);
  });

  it("is undefined with fewer than three cases or a variable that does not vary", () => {
    expect(pearsonCorrelation([1, 2], [3, 4])).toBeNull();
    expect(pearsonCorrelation([1, 2, 3], [5, 5, 5])).toBeNull();
    expect(pearsonCorrelation([4, 4, 4, 4], [1, 2, 3, 4])).toBeNull();
  });
});

describe("capByStride and jitterOffset", () => {
  it("keeps every item under the cap, and an even, repeatable spread over it", () => {
    expect(capByStride([1, 2, 3], 5)).toEqual([1, 2, 3]);
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(capByStride(items, 5)).toEqual([0, 2, 4, 6, 8]);
    expect(capByStride(items, 5)).toEqual(capByStride(items, 5));
  });
  it("gives the same small offset for the same point every time", () => {
    expect(jitterOffset(3, 0)).toBe(jitterOffset(3, 0));
    for (let i = 0; i < 50; i++) {
      expect(Math.abs(jitterOffset(i, 0))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(jitterOffset(i, 1))).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("the unweighted r agrees with the shared test in stats.ts", () => {
  it("rounds to the same r on the fixture", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 5, 4, 5];
    expect(Math.round(pearsonCorrelation(x, y)!.r * 100) / 100).toBe(sharedPearson(x, y).r);
  });
});

describe("scatterFinding", () => {
  const base = { x: { name: "Q1", label: "Fees" }, y: { name: "Q2", label: "Use" }, casesInFile: 5600 };
  const xs = [1, 2, 3, 4, 5];
  const ys = [2, 4, 5, 4, 5];

  it("states the cases used, r and p, unweighted, and that it is association, not cause", () => {
    const f = scatterFinding({ ...base, xs, ys, ws: null, weightVar: null })!;
    const shared = sharedPearson(xs, ys);
    expect(f.text).toBe(`Across 5 of 5,600 cases (those answering both), Fees and Use have a Pearson correlation of r = ${shared.r} (p = ${shared.pValue}, unweighted). This describes association, not cause.`);
    expect(f.theme).toBe("Fees & Use");
    expect(f.statedStats).toMatchObject({ source: "scatter_tool", variable1: "Q1", variable2: "Q2", r: shared.r, n: 5, pairCount: 5, casesInFile: 5600, weighted: false, weightVar: null, pValue: shared.pValue, caveats: ["descriptive_reading"] });
    expect(f.statedStats.points).toEqual(xs.map((x, i) => ({ x, y: ys[i] })));
  });

  it("gives no p-value for a weighted correlation and says so", () => {
    const f = scatterFinding({ ...base, xs, ys, ws: [1, 2, 1, 1, 1], weightVar: "wt" })!;
    expect(f.statedStats.pValue).toBeNull();
    expect(f.statedStats.r).toBe(Math.round((6 / Math.sqrt(65)) * 100) / 100);
    expect(f.statedStats.caveats).toEqual(["descriptive_reading", "weighted_no_test"]);
    expect(f.text).toContain("weighted by wt; no significance test for a weighted correlation");
    expect(f.text).not.toMatch(/p [=<]/);
  });

  it("keeps at most 300 points, evenly spread, in the {x, y} shape the Findings scatter reads", () => {
    const many = Array.from({ length: 1000 }, (_, i) => i);
    const f = scatterFinding({ ...base, xs: many, ys: many.map((v) => (v * 7) % 13), ws: null, weightVar: null })!;
    const pts = f.statedStats.points as { x: number; y: number }[];
    expect(pts).toHaveLength(FINDING_POINTS);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[1].x).toBe(3);
    expect(f.statedStats.n).toBe(1000);
  });

  it("posts nothing when r is undefined", () => {
    expect(scatterFinding({ ...base, xs: [1, 2, 3], ys: [4, 4, 4], ws: null, weightVar: null })).toBeNull();
    expect(scatterFinding({ ...base, xs: [1, 2], ys: [3, 4], ws: null, weightVar: null })).toBeNull();
  });
});
