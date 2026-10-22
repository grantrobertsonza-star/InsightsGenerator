// Scorecard short names: every criterion in the shipped criteria release has one, names are keyed by
// the stable id (not wording), and an unknown id falls back to the id itself rather than to blank.
import { describe, expect, it } from "vitest";
import criteria from "../../research-quality/criteria/RQC-6.json";
import { CRITERION_SHORT_LABEL, criterionRating, criterionRows, criterionShortLabel, filterDimensionsByStatus, reviewStepLabel, shownFailedSteps, statusChoices } from "../researchQualityPresentation";
import type { ReviewManifest } from "../researchQualityTypes";

describe("criterion short names", () => {
  it("names every criterion in the release, and nothing that is not in it", () => {
    const ids = criteria.criteria.map((c) => c.criterionId).sort();
    expect(Object.keys(CRITERION_SHORT_LABEL).sort()).toEqual(ids);
    for (const c of criteria.criteria) {
      const name = CRITERION_SHORT_LABEL[c.criterionId];
      expect(name.length, c.criterionId).toBeGreaterThan(2);
      expect(name.length, c.criterionId).toBeLessThan(c.assessmentQuestion.length);
    }
  });

  it("falls back to the id for a criterion it has no name for", () => {
    expect(criterionShortLabel("RQ-DESIGN-ALIGN")).toBe("Design fits objectives");
    expect(criterionShortLabel("RQ-NEW-ONE")).toBe("RQ-NEW-ONE");
  });
});

describe("scorecard order", () => {
  it("lists groups and rows in the release's order, whatever order the observations were saved in", async () => {
    const { scorecard } = await import("../researchQualityPresentation");
    const o = (criterionId: string, group: string) => ({ criterionId, group, status: "awaiting_review", payload: { rating: { score: 3, label: "Workable", reason: "" }, comparison: "standalone", improvement: null } }) as never;
    const g = scorecard([o("RQ-PROP-TIMELINE", "proposal"), o("RQ-PROP-BUDGET", "proposal"), o("RQ-BRIEF-BUDGET", "brief"), o("RQ-PROP-LITERATURE", "proposal"), o("RQ-BRIEF-BACKGROUND", "brief")]);
    expect(g.map((x) => [x.group, x.rows.map((r) => r.observation.criterionId)])).toEqual([
      ["brief", ["RQ-BRIEF-BACKGROUND", "RQ-BRIEF-BUDGET"]],
      ["proposal", ["RQ-PROP-LITERATURE", "RQ-PROP-TIMELINE", "RQ-PROP-BUDGET"]],
    ]);
  });
});

describe("review step names", () => {
  const range = { start: 0, end: 10 };
  const src = (filename: string, parts: number) => ({ filename, assessedRanges: Array.from({ length: parts }, () => range) }) as ReviewManifest["sources"][number];
  const one = { sources: [src("Capstone Proposal.docx", 6)] };
  const two = { sources: [src("Brief.pdf", 1), src("Capstone Proposal.docx", 6)] };
  it("names reading, rating and checklist steps in plain words", () => {
    expect(reviewStepLabel("extract:00:03", one)).toBe("Reading part 4 of 6");
    expect(reviewStepLabel("assess:proposal-method", one)).toBe("Rating Proposal: methodology");
    expect(reviewStepLabel("checklist:00:proposal", one)).toBe("Scoring the Research proposal checklist");
  });
  it("names the document only when the review has more than one, and a one-part read as the document", () => {
    expect(reviewStepLabel("extract:01:05", two)).toBe("Reading part 6 of 6 (Capstone Proposal.docx)");
    expect(reviewStepLabel("extract:00:00", two)).toBe("Reading the document (Brief.pdf)");
  });
  it("shows a key it cannot place as it is, rather than a wrong name", () => {
    expect(reviewStepLabel("extract:04:00", one)).toBe("extract:04:00");
    expect(reviewStepLabel("assess:unknown-group", one)).toBe("assess:unknown-group");
    expect(reviewStepLabel("render:00", one)).toBe("render:00");
  });
});

describe("failed steps listed under a review", () => {
  const tasks = [
    { key: "extract:00:03", status: "failed" },
    { key: "extract:00:04", status: "succeeded" },
  ];
  const review = (state: string, interrupted = false) => ({ state, progress: { interrupted }, coverage: { tasks } });
  it("hides the last run's failures while a retry is running", () => {
    expect(shownFailedSteps(review("running"))).toEqual([]);
    expect(shownFailedSteps(review("pending"))).toEqual([]);
  });
  it("lists them once the run settles, or when it stopped and waits for Continue", () => {
    expect(shownFailedSteps(review("partial")).map((t) => t.key)).toEqual(["extract:00:03"]);
    expect(shownFailedSteps(review("failed")).map((t) => t.key)).toEqual(["extract:00:03"]);
    expect(shownFailedSteps(review("running", true)).map((t) => t.key)).toEqual(["extract:00:03"]);
  });
  it("lists nothing when no step list is stored", () => {
    expect(shownFailedSteps({ state: "partial", progress: {}, coverage: {} })).toEqual([]);
  });
});

describe("the Criteria tab's list and filters", () => {
  const crit = (criterionId: string, state: string, score: number | null, label: string) => ({ criterionId, state, score, label, reason: "" });
  const dashboards = [
    {
      dashboardId: "proposal", label: "Proposal", basis: "", pct: 60, band: "workable", ratedWeight: 2, totalWeight: 2,
      dimensions: [
        { dimensionId: "method", categoryLabel: "Methodological rigour", weight: 36, state: "rated", score: 3, label: "Workable", reason: "",
          criteria: [crit("RQ-PROP-METHOD", "rated", 3, "Workable"), crit("RQ-PROP-DESIGN", "failed", null, "Failed")] },
        { dimensionId: "price", categoryLabel: "Price", weight: 18, state: "not_rated", score: null, label: "Not rated", reason: "",
          criteria: [crit("RQ-PROP-PRICE", "not_rated", null, "Not rated")] },
      ],
    },
  ] as unknown as Parameters<typeof criterionRows>[0];
  it("lists every criterion once, with its dimension and its status as the dashboard shows it", () => {
    expect(criterionRows([...dashboards, ...dashboards]).map((r) => [r.criterionId, r.dimensionId, r.dimensionLabel, r.status])).toEqual([
      ["RQ-PROP-METHOD", "method", "Methodological rigour", "Workable"],
      ["RQ-PROP-DESIGN", "method", "Methodological rigour", "Failed"],
      ["RQ-PROP-PRICE", "price", "Price", "Not rated"],
    ]);
  });
  it("the Overview's Show filter keeps each dimension with its matching criteria, and leaves out the rest", () => {
    const d = dashboards[0];
    expect(filterDimensionsByStatus(d, "all").map((v) => [v.dimension.dimensionId, v.criteria.map((c) => c.criterionId)])).toEqual([
      ["method", ["RQ-PROP-METHOD", "RQ-PROP-DESIGN"]],
      ["price", ["RQ-PROP-PRICE"]],
    ]);
    // A category keeps its heading (its own score and label unchanged) beside the matching item only.
    const workable = filterDimensionsByStatus(d, "Workable");
    expect(workable.map((v) => [v.dimension.dimensionId, v.dimension.score, v.criteria.map((c) => c.criterionId)])).toEqual([["method", 3, ["RQ-PROP-METHOD"]]]);
    expect(filterDimensionsByStatus(d, "Not rated").map((v) => v.dimension.dimensionId)).toEqual(["price"]);
    expect(filterDimensionsByStatus(d, "Failed").map((v) => v.criteria.map((c) => c.criterionId))).toEqual([["RQ-PROP-DESIGN"]]);
    expect(filterDimensionsByStatus(d, "Strong")).toEqual([]);
  });
  it("offers the statuses present, best band first, states without a rating after, an unknown one last", () => {
    expect(statusChoices(["Weak", "Not rated", "Strong", "Weak", "Odd", "Failed", "Workable"])).toEqual(["Strong", "Workable", "Weak", "Not rated", "Failed", "Odd"]);
    expect(statusChoices(criterionRows(dashboards).map((r) => r.status))).toEqual(["Workable", "Not rated", "Failed"]);
  });
  it("a criterion's rating comes from the dashboard, else from its observation, else Not rated", () => {
    expect(criterionRating(dashboards, [], "RQ-PROP-METHOD")).toEqual({ score: 3, label: "Workable" });
    const obs = [{ criterionId: "RQ-X", status: "active", payload: { rating: { score: 1, label: "Weak" } } }] as unknown as Parameters<typeof criterionRating>[1];
    expect(criterionRating(dashboards, obs, "RQ-X")).toEqual({ score: 1, label: "Weak" });
    expect(criterionRating(dashboards, [], "RQ-NONE")).toEqual({ score: null, label: "Not rated" });
  });
});
