// Research Quality Review: the bird's-eye dashboard (Grant, 2026-10-19).
//
// A dashboard combines one document type's criteria (the ten brief dimensions in RQC-3) into a single
// weighted percentage, shown above the per-dimension scores. The model rates each criterion on the
// release's scale (Strong 5, Workable 3, Weak 1, Absent 0) with cited evidence, validated by
// researchQualityRules.ts; everything here is arithmetic on those stored ratings, done by code:
//   dimension score: the criterion's rating; when a criterion has several live observations (one per
//     decision, say), the lowest, so the dashboard never shows a dimension better than its weakest part;
//   overall: sum(weight x score) / sum(weight x 5) over rated dimensions, as a whole percentage;
//   band: Strong >= 80%, Workable >= 60%, Weak below (the release's bands);
//   withheld: with less than half the total weight rated, no overall figure is given.
// A dimension with no rating (not run yet, failed, or dismissed by the researcher) is "not rated" and
// left out of the percentage, never counted as zero; Absent (0) is a real rating and is counted.
// Pure module: no database, no model calls, no Node-only imports, so the screen can use it too.
import release from "../research-quality/criteria/RQC-3.json";
import type { ObservationView } from "./researchQualityView";

export type DashboardDefinition = { dashboardId: string; label: string; sinceRelease: string; criteria: string[]; weights: Record<string, number>; basis: string };
export const DASHBOARDS = release.dashboards as DashboardDefinition[];
export const DASHBOARD_BANDS = release.dashboardBands as { band: DashboardBand; minPct: number }[];
export const MAX_CRITERION_SCORE = 5;
export const MIN_RATED_WEIGHT_SHARE = 0.5;

export type DashboardBand = "strong" | "workable" | "weak";
export type DimensionState = "rated" | "not_rated" | "pending" | "failed";
export type DashboardDimension = {
  criterionId: string;
  weight: number;
  state: DimensionState;
  score: number | null;
  label: string;
  /** The model's reason for the rating (for the hover); empty when not rated. */
  reason: string;
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

/** "RQC-3" -> 3; a release name without a number sorts before every numbered one. */
const releaseNumber = (r: string) => Number(/(\d+)$/.exec(r)?.[1] ?? -1);

/**
 * The dashboards for one review. A dashboard applies when the review was made under its release or
 * a later one and at least one of its criteria was selected for the review (a brief dashboard needs a
 * brief); reviews made earlier get none, and the screen says so. `assessState` is the state of the
 * assessment step for a criterion group ("assess:<group>"), so a dimension still running or failed is
 * shown as such rather than as not rated.
 */
export function reviewDashboards(input: {
  criteriaRelease: string;
  selectedCriteria: string[];
  observations: Pick<ObservationView, "criterionId" | "status" | "payload">[];
  assessState: (criterionId: string) => "done" | "pending" | "failed";
}): DashboardView[] {
  const selected = new Set(input.selectedCriteria);
  return DASHBOARDS.filter((d) => releaseNumber(input.criteriaRelease) >= releaseNumber(d.sinceRelease) && d.criteria.some((c) => selected.has(c))).map((d) =>
    scoreDashboard(
      d,
      d.criteria.filter((c) => selected.has(c)),
      input.observations,
      input.assessState,
    ),
  );
}

export function scoreDashboard(
  d: DashboardDefinition,
  criteria: string[],
  observations: Pick<ObservationView, "criterionId" | "status" | "payload">[],
  assessState: (criterionId: string) => "done" | "pending" | "failed",
): DashboardView {
  let points = 0;
  let possible = 0;
  let ratedWeight = 0;
  let totalWeight = 0;
  const dimensions = criteria.map((criterionId): DashboardDimension => {
    const weight = d.weights[criterionId] ?? 1;
    totalWeight += weight;
    const rated = observations
      .filter((o) => o.criterionId === criterionId && o.status !== "dismissed" && typeof o.payload.rating?.score === "number")
      .sort((a, b) => a.payload.rating!.score! - b.payload.rating!.score!);
    const lowest = rated[0];
    if (!lowest) {
      const step = assessState(criterionId);
      return { criterionId, weight, state: step === "done" ? "not_rated" : step, score: null, label: step === "pending" ? "Not rated yet" : step === "failed" ? "Could not be rated" : "Not rated", reason: "" };
    }
    const score = lowest.payload.rating!.score!;
    points += weight * score;
    possible += weight * MAX_CRITERION_SCORE;
    ratedWeight += weight;
    return { criterionId, weight, state: "rated", score, label: lowest.payload.rating!.label, reason: lowest.payload.rating!.reason };
  });
  const enough = totalWeight > 0 && ratedWeight / totalWeight >= MIN_RATED_WEIGHT_SHARE;
  const pct = enough && possible > 0 ? Math.round((points / possible) * 100) : null;
  return { dashboardId: d.dashboardId, label: d.label, basis: d.basis, pct, band: pct === null ? null : dashboardBandFor(pct), ratedWeight, totalWeight, dimensions };
}
