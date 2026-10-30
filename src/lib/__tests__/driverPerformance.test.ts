import { describe, expect, it } from "vitest";
import { performanceScales, predictorPerformance } from "../driverPerformance";

describe("driver performance for importance against performance (D2b)", () => {
  it("a 1 to 5 scale: top two counted from the declared top, so a declared 5 nobody chose still sets the top", () => {
    // Answers 1 to 4 only; the answer list declares 5. Top two is 4 and 5: 2 of 8 answered 4.
    const p = predictorPerformance({ min: 1, max: 4, distinct: 4, scaleTop: 5, scaleStated: true }, [1, 2, 3, 4, 1, 2, 3, 4], Array(8).fill(1));
    expect(p).toEqual({ mean: 2.5, topTwo: 0.25, measure: "topTwo", scaleTop: 5, scaleStated: true });
  });
  it("without an answer list the top is the highest answer seen, and that is said", () => {
    const p = predictorPerformance({ min: 1, max: 4, distinct: 4 }, [1, 2, 3, 4], [1, 1, 1, 1]);
    expect(p).toMatchObject({ topTwo: 0.5, scaleTop: 4, scaleStated: null });
  });
  it("a 0/1 indicator is its share, never a top two", () => {
    expect(predictorPerformance({ min: 0, max: 1, distinct: 2 }, [1, 0, 1, 1], [1, 1, 1, 1])).toEqual({ mean: 0.75, topTwo: null, measure: "share", scaleTop: 1, scaleStated: null });
  });
  it("weighted: hand-computed", () => {
    // Values 5 (w 3) and 1 (w 1) on 1 to 5: mean (15 + 1) / 4 = 4; top two 3 / 4.
    expect(predictorPerformance({ min: 1, max: 5, distinct: 3, scaleTop: 5 }, [5, 1], [3, 1])).toMatchObject({ mean: 4, topTwo: 0.75 });
  });
  it("a long numeric scale (age) is a mean only", () => {
    expect(predictorPerformance({ min: 18, max: 80, distinct: 40 }, [20, 40], [1, 1])).toEqual({ mean: 30, topTwo: null, measure: "mean", scaleTop: null, scaleStated: null });
  });
  it("one axis only for one kind of scale; indicators beside 0 to 10 scores are mixed", () => {
    const s5 = { min: 1, max: 5, distinct: 5, scaleTop: 5 };
    const ind = { min: 0, max: 1, distinct: 2 };
    const s10 = { min: 0, max: 10, distinct: 11, scaleTop: 10 };
    const perf = (s: typeof s5 | typeof ind | typeof s10) => predictorPerformance(s, [1], [1]);
    expect(performanceScales([perf(s5), perf(s5)], [s5, s5])).toBe("same");
    expect(performanceScales([perf(ind), perf(s10)], [ind, s10])).toBe("mixed");
    expect(performanceScales([perf(s5), perf(s10)], [s5, s10])).toBe("mixed");
  });
  it("no answers: unknown, never 0", () => {
    expect(predictorPerformance({ min: 1, max: 5, distinct: 5, scaleTop: 5 }, [], [])).toMatchObject({ mean: null, topTwo: null });
  });
});
