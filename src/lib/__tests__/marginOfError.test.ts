// The calculated margin-of-error check (marginOfError.ts) under a proposal's "Sample size and
// precision" rating. Reference values are worked independently of the code:
//   n=1,000, 95%:  1.96 * sqrt(0.25/1000) = 1.96 * 0.015811 = 0.030990 -> ±3.10 points
//   n=400, 95%:    1.96 * sqrt(0.25/400)  = 1.96 * 0.025    = 0.049    -> ±4.90 points
//   n=800, deff 2: same as n=400            -> ±4.90 points
//   n=1,000, 99%:  2.576 * 0.015811 = 0.040730 -> ±4.07;  90%: 1.645 * 0.015811 = 0.026009 -> ±2.60
//   ±3 at 95%:     0.25 * 1.96^2 / 0.03^2 = 0.9604 / 0.0009 = 1067.1 -> n=1,068
import { describe, expect, it } from "vitest";
import { expectedMarginOfError, findPrecisionChecks, precisionCheckText, sampleSizeFor } from "../marginOfError";

describe("margin of error arithmetic", () => {
  it("matches the hand-worked reference values", () => {
    expect(expectedMarginOfError(1000)).toBeCloseTo(3.099, 3);
    expect(expectedMarginOfError(400)).toBeCloseTo(4.9, 6);
    expect(expectedMarginOfError(800, 95, 2)).toBeCloseTo(4.9, 6);
    expect(expectedMarginOfError(1000, 99)).toBeCloseTo(4.073, 3);
    expect(expectedMarginOfError(1000, 90)).toBeCloseTo(2.601, 3);
    expect(sampleSizeFor(3)).toBe(1068);
  });
  it("refuses inputs it cannot compute rather than returning a number", () => {
    expect(() => expectedMarginOfError(0)).toThrow();
    expect(() => expectedMarginOfError(500, 80)).toThrow();
  });
});

describe("finding stated margins in a document", () => {
  const one = (text: string) => {
    const all = findPrecisionChecks(text);
    expect(all).toHaveLength(1);
    return all[0];
  };
  it("a consistent claim, with the level read from the sentence", () => {
    const c = one("A nationally representative sample of 1,000 adults gives a margin of error of ±3.1% at 95% confidence.");
    expect(c).toMatchObject({ kind: "checked", n: 1000, statedMargin: 3.1, confidence: 95, confidenceStated: true, verdict: "consistent" });
  });
  it("a claim of more precision than the sample supports, with the size it would need", () => {
    const c = one("The sample of 500 respondents gives a margin of error of ±2%.");
    expect(c).toMatchObject({ kind: "checked", n: 500, statedMargin: 2, expectedMargin: 4.4, verdict: "understated", neededN: 2401, confidenceStated: false });
    expect(precisionCheckText(c)).toBe(
      "Claims more precision than the sample supports: n=500 at 95% gives about ±4.4 points, not ±2. ±2 would need about n=2,401. Assumed, as none is stated: 95% confidence and a simple random sample, design effect 1.",
    );
  });
  it("a stated design effect and a space as thousands separator", () => {
    expect(one("With a design effect of 1.5 and n = 1 200 the margin of error is ±3.5%.")).toMatchObject({ n: 1200, designEffect: 1.5, designEffectStated: true, verdict: "consistent" });
  });
  it("a wider margin than needed is said to be conservative, not wrong", () => {
    expect(one("Margin of error: ±5% for the 1,000 interviews.")).toMatchObject({ verdict: "conservative" });
  });
  it("other confidence levels change the expected margin", () => {
    expect(one("With n=1000 the margin of error is ±4.1% at 99% confidence.")).toMatchObject({ confidence: 99, verdict: "consistent" });
  });
  it("is not guessed when the sentence names no size, or a total and subgroups", () => {
    expect(one("Results are accurate to plus or minus 3 percentage points.")).toMatchObject({ kind: "not_checked", reason: "No sample size stated in the same sentence." });
    expect(one("Subgroups of 200 men and 300 women have a margin of error of ±6%.")).toMatchObject({ kind: "not_checked", reason: expect.stringMatching(/More than one sample size/) });
  });
  it("finds nothing in a document that states no margin", () => {
    expect(findPrecisionChecks("We will survey 1,000 customers online in March.")).toEqual([]);
  });
});
