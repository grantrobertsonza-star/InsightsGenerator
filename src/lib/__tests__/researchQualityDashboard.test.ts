// The bird's-eye dashboard (RQC-3 brief dimensions). Expected figures are worked out by hand in each
// case, not by calling the scorer's own formula.
import { describe, expect, it } from "vitest";
import criteria from "../../research-quality/criteria/RQC-3.json";
import { DASHBOARDS, dashboardBandFor, reviewDashboards } from "../researchQualityDashboard";

const BRIEF = DASHBOARDS.find((d) => d.dashboardId === "brief")!;
type Obs = Parameters<typeof reviewDashboards>[0]["observations"][number];
const obs = (criterionId: string, score: number | null, status: Obs["status"] = "awaiting_review"): Obs =>
  ({ criterionId, status, payload: { rating: { score, label: score === null ? "Not rated" : ({ 5: "Strong", 3: "Workable", 1: "Weak", 0: "Absent" } as Record<number, string>)[score], reason: `${criterionId} reason` } } }) as unknown as Obs;
const done = () => "done" as const;
const run = (observations: Obs[], extra: Partial<Parameters<typeof reviewDashboards>[0]> = {}) =>
  reviewDashboards({ criteriaRelease: "RQC-3", selectedCriteria: BRIEF.criteria, observations, assessState: done, ...extra });

describe("brief dashboard definition", () => {
  it("rates the ten brief dimensions, all active criteria of the release, with problem, decisions and objectives doubled", () => {
    const active = criteria.criteria.filter((c) => c.group === "brief" && !("retired" in c && c.retired)).map((c) => c.criterionId);
    expect(BRIEF.criteria).toEqual(active);
    expect(BRIEF.criteria).toHaveLength(10);
    expect(BRIEF.weights).toEqual({ "RQ-BRIEF-PROBLEM": 2, "RQ-BRIEF-DECISION": 2, "RQ-BRIEF-OBJECTIVES": 2 });
  });
});

describe("scoring", () => {
  it("computes the weighted percentage from rated dimensions only, with Absent counted as zero", () => {
    // Background 5 (w1), Problem 3 (w2), Decision 5 (w2), Objectives 5 (w2), Audience 3, Method 0 (Absent),
    // Deliverables 3, Timing 5, Budget 1, Practical not rated.
    // Points: 5 + 6 + 10 + 10 + 3 + 0 + 3 + 5 + 1 = 43. Possible: rated weight 12 x 5 = 60. 43/60 = 71.7% -> 72.
    // (Unweighted it would be 30/45 = 67%, so the weights are really applied.)
    const [d] = run([
      obs("RQ-BRIEF-BACKGROUND", 5), obs("RQ-BRIEF-PROBLEM", 3), obs("RQ-BRIEF-DECISION", 5), obs("RQ-BRIEF-OBJECTIVES", 5),
      obs("RQ-BRIEF-AUDIENCE", 3), obs("RQ-BRIEF-METHOD", 0), obs("RQ-BRIEF-DELIVERABLES", 3), obs("RQ-BRIEF-TIMING", 5), obs("RQ-BRIEF-BUDGET", 1),
    ]);
    expect(d).toMatchObject({ pct: 72, band: "workable", ratedWeight: 12, totalWeight: 13 });
    expect(d.dimensions.find((x) => x.criterionId === "RQ-BRIEF-METHOD")).toMatchObject({ state: "rated", score: 0, label: "Absent" });
    expect(d.dimensions.find((x) => x.criterionId === "RQ-BRIEF-PRACTICAL")).toMatchObject({ state: "not_rated", score: null });
    expect(d.dimensions.map((x) => x.criterionId)).toEqual(BRIEF.criteria);
  });

  it("uses the lowest of several live ratings and ignores dismissed ones", () => {
    const [d] = run([obs("RQ-BRIEF-DECISION", 5), obs("RQ-BRIEF-DECISION", 1), obs("RQ-BRIEF-PROBLEM", 0, "dismissed"), ...BRIEF.criteria.filter((c) => c !== "RQ-BRIEF-DECISION" && c !== "RQ-BRIEF-PROBLEM").map((c) => obs(c, 5))]);
    expect(d.dimensions.find((x) => x.criterionId === "RQ-BRIEF-DECISION")).toMatchObject({ score: 1, label: "Weak" });
    expect(d.dimensions.find((x) => x.criterionId === "RQ-BRIEF-PROBLEM")!.state).toBe("not_rated");
    // Rated: the other eight at 5 (seven single-weight plus Objectives at 2: weight 9, 45 points) and
    // Decision 1 x 2 (2 points): 47 of (9 + 2) x 5 = 55 -> 85.5% -> 85. Problem (dismissed) is left out.
    expect(d).toMatchObject({ pct: 85, band: "strong", ratedWeight: 11, totalWeight: 13 });
  });

  it("withholds the overall figure with less than half the weight rated, and shows running or failed steps as such", () => {
    // Rated: Problem, Decision (w2 each) and Background (w1) = 5 of 13: under half.
    const [d] = run([obs("RQ-BRIEF-PROBLEM", 5), obs("RQ-BRIEF-DECISION", 5), obs("RQ-BRIEF-BACKGROUND", 5)], { assessState: () => "pending" });
    expect(d).toMatchObject({ pct: null, band: null, ratedWeight: 5 });
    expect(d.dimensions.find((x) => x.criterionId === "RQ-BRIEF-BUDGET")).toMatchObject({ state: "pending", label: "Not rated yet" });
    // Adding Objectives (w2) makes 7 of 13, over half: (25 + 10) / 35 = 100%.
    const [e] = run([obs("RQ-BRIEF-PROBLEM", 5), obs("RQ-BRIEF-DECISION", 5), obs("RQ-BRIEF-BACKGROUND", 5), obs("RQ-BRIEF-OBJECTIVES", 5)], { assessState: () => "failed" });
    expect(e).toMatchObject({ pct: 100, band: "strong", ratedWeight: 7 });
    expect(e.dimensions.find((x) => x.criterionId === "RQ-BRIEF-BUDGET")).toMatchObject({ state: "failed", label: "Could not be rated" });
  });

  it("uses the release's bands at their edges", () => {
    expect([100, 80, 79, 60, 59, 0].map(dashboardBandFor)).toEqual(["strong", "strong", "workable", "workable", "weak", "weak"]);
  });
});

describe("when a dashboard applies", () => {
  it("not for a review made under an earlier criteria release, nor without a brief", () => {
    expect(run([], { criteriaRelease: "RQC-2" })).toEqual([]);
    expect(run([], { selectedCriteria: ["RQ-PROP-METHOD"] })).toEqual([]);
    expect(run([], { criteriaRelease: "RQC-4" })).toHaveLength(1);
  });
});
