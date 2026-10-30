// The bird's-eye dashboard (RQC-3 brief dimensions). Expected figures are worked out by hand in each
// case, not by calling the scorer's own formula.
import { describe, expect, it } from "vitest";
import criteria from "../../research-quality/criteria/RQC-6.json";
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
    expect(d.dimensions.find((x) => x.dimensionId === "RQ-BRIEF-METHOD")).toMatchObject({ state: "rated", score: 0, label: "Absent" });
    expect(d.dimensions.find((x) => x.dimensionId === "RQ-BRIEF-PRACTICAL")).toMatchObject({ state: "not_rated", score: null });
    expect(d.dimensions.map((x) => x.dimensionId)).toEqual(BRIEF.criteria);
  });

  it("uses the lowest of several live ratings and ignores dismissed ones", () => {
    const [d] = run([obs("RQ-BRIEF-DECISION", 5), obs("RQ-BRIEF-DECISION", 1), obs("RQ-BRIEF-PROBLEM", 0, "dismissed"), ...BRIEF.criteria.filter((c) => c !== "RQ-BRIEF-DECISION" && c !== "RQ-BRIEF-PROBLEM").map((c) => obs(c, 5))]);
    expect(d.dimensions.find((x) => x.dimensionId === "RQ-BRIEF-DECISION")).toMatchObject({ score: 1, label: "Weak" });
    expect(d.dimensions.find((x) => x.dimensionId === "RQ-BRIEF-PROBLEM")!.state).toBe("not_rated");
    // Rated: the other eight at 5 (seven single-weight plus Objectives at 2: weight 9, 45 points) and
    // Decision 1 x 2 (2 points): 47 of (9 + 2) x 5 = 55 -> 85.5% -> 85. Problem (dismissed) is left out.
    expect(d).toMatchObject({ pct: 85, band: "strong", ratedWeight: 11, totalWeight: 13 });
  });

  it("withholds the overall figure with less than half the weight rated, and shows running or failed steps as such", () => {
    // Rated: Problem, Decision (w2 each) and Background (w1) = 5 of 13: under half.
    const [d] = run([obs("RQ-BRIEF-PROBLEM", 5), obs("RQ-BRIEF-DECISION", 5), obs("RQ-BRIEF-BACKGROUND", 5)], { assessState: () => "pending" });
    expect(d).toMatchObject({ pct: null, band: null, ratedWeight: 5 });
    expect(d.dimensions.find((x) => x.dimensionId === "RQ-BRIEF-BUDGET")).toMatchObject({ state: "pending", label: "Not rated yet" });
    // Adding Objectives (w2) makes 7 of 13, over half: (25 + 10) / 35 = 100%.
    const [e] = run([obs("RQ-BRIEF-PROBLEM", 5), obs("RQ-BRIEF-DECISION", 5), obs("RQ-BRIEF-BACKGROUND", 5), obs("RQ-BRIEF-OBJECTIVES", 5)], { assessState: () => "failed" });
    expect(e).toMatchObject({ pct: 100, band: "strong", ratedWeight: 7 });
    expect(e.dimensions.find((x) => x.dimensionId === "RQ-BRIEF-BUDGET")).toMatchObject({ state: "failed", label: "Could not be rated" });
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

describe("proposal dashboard (RQC-4 categories)", () => {
  const PROPOSAL = DASHBOARDS.find((d) => d.dashboardId === "proposal")!;
  const all = PROPOSAL.categories!.flatMap((c) => c.criteria);
  const prun = (observations: Obs[], extra: Partial<Parameters<typeof reviewDashboards>[0]> = {}) =>
    reviewDashboards({ criteriaRelease: "RQC-4", selectedCriteria: all, observations, assessState: done, ...extra }).find((d) => d.dashboardId === "proposal")!;

  it("uses Grant's minimum weights scaled to 100 over six categories that cover every active proposal criterion once", () => {
    expect(PROPOSAL.categories!.map((c) => [c.categoryId, c.weight])).toEqual([["method", 36], ["price", 18], ["team", 14], ["management", 14], ["compliance", 9], ["innovation", 9]]);
    const isRetired = (c: (typeof criteria.criteria)[number]) => "retired" in c && Boolean(c.retired);
    const active = criteria.criteria.filter((c) => c.group.startsWith("proposal") && !isRetired(c)).map((c) => c.criterionId).sort();
    // Retired criteria stay listed only so older reviews keep their items; new reviews never select them.
    const retired = new Set(criteria.criteria.filter(isRetired).map((c) => c.criterionId));
    expect([...all].filter((id) => !retired.has(id)).sort()).toEqual(active);
    expect([...all].filter((id) => retired.has(id))).toEqual(["RQ-PROP-SAMPLE"]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("RQC-6: sampling is two items of Methodological rigour (size and precision; method)", () => {
    const method = PROPOSAL.categories!.find((c) => c.categoryId === "method")!;
    const now = method.criteria.filter((id) => id !== "RQ-PROP-SAMPLE");
    expect(now).toEqual(["RQ-PROP-METHOD", "RQ-PROP-DESIGN", "RQ-PROP-SAMPLE-SIZE", "RQ-PROP-SAMPLE-METHOD", "RQ-PROP-ANALYSIS", "RQ-PROP-LITERATURE"]);
    // A new review: six items, (5 + 3 + 1 + 5 + 3 + 3) / 6 = 20/6 = 3.33.
    const d = reviewDashboards({
      criteriaRelease: "RQC-6",
      selectedCriteria: now,
      observations: [obs("RQ-PROP-METHOD", 5), obs("RQ-PROP-DESIGN", 3), obs("RQ-PROP-SAMPLE-SIZE", 1), obs("RQ-PROP-SAMPLE-METHOD", 5), obs("RQ-PROP-ANALYSIS", 3), obs("RQ-PROP-LITERATURE", 3)],
      assessState: done,
    }).find((x) => x.dashboardId === "proposal")!;
    const m = d.dimensions.find((x) => x.dimensionId === "method")!;
    expect(m.criteria.map((c) => c.criterionId)).toEqual(now);
    expect(m.score).toBeCloseTo(20 / 6, 10);
  });

  it("a review made before RQC-6 keeps its one Sample item and its score", () => {
    const before = ["RQ-PROP-METHOD", "RQ-PROP-DESIGN", "RQ-PROP-SAMPLE", "RQ-PROP-ANALYSIS", "RQ-PROP-LITERATURE"];
    const d = reviewDashboards({
      criteriaRelease: "RQC-5",
      selectedCriteria: before,
      observations: [obs("RQ-PROP-METHOD", 5), obs("RQ-PROP-DESIGN", 3), obs("RQ-PROP-SAMPLE", 3), obs("RQ-PROP-ANALYSIS", 5), obs("RQ-PROP-LITERATURE", 5)],
      assessState: done,
    }).find((x) => x.dashboardId === "proposal")!;
    const m = d.dimensions.find((x) => x.dimensionId === "method")!;
    expect(m.criteria.map((c) => c.criterionId)).toEqual(before);
    expect(m.score).toBeCloseTo(21 / 5, 10);
  });

  it("scores a category as the average of its rated criteria, then weights the categories", () => {
    // Method: 5, 3, 1, 3 and Literature unrated -> 12/4 = 3.0. Price 1. Team 0. Management (5 + 3)/2 = 4.
    // Compliance (5 + 3 + 3 + 1)/4 = 3. Innovation unrated.
    // Points: 36x3 + 18x1 + 14x0 + 14x4 + 9x3 = 108 + 18 + 0 + 56 + 27 = 209, of 91 x 5 = 455 -> 45.9% -> 46.
    const d = prun([
      obs("RQ-PROP-METHOD", 5), obs("RQ-PROP-DESIGN", 3), obs("RQ-PROP-SAMPLE", 1), obs("RQ-PROP-ANALYSIS", 3),
      obs("RQ-PROP-BUDGET", 1), obs("RQ-PROP-TEAM", 0), obs("RQ-PROP-TIMELINE", 5), obs("RQ-PROP-MANAGEMENT", 3),
      obs("RQ-PROP-RESTATEMENT", 5), obs("RQ-PROP-OBJECTIVES-ADDED", 3), obs("RQ-PROP-PRODUCTS", 3), obs("RQ-PROP-COMPLIANCE", 1),
    ]);
    expect(d).toMatchObject({ pct: 46, band: "weak", ratedWeight: 91, totalWeight: 100 });
    const cat = (id: string) => d.dimensions.find((x) => x.dimensionId === id)!;
    expect(cat("method")).toMatchObject({ score: 3, label: "Workable", categoryLabel: "Methodological rigour" });
    expect(cat("method").criteria.find((c) => c.criterionId === "RQ-PROP-LITERATURE")!.state).toBe("not_rated");
    expect(cat("management")).toMatchObject({ score: 4, label: "Strong" });
    expect(cat("team")).toMatchObject({ score: 0, label: "Weak" });
    expect(cat("innovation")).toMatchObject({ state: "not_rated", score: null });
  });

  it("leaves out criteria not selected for the review, and drops a category with none", () => {
    // Without a brief, nothing changes in selection here, but a review that selected only the method
    // criteria scores only that category: 3 of 5 -> 60%, with 36 of 36 weight.
    const d = prun([obs("RQ-PROP-METHOD", 3)], { selectedCriteria: ["RQ-PROP-METHOD"] });
    expect(d.dimensions.map((x) => x.dimensionId)).toEqual(["method"]);
    expect(d).toMatchObject({ pct: 60, ratedWeight: 36, totalWeight: 36 });
  });

  it("is not shown for a review made under RQC-3", () => {
    expect(reviewDashboards({ criteriaRelease: "RQC-3", selectedCriteria: all, observations: [], assessState: done }).map((d) => d.dashboardId)).toEqual([]);
  });
});
