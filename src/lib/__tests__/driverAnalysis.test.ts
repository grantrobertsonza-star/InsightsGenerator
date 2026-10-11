import { describe, expect, it } from "vitest";
import { driverAnalysis, relativeWeights, shapleyR2, topBox } from "../driverAnalysis";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulate(n: number) {
  const r = rng(7);
  const norm = () => {
    let u = 0;
    for (let i = 0; i < 12; i++) u += r();
    return u - 6;
  };
  const x: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = norm();
    const x1 = f + 0.4 * norm();
    const x2 = f + 0.4 * norm();
    const x3 = norm();
    const x4 = norm();
    x.push([x1, x2, x3, x4]);
    y.push(0.5 * x1 + 0.3 * x2 + 0.6 * x3 + norm());
  }
  return { x, y };
}

describe("driverAnalysis, continuous outcome", () => {
  const { x, y } = simulate(600);
  const names = ["x1", "x2", "x3", "x4"];
  const res = driverAnalysis({ y, x, names, outcome: "continuous", bootstrap: 60 });

  it("returns shares that add to 1 and ranks the noise predictor last", () => {
    if ("error" in res) throw new Error(res.error);
    expect(res.rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1, 6);
    expect(res.rows[res.rows.length - 1].name).toBe("x4");
    expect(res.rows[res.rows.length - 1].share).toBeLessThan(0.02);
    expect(res.method).toBe("shapley");
  });

  it("warns that two near-duplicate predictors are hard to separate", () => {
    if ("error" in res) throw new Error(res.error);
    expect(res.warnings.join(" ")).toMatch(/x1 and x2 correlate/);
  });

  it("gives intervals for shares and ranks, and repeats exactly with the same seed", () => {
    if ("error" in res) throw new Error(res.error);
    const again = driverAnalysis({ y, x, names, outcome: "continuous", bootstrap: 60 });
    if ("error" in again) throw new Error(again.error);
    expect(res.rows[0].shareLow).not.toBeNull();
    expect(again.rows.map((r) => r.shareLow)).toEqual(res.rows.map((r) => r.shareLow));
  });

  it("splits R-squared fully in both methods", () => {
    const n = x.length;
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const col = (j: number) => x.map((r) => r[j]);
    const corr = (a: number[], b: number[]) => {
      const ma = mean(a);
      const mb = mean(b);
      let sab = 0;
      let saa = 0;
      let sbb = 0;
      for (let i = 0; i < n; i++) {
        sab += (a[i] - ma) * (b[i] - mb);
        saa += (a[i] - ma) ** 2;
        sbb += (b[i] - mb) ** 2;
      }
      return sab / Math.sqrt(saa * sbb);
    };
    const rxx = [0, 1, 2, 3].map((a) => [0, 1, 2, 3].map((b) => corr(col(a), col(b))));
    const rxy = [0, 1, 2, 3].map((a) => corr(col(a), y));
    if ("error" in res) throw new Error(res.error);
    const sh = shapleyR2(rxx, rxy).reduce((a, b) => a + b, 0);
    const rw = relativeWeights(rxx, rxy).reduce((a, b) => a + b, 0);
    expect(sh).toBeCloseTo(res.fit.rSquared, 4);
    expect(rw).toBeCloseTo(res.fit.rSquared, 4);
  });

  it("uses relative weights when there are too many predictors to enumerate", () => {
    const wide = x.map((row) => [...row, ...Array.from({ length: 10 }, (_, k) => Math.sin(row[0] * (k + 1)) + row[2] * 0.1)]);
    const r = driverAnalysis({ y, x: wide, names: Array.from({ length: 14 }, (_, i) => `v${i}`), outcome: "continuous", bootstrap: 0 });
    if ("error" in r) throw new Error(r.error);
    expect(r.method).toBe("relative_weights");
    expect(r.rows.reduce((a, q) => a + q.share, 0)).toBeCloseTo(1, 6);
  });
});

describe("driverAnalysis, binary outcome", () => {
  const { x, y } = simulate(600);
  it("fits a logistic model and reports fit beside the base rate", () => {
    const yb = y.map((v) => (v > 0.2 ? 1 : 0));
    const r = driverAnalysis({ y: yb, x, names: ["x1", "x2", "x3", "x4"], outcome: "binary", bootstrap: 0 });
    if ("error" in r) throw new Error(r.error);
    expect(r.fit.mcFadden).toBeGreaterThan(0.2);
    expect(r.fit.classificationRate as number).toBeGreaterThan(r.fit.baseRate as number);
    expect(r.rows[r.rows.length - 1].name).toBe("x4");
    expect(r.rows.reduce((a, q) => a + q.share, 0)).toBeCloseTo(1, 6);
  });

  it("refuses an outcome that never varies", () => {
    const r = driverAnalysis({ y: y.map(() => 1), x, names: ["a", "b", "c", "d"], outcome: "binary" });
    expect("error" in r).toBe(true);
  });
});

describe("input handling", () => {
  it("drops predictors with no variation and cases with missing values", () => {
    const { x, y } = simulate(100);
    const xs = x.map((r) => [...r, 5]);
    xs[3][0] = NaN;
    const r = driverAnalysis({ y, x: xs, names: ["x1", "x2", "x3", "x4", "flat"], outcome: "continuous", bootstrap: 0 });
    if ("error" in r) throw new Error(r.error);
    expect(r.droppedPredictors).toEqual(["flat"]);
    expect(r.n).toBe(99);
  });

  it("reports too few cases", () => {
    const r = driverAnalysis({ y: [1, 2, 3], x: [[1, 2], [2, 3], [3, 5]], names: ["a", "b"], outcome: "continuous" });
    expect("error" in r).toBe(true);
  });

  it("builds a top-box outcome and keeps missing as missing", () => {
    const out = topBox([5, 4, null, 3], 4);
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(1);
    expect(Number.isNaN(out[2])).toBe(true);
    expect(out[3]).toBe(0);
  });
});
