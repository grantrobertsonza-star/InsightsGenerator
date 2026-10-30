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
  // Codex review IR-06 (2026-10-20). Expected values by hand: n=1,000 at 90% is
  // 1.645 * 0.015811 = 0.026009 -> ±2.60 points; at 95% 3.10 (header).
  it("uses a level stated as 'at the 90% level', labelled as stated, not an assumed 95%", () => {
    const c = one("A sample of 1,000 respondents has a margin of error of 3% at the 90% level.");
    expect(c).toMatchObject({ kind: "checked", n: 1000, statedMargin: 3, confidence: 90, confidenceStated: true, expectedMargin: 2.6, verdict: "conservative" });
    expect(precisionCheckText(c)).not.toMatch(/Assumed, as none is stated: 95% confidence/);
    expect(precisionCheckText(c)).toMatch(/at 90%/);
  });
  it("reads the other ordinary ways of stating a level", () => {
    for (const [text, level] of [
      ["With 1,000 interviews, the margin of error is ±2.6% at 90% confidence.", 90],
      ["The margin of error for n=1000 is ±3.1% (95% CI).", 95],
      ["With 99% confidence, 1,000 respondents give a margin of error of ±4.1%.", 99],
      ["A confidence level of 95% and 1,000 cases give a margin of error of ±3.1%.", 95],
      ["1,000 respondents: margin of error ±2.6% at a 90% confidence level.", 90],
    ] as const) {
      expect(one(text), text).toMatchObject({ kind: "checked", confidence: level, confidenceStated: true, verdict: "consistent" });
    }
  });
  it("does not check a sentence that names two confidence levels", () => {
    const c = one("For 1,000 respondents the margin of error is ±3.1% at 95% confidence and ±2.6% at 90% confidence.");
    expect(c.kind).toBe("not_checked");
    const both = one("For 1,000 respondents the margin of error of ±3% holds at 95% confidence (and better at the 90% level).");
    expect(both).toMatchObject({ kind: "not_checked", reason: expect.stringMatching(/More than one confidence level.*90% and 95%|95% and 90%/) });
  });
  it("reports an unsupported stated level instead of assuming 95%", () => {
    expect(one("With 1,000 respondents the margin of error is ±2% at 80% confidence.")).toMatchObject({ kind: "not_checked", reason: expect.stringMatching(/80% confidence level is stated/) });
  });
  it("reads ±3pp, points, and a margin stated before the words 'margin of error'", () => {
    expect(one("The 1,000 interviews give ±3pp.")).toMatchObject({ kind: "checked", statedMargin: 3, n: 1000, verdict: "consistent" });
    expect(one("The 1,000 interviews give a 3 percentage points margin of error.")).toMatchObject({ kind: "checked", statedMargin: 3, verdict: "consistent" });
    expect(one("A 3% margin of error applies to the 1 000 respondents.")).toMatchObject({ kind: "checked", n: 1000, statedMargin: 3 });
    expect(one("With n = 1 000 the margin of error is 3 points.")).toMatchObject({ kind: "checked", n: 1000, statedMargin: 3 });
  });
  it("never reads a confidence level as the margin", () => {
    expect(one("The margin of error at the 95% level is ±3.1% for 1,000 respondents.")).toMatchObject({ kind: "checked", statedMargin: 3.1, confidence: 95, confidenceStated: true });
  });
  it("one margin repeated is one claim; two different margins are not checked", () => {
    expect(one("1,000 interviews give a margin of error of ±3% (±3% at 95% confidence).")).toMatchObject({ kind: "checked", statedMargin: 3 });
    expect(one("1,000 interviews give a margin of error of ±3%, or ±5% for regions.")).toMatchObject({ kind: "not_checked", reason: "More than one margin of error in the sentence." });
  });
  it("two sample sizes are still not checked", () => {
    expect(one("A total of 1,000 interviews and 400 respondents per region give a margin of error of ±3%.")).toMatchObject({ kind: "not_checked", reason: expect.stringMatching(/More than one sample size/) });
  });
  it("finds nothing in a document that states no margin", () => {
    expect(findPrecisionChecks("We will survey 1,000 customers online in March.")).toEqual([]);
  });
});
