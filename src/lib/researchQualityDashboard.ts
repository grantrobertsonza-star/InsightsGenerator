// Research Quality Review: the bird's-eye dashboards (Grant, 2026-10-19).
//
// A dashboard combines one document type's criteria into a single weighted percentage, shown above
// one bar per dimension. The model rates each criterion on the release's scale (Strong 5, Workable 3,
// Weak 1, Absent 0) with cited evidence, validated by researchQualityRules.ts; everything here is
// arithmetic on those stored ratings, done by code:
//   criterion rating: when a criterion has several live observations (one per decision, say), the
//     lowest, so no dimension looks better than its weakest part;
//   dimension: either one criterion (the brief's ten, with `weights`) or a category averaging its
//     rated criteria (the proposal's six, with `categories`);
//   overall: sum(weight x dimension score) / sum(weight x 5) over rated dimensions, a whole percentage;
//   band: Strong >= 80%, Workable >= 60%, Weak below (the release's bands);
//   withheld: with less than half the total weight rated, no overall figure is given.
// A criterion with no rating (not run yet, failed, or dismissed by the researcher) is "not rated" and
// left out of every average, never counted as zero; Absent (0) is a real rating and is counted.
// Pure module: no database, no model calls, no Node-only imports, so the screen can use it too.
import release from "../research-quality/criteria/RQC-4.json";
import type { ObservationView } from "./researchQualityView";

type Category = { categoryId: string; label: string; weight: number; criteria: string[] };
export type DashboardDefinition = {
  dashboardId: string;
  label: string;
  sinceRelease: string;
  /** One dimension per criterion, weighted by `weights` (default 1)... */
  criteria: string[];
  weights: Record<string, number>;
  /** ...or, when given, one dimension per category, its score the average of its rated criteria. */
  categories: Category[] | null;
  basis: string;
};
export const DASHBOARDS = release.dashboards as DashboardDefinition[];
export const DASHBOARD_BANDS = release.dashboardBands as { band: DashboardBand; minPct: number }[];
export const MAX_CRITERION_SCORE = 5;
export const MIN_RATED_WEIGHT_SHARE = 0.5;
const SCALE_LABEL = release.scale as Record<string, string>;

export type DashboardBand = "strong" | "workable" | "weak";
export type DimensionState = "rated" | "not_rated" | "pending" | "failed";
export type CriterionRating = { criterionId: string; state: DimensionState; score: number | null; label: string; reason: string };
export type DashboardDimension = {
  /** The criterion id (one-criterion dimension) or the category id. */
  dimensionId: string;
  /** The category's name; null for a one-criterion dimension, whose name is the criterion's. */
  categoryLabel: string | null;
  weight: number;
  state: DimensionState;
  /** 0 to 5: the criterion's rating, or the average of the category's rated criteria. */
  score: number | null;
  /** The rating's own label for one criterion; for a category, its band at score / 5. */
  label: string;
  /** The model's reason for a one-criterion rating (for the hover); empty for a category. */
  reason: string;
  criteria: CriterionRating[];
};
export type DashboardView = {
  dashboardId: string;
  label: string;
  basis: string;
  pct: number | null;
  band: DashboardBand | null;
  ratedWeight: number;
  totalWeight: number;
  dimensions: DashboardDimension[];
};

export function dashboardBandFor(pct: number): DashboardBand {
  for (const b of DASHBOARD_BANDS) if (pct >= b.minPct) return b.band;
  return "weak";
}
const BAND_WORD: Record<DashboardBand, string> = { strong: "Strong", workable: "Workable", weak: "Weak" };

/** "RQC-3" -> 3; a release name without a number sorts before every numbered one. */
const releaseNumber = (r: string) => Number(/(\d+)$/.exec(r)?.[1] ?? -1);

type Obs = Pick<ObservationView, "criterionId" | "status" | "payload">;
type StepState = (criterionId: string) => "done" | "pending" | "failed";

/** The dimensions a definition has, as category-shaped groups (a one-criterion dimension is a group of one). */
function groupsOf(d: DashboardDefinition): Category[] {
  return d.categories ?? d.criteria.map((c) => ({ categoryId: c, label: "", weight: d.weights[c] ?? 1, criteria: [c] }));
}

/**
 * The dashboards for one review. A dashboard applies when the review was made under its release or
 * a later one and at least one of its criteria was selected for the review (a brief dashboard needs a
 * brief); reviews made earlier get none, and the screen says so. Criteria not selected for the review
 * are left out of the dashboard entirely, and a category with none selected is dropped.
 */
export function reviewDashboards(input: { criteriaRelease: string; selectedCriteria: string[]; observations: Obs[]; assessState: StepState }): DashboardView[] {
  const selected = new Set(input.selectedCriteria);
  return DASHBOARDS.filter((d) => releaseNumber(input.criteriaRelease) >= releaseNumber(d.sinceRelease) && groupsOf(d).some((g) => g.criteria.some((c) => selected.has(c)))).map((d) =>
    scoreDashboard(d, selected, input.observations, input.assessState),
  );
}

function rateCriterion(criterionId: string, observations: Obs[], assessState: StepState): CriterionRating {
  const rated = observations
    .filter((o) => o.criterionId === criterionId && o.status !== "dismissed" && typeof o.payload.rating?.score === "number")
    .sort((a, b) => a.payload.rating!.score! - b.payload.rating!.score!);
  const lowest = rated[0];
  if (!lowest) {
    const step = assessState(criterionId);
    return { criterionId, state: step === "done" ? "not_rated" : step, score: null, label: step === "pending" ? "Not rated yet" : step === "failed" ? "Could not be rated" : "Not rated", reason: "" };
  }
  const score = lowest.payload.rating!.score!;
  return { criterionId, state: "rated", score, label: lowest.payload.rating!.label || SCALE_LABEL[String(score)] || "", reason: lowest.payload.rating!.reason };
}

export function scoreDashboard(d: DashboardDefinition, selected: Set<string>, observations: Obs[], assessState: StepState): DashboardView {
  let points = 0;
  let ratedWeight = 0;
  let totalWeight = 0;
  const dimensions: DashboardDimension[] = [];
  for (const g of groupsOf(d)) {
    const criteria = g.criteria.filter((c) => selected.has(c)).map((c) => rateCriterion(c, observations, assessState));
    if (criteria.length === 0) continue;
    totalWeight += g.weight;
    const rated = criteria.filter((c) => c.state === "rated");
    const single = d.categories === null;
    if (rated.length === 0) {
      const first = criteria[0];
      // A category is pending while any of its criteria still are; otherwise failed if any failed.
      const state: DimensionState = criteria.some((c) => c.state === "pending") ? "pending" : criteria.some((c) => c.state === "failed") ? "failed" : "not_rated";
      dimensions.push({ dimensionId: g.categoryId, categoryLabel: single ? null : g.label, weight: g.weight, state, score: null, label: single ? first.label : state === "pending" ? "Not rated yet" : state === "failed" ? "Could not be rated" : "Not rated", reason: "", criteria });
      continue;
    }
    const score = rated.reduce((n, c) => n + c.score!, 0) / rated.length;
    points += g.weight * score;
    ratedWeight += g.weight;
    dimensions.push({
      dimensionId: g.categoryId,
      categoryLabel: single ? null : g.label,
      weight: g.weight,
      state: "rated",
      score,
      label: single ? rated[0].label : BAND_WORD[dashboardBandFor((score / MAX_CRITERION_SCORE) * 100)],
      reason: single ? rated[0].reason : "",
      criteria,
    });
  }
  const enough = totalWeight > 0 && ratedWeight / totalWeight >= MIN_RATED_WEIGHT_SHARE;
  const pct = enough && ratedWeight > 0 ? Math.round((points / (ratedWeight * MAX_CRITERION_SCORE)) * 100) : null;
  return { dashboardId: d.dashboardId, label: d.label, basis: d.basis, pct, band: pct === null ? null : dashboardBandFor(pct), ratedWeight, totalWeight, dimensions };
}
