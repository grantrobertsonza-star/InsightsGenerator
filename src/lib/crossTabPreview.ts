// A lightweight, purely descriptive preview of a banner plan's shape, meant
// to be looked at before saving a plan or clicking "Compute banner
// comparisons" -- nothing here runs a significance test or writes a
// finding, it only counts and averages, so a degenerate plan (a banner or
// stub column that's really a continuous measurement with dozens of
// near-unique values, say) is visible at a glance instead of discovered
// after generating hundreds of meaningless findings.
//
// A true cross-tabulation (a count/frequency grid) only makes sense for two
// categorical variables. When the stub column is continuous, this produces
// a group-summary table (n, mean, spread per banner category) instead of a
// frequency grid, since a continuous variable has no discrete cells to
// count into -- forcing it into a cross-tab grid would be the same
// statistical error bannerPlanComputation.ts's own numeric-vs-categorical
// branch exists to avoid. Reuses that module's own category list, numeric
// check, and cardinality cap so the preview always reflects exactly what
// the real computation will do with the same plan.

import { distinctCategories, isNumericColumn, MAX_CATEGORY_CARDINALITY } from "./bannerPlanComputation";
import { oneWayAnova } from "./stats";

type Row = Record<string, string | number | null>;

export type CategoricalCrossTab = {
  kind: "categorical";
  bannerColumn: string;
  stubColumn: string;
  bannerCategories: string[];
  stubCategories: string[];
  // counts[i][j] is the count of rows where bannerColumn = bannerCategories[i]
  // and stubColumn = stubCategories[j].
  counts: number[][];
  rowTotals: number[];
  bannerTruncated: boolean;
  stubTruncated: boolean;
  // True when the banner column is itself a continuous numeric measurement
  // (it only lands in this categorical branch because the STUB happened to
  // be categorical) -- a cross-tab grid built from one-reading-per-row
  // "categories" is never meaningful, independent of how many distinct
  // values there happen to be, so this is called out as its own warning
  // rather than folded into the cardinality-truncation one.
  bannerIsNumeric: boolean;
};

export type NumericGroupSummary = {
  kind: "numeric";
  bannerColumn: string;
  stubColumn: string;
  bannerCategories: string[];
  n: number[];
  mean: (number | null)[];
  stdDev: (number | null)[];
  bannerTruncated: boolean;
  // Only set when there are more than two banner categories, matching
  // bannerPlanComputation.ts's own rule for when an omnibus ANOVA runs
  // instead of a single pairwise comparison.
  anova: { fStat: number | null; pValue: number | null; significant: boolean } | null;
};

export type CrossTabPreviewTable = CategoricalCrossTab | NumericGroupSummary;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function sampleStdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return round(Math.sqrt(variance));
}

/**
 * Builds one preview table per banner x stub pairing, every pairing at
 * once (not one at a time), matching how the real computation and the
 * Findings list both already surface every pairing together. Capped at the
 * same MAX_CATEGORY_CARDINALITY bannerPlanComputation.ts uses, with a
 * truncated flag so a column with more categories than that cap shows up
 * as visibly cut off rather than silently incomplete.
 */
export function computeCrossTabPreview(
  rows: Row[],
  bannerColumns: string[],
  stubColumns: string[]
): CrossTabPreviewTable[] {
  const tables: CrossTabPreviewTable[] = [];

  for (const bannerColumn of bannerColumns) {
    const allBannerCategories = distinctCategories(rows, bannerColumn);
    const bannerCategories = allBannerCategories.slice(0, MAX_CATEGORY_CARDINALITY);
    const bannerTruncated = allBannerCategories.length > bannerCategories.length;
    if (bannerCategories.length === 0) continue;

    const groupsByCategory = new Map<string, Row[]>();
    for (const category of bannerCategories) {
      groupsByCategory.set(
        category,
        rows.filter((row) => String(row[bannerColumn]) === category)
      );
    }

    for (const stubColumn of stubColumns) {
      if (stubColumn === bannerColumn) continue;

      if (isNumericColumn(rows, stubColumn)) {
        const n: number[] = [];
        const mean: (number | null)[] = [];
        const stdDev: (number | null)[] = [];
        const valuesByCategory: number[][] = [];
        for (const category of bannerCategories) {
          const values = (groupsByCategory.get(category) ?? [])
            .map((row) => row[stubColumn])
            .filter((value): value is number => typeof value === "number");
          n.push(values.length);
          mean.push(values.length > 0 ? round(values.reduce((a, b) => a + b, 0) / values.length) : null);
          stdDev.push(sampleStdDev(values));
          valuesByCategory.push(values);
        }
        let anova: NumericGroupSummary["anova"] = null;
        if (bannerCategories.length > 2) {
          const result = oneWayAnova(bannerCategories.map((category, i) => ({ label: category, values: valuesByCategory[i] })));
          anova = { fStat: result.fStat, pValue: result.pValue, significant: result.significant };
        }
        tables.push({ kind: "numeric", bannerColumn, stubColumn, bannerCategories, n, mean, stdDev, bannerTruncated, anova });
      } else {
        const allStubCategories = distinctCategories(rows, stubColumn);
        const stubCategories = allStubCategories.slice(0, MAX_CATEGORY_CARDINALITY);
        const stubTruncated = allStubCategories.length > stubCategories.length;

        const counts: number[][] = [];
        const rowTotals: number[] = [];
        for (const category of bannerCategories) {
          const groupRows = groupsByCategory.get(category) ?? [];
          rowTotals.push(groupRows.length);
          counts.push(stubCategories.map((stubCategory) => groupRows.filter((row) => String(row[stubColumn]) === stubCategory).length));
        }
        tables.push({
          kind: "categorical",
          bannerColumn,
          stubColumn,
          bannerCategories,
          stubCategories,
          counts,
          rowTotals,
          bannerTruncated,
          stubTruncated,
          bannerIsNumeric: isNumericColumn(rows, bannerColumn),
        });
      }
    }
  }

  return tables;
}
