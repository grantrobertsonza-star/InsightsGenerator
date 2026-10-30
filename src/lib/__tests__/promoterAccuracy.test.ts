// D2b: the promoter model's classification accuracy beside the majority-class baseline (driverAnalysis, binary
// outcome), checked against an independent reference recorded in fixtures/reference/promoter_accuracy_reference.json:
// statsmodels' weighted logistic regression (scripts/reference/promoter_accuracy_reference.py), not the app's fit.
// 300 weighted cases, three predictors. Also: the coefficients agree, and a model no better than the baseline warns.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { driverAnalysis, logisticFit } from "../driverAnalysis";

const REF = JSON.parse(readFileSync(path.join(process.cwd(), "fixtures/reference/promoter_accuracy_reference.json"), "utf8")) as {
  rows: { x1: number; x2: number; x3: number; y: number; w: number }[];
  accuracy: number;
  baseline: number;
  coef: number[];
};
const x = REF.rows.map((r) => [r.x1, r.x2, r.x3]);
const y = REF.rows.map((r) => r.y);
const w = REF.rows.map((r) => r.w);

describe("promoter model accuracy against the majority baseline (D2b, against statsmodels)", () => {
  it("the weighted fit's coefficients equal the reference", () => {
    const fit = logisticFit(x, y, w)!;
    expect(fit.coef.length + 1).toBe(REF.coef.length);
    fit.coef.forEach((b, j) => expect(b).toBeCloseTo(REF.coef[j + 1], 4));
  });
  it("accuracy and baseline equal the reference", () => {
    const r = driverAnalysis({ outcome: "binary", names: ["x1", "x2", "x3"], x, y, weights: w });
    if ("error" in r) throw new Error(r.error);
    expect(r.fit.classificationRate).toBeCloseTo(REF.accuracy, 6);
    expect(r.fit.baseRate).toBeCloseTo(REF.baseline, 6);
    expect(r.warnings.join(" ")).not.toMatch(/barely better than always guessing/);
  });
  it("a model with predictors unrelated to the outcome warns that it does no better than the baseline", () => {
    const noise = REF.rows.map((_, i) => [(i * 7) % 5, (i * 3) % 4, i % 2]);
    const yy = REF.rows.map((_, i) => (i % 3 === 0 ? 1 : 0));
    const r = driverAnalysis({ outcome: "binary", names: ["a", "b", "c"], x: noise, y: yy });
    if ("error" in r) throw new Error(r.error);
    expect(r.warnings.join(" ")).toMatch(/barely better than always guessing the larger group/);
  });
});
