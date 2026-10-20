import type { DriverReport } from "./drivers";

/**
 * What the Driver analysis results lead with (Grant's review, 2026-10-20): how many of the file's
 * cases the model used, why others were left out, how much of the outcome it explains, and the
 * analysis's own warnings, before any ranking. Display only: every figure and sentence comes from
 * the report the engine returned (driverAnalysis.ts, drivers.ts); nothing is recomputed and no
 * threshold is added here. The warnings are the engine's (for example, under 10% of the variation
 * explained, or under 10 cases per predictor), so they are shown as limitations, not softened.
 */
export type DriverSummary = {
  used: number;
  inFile: number;
  /** used / inFile, 0..1; null when the file's case count is not known. */
  usedShare: number | null;
  weighted: boolean;
  /** The fit in one figure: variation explained (linear) or McFadden pseudo R-squared (logistic). */
  fitFigure: string;
  /** The fit in plain words, never wording the association as cause. */
  fitText: string;
  /** Why cases or questions were left out, from the report. */
  exclusions: string[];
  /** The analysis's other warnings: limitations on how far the ranking can be read. */
  limitations: string[];
};

const pct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : `${Math.round(v * 100)}%`);

// Warnings that say what was left out, as distinct from limits on reading the result.
const EXCLUSION = /left out|missing value/i;

export function driverSummary(report: DriverReport): DriverSummary {
  const r = report.result;
  const binary = r.fit.mcFadden !== null;
  return {
    used: r.n,
    inFile: report.casesInFile,
    usedShare: report.casesInFile > 0 ? r.n / report.casesInFile : null,
    weighted: report.weighted,
    fitFigure: binary ? (r.fit.mcFadden ?? 0).toFixed(2) : pct(r.fit.rSquared),
    fitText: binary
      ? `Pseudo R-squared (McFadden). The model classifies ${pct(r.fit.classificationRate)} of cases correctly, against ${pct(r.fit.baseRate)} by always guessing the larger group.`
      : `of the variation in the outcome is explained by these questions together${r.fit.adjRSquared !== null ? ` (adjusted ${pct(r.fit.adjRSquared)})` : ""}. The rest is not accounted for by them, so a small figure means they explain little.`,
    exclusions: [...report.skipped.map((s) => `Left out: ${s.variable} (${s.reason}).`), ...r.warnings.filter((w) => EXCLUSION.test(w))],
    limitations: r.warnings.filter((w) => !EXCLUSION.test(w)),
  };
}
