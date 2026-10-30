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

// ---------------------------------------------------------------- predictor identity (Codex AN500-F01)

/**
 * A driver report's display name for each predictor, unique within the report. A predictor's label
 * when no other predictor has taken it, otherwise "<label> (<code>)"; every name is reserved as it
 * is given, and every label is reserved up front, so a generated name can never land on another
 * predictor's label or name. For codes X1, X2, X3 labelled "Service", "Service", "Service (X2)" this
 * gives "Service", "Service (X2) (2)", "Service (X2)": the earlier rule gave X2 and X3 both
 * "Service (X2)", and joins by name then showed X2's mean for X3. Names are for reading only; a
 * report also records each predictor's code (`variable`), and every join uses that.
 */
export function driverDisplayNames(predictors: readonly { name: string; label: string }[]): string[] {
  const bases = predictors.map((p) => (p.label || p.name).trim());
  const reserved = new Set(bases);
  const used = new Set<string>();
  return predictors.map((p, i) => {
    const base = bases[i];
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let candidate = `${base} (${p.name})`;
    for (let n = 2; used.has(candidate) || (reserved.has(candidate) && candidate !== base); n += 1) {
      candidate = `${base} (${p.name}) (${n})`;
    }
    used.add(candidate);
    return candidate;
  });
}

type NamedByVariable = { name: string; variable?: string };

/**
 * The record in `list` for a result row: by the predictor's code when both carry one; for a report
 * saved before codes were recorded, by name only when that name is unique on both sides, else null
 * (a colliding name cannot say which predictor it was, so nothing is guessed).
 */
export function recordForRow<T extends NamedByVariable>(row: NamedByVariable, list: readonly T[], rows: readonly NamedByVariable[]): T | null {
  if (row.variable && list.some((x) => x.variable)) return list.find((x) => x.variable === row.variable) ?? null;
  const sameName = list.filter((x) => x.name === row.name);
  const rowsNamed = rows.filter((r) => r.name === row.name);
  return sameName.length === 1 && rowsNamed.length === 1 ? sameName[0] : null;
}

/** True when two of a saved report's result rows share a display name and have no codes to tell them apart. */
export function driverRowsAmbiguous(rows: readonly NamedByVariable[]): boolean {
  if (rows.every((r) => r.variable)) return false;
  return new Set(rows.map((r) => r.name)).size !== rows.length;
}
