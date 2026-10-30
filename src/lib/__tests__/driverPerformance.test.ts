import { describe, expect, it } from "vitest";
import { performanceScales, predictorPerformance, type AnswerDomain } from "../driverPerformance";

const declared = (min: number, max: number, count = max - min + 1): AnswerDomain => ({ source: "declared", min, max, count, integers: true });

describe("driver performance for importance against performance (D2b)", () => {
  it("a 1 to 5 scale: top two counted from the declared top, so a declared 5 nobody chose still sets the top", () => {
    // Answers 1 to 4 only; the answer list declares 5. Top two is 4 and 5: 2 of 8 answered 4.
    const p = predictorPerformance({ min: 1, max: 4, distinct: 4, answerDomain: declared(1, 5) }, [1, 2, 3, 4, 1, 2, 3, 4], Array(8).fill(1));
    expect(p).toEqual({ mean: 2.5, topTwo: 0.25, measure: "topTwo", scaleTop: 5, scaleMin: 1, scaleStated: true, domainSource: "declared" });
  });
  it("without an answer list the top is the highest answer seen, and that is said", () => {
    const p = predictorPerformance({ min: 1, max: 4, distinct: 4 }, [1, 2, 3, 4], [1, 1, 1, 1]);
    expect(p).toMatchObject({ topTwo: 0.5, scaleTop: 4, scaleStated: false, domainSource: "observed" });
  });
  it("a 0/1 indicator is its share, never a top two", () => {
    expect(predictorPerformance({ min: 0, max: 1, distinct: 2 }, [1, 0, 1, 1], [1, 1, 1, 1])).toEqual({ mean: 0.75, topTwo: null, measure: "share", scaleTop: null, scaleMin: null, scaleStated: null, domainSource: "observed" });
  });
  it("weighted: hand-computed", () => {
    // Values 5 (w 3) and 1 (w 1) on 1 to 5: mean (15 + 1) / 4 = 4; top two 3 / 4.
    expect(predictorPerformance({ min: 1, max: 5, distinct: 3, answerDomain: declared(1, 5) }, [5, 1], [3, 1])).toMatchObject({ mean: 4, topTwo: 0.75 });
  });
  it("a long numeric scale (age) is a mean only", () => {
    expect(predictorPerformance({ min: 18, max: 80, distinct: 40 }, [20, 40], [1, 1])).toEqual({ mean: 30, topTwo: null, measure: "mean", scaleTop: null, scaleMin: null, scaleStated: null, domainSource: "observed" });
  });
  it("one axis only for one kind of scale; indicators beside 0 to 10 scores are mixed", () => {
    const s5 = { min: 1, max: 5, distinct: 5, answerDomain: declared(1, 5) };
    const ind = { min: 0, max: 1, distinct: 2 };
    const s10 = { min: 0, max: 10, distinct: 11, answerDomain: declared(0, 10) };
    const perf = (s: typeof s5 | typeof ind | typeof s10) => predictorPerformance(s, [1], [1]);
    expect(performanceScales([perf(s5), perf(s5)], [s5, s5])).toBe("same");
    expect(performanceScales([perf(ind), perf(s10)], [ind, s10])).toBe("mixed");
    expect(performanceScales([perf(s5), perf(s10)], [s5, s10])).toBe("mixed");
  });
  it("no answers: unknown, never 0", () => {
    expect(predictorPerformance({ min: 1, max: 5, distinct: 5, answerDomain: declared(1, 5) }, [], [])).toMatchObject({ mean: null, topTwo: null });
  });
});

// Codex T2-F01 (independent T2 review, 30 October 2026), his counterexamples made permanent. His inputs gave only the
// declared top; the engine now carries the whole answer domain (driver_columns `answerDomain`, as its selftest pins),
// which is what these pass. The actual engine path is driverPerformanceDomain.test.ts.
describe("the measure comes from the declared answer domain, not the answers present (T2-F01)", () => {
  it("a declared five point scale remains top-two when only 4 and 5 were chosen", () => {
    const p = predictorPerformance({ min: 4, max: 5, distinct: 2, answerDomain: declared(1, 5), valueLabels: { "4": "Satisfied", "5": "Very satisfied" } }, [4, 5, 4, 5], [1, 1, 1, 1]);
    expect(p).toMatchObject({ measure: "topTwo", topTwo: 1, scaleTop: 5, scaleMin: 1, domainSource: "declared" });
  });
  it("a declared 0 to 10 scale with only 0 and 1 chosen is not a binary indicator", () => {
    expect(predictorPerformance({ min: 0, max: 1, distinct: 2, answerDomain: declared(0, 10) }, [0, 1], [1, 1])).toMatchObject({ measure: "topTwo", topTwo: 0, scaleTop: 10 });
  });
  it("a genuine binary indicator retains its share", () => {
    expect(predictorPerformance({ min: 0, max: 1, distinct: 2, answerDomain: declared(0, 1) }, [0, 1], [1, 1])).toMatchObject({ measure: "share", mean: 0.5, domainSource: "declared" });
    // A declared No/Yes answered only Yes is still an indicator, and its share is 100%.
    expect(predictorPerformance({ min: 1, max: 1, distinct: 1, answerDomain: declared(0, 1) }, [1, 1], [1, 1])).toMatchObject({ measure: "share", mean: 1 });
  });
  it("boundaries: a declared list labelling only 0 and 10 spans eleven points; 1/2 or 1 to 12 are means", () => {
    expect(predictorPerformance({ min: 0, max: 1, distinct: 2, answerDomain: declared(0, 10, 3) }, [0, 1], [1, 1])).toMatchObject({ measure: "topTwo", topTwo: 0 });
    expect(predictorPerformance({ min: 1, max: 2, distinct: 2, answerDomain: declared(1, 2) }, [1, 2], [1, 1]).measure).toBe("mean");
    expect(predictorPerformance({ min: 1, max: 12, distinct: 12, answerDomain: declared(1, 12) }, [1, 12], [1, 1]).measure).toBe("mean");
    expect(predictorPerformance({ min: 1, max: 3, distinct: 2, answerDomain: { ...declared(1, 3), integers: false } }, [1, 3], [1, 1]).measure).toBe("mean");
  });
  it("observed fallback: two observed answers are no scale (a mean), three are; said either way", () => {
    expect(predictorPerformance({ min: 4, max: 5, distinct: 2 }, [4, 5], [1, 1])).toMatchObject({ measure: "mean", domainSource: "observed" });
    expect(predictorPerformance({ min: 3, max: 5, distinct: 3 }, [3, 4, 5], [1, 1, 1])).toMatchObject({ measure: "topTwo", scaleTop: 5, scaleStated: false, domainSource: "observed" });
  });
  it("one axis: a sparse and a full declared 1 to 5 scale share it; a sparse 0 to 10 beside them does not", () => {
    const sparse5 = predictorPerformance({ min: 4, max: 5, distinct: 2, answerDomain: declared(1, 5) }, [4, 5], [1, 1]);
    const full5 = predictorPerformance({ min: 1, max: 5, distinct: 5, answerDomain: declared(1, 5) }, [1, 5], [1, 1]);
    const sparse10 = predictorPerformance({ min: 0, max: 1, distinct: 2, answerDomain: declared(0, 10) }, [0, 1], [1, 1]);
    expect(performanceScales([sparse5, full5])).toBe("same");
    expect(performanceScales([sparse5, sparse10])).toBe("mixed");
  });
});

describe("outcomeTopBox: a binary driver outcome's default top box (T2-F01's rule, applied to the outcome)", () => {
  it("reads the declared domain: 1-5 answered 1 to 4 is 4 and 5; a declared two-code list is its top code", async () => {
    const { outcomeTopBox } = await import("../driverPerformance");
    expect(outcomeTopBox({ min: 1, max: 4, distinct: 4, answerDomain: { source: "declared", min: 1, max: 5, count: 5, integers: true } })).toEqual({ min: 4, lowest: 1, top: 5, source: "declared" });
    expect(outcomeTopBox({ min: 0, max: 0, distinct: 1, answerDomain: { source: "declared", min: 0, max: 1, count: 2, integers: true } })).toEqual({ min: 1, lowest: 0, top: 1, source: "declared" });
  });
  it("without an answer list falls back to the answers present, as before, and says so", async () => {
    const { outcomeTopBox } = await import("../driverPerformance");
    expect(outcomeTopBox({ min: 1, max: 4, distinct: 4 })).toEqual({ min: 3, lowest: 1, top: 4, source: "observed" });
    expect(outcomeTopBox({ min: 4, max: 5, distinct: 2 })).toEqual({ min: 5, lowest: 4, top: 5, source: "observed" });
  });
});
