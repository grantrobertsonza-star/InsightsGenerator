// The earlier stage of the findings-charting pipeline (2026-10-05 decision):
// a researcher staring at a freshly uploaded raw table has no help reading
// its shape until they've already named a banner plan and computed it --
// buildChartForThemeGroup (findingsChartData.ts) only ever has something to
// chart once that step has run. This module runs no statistical test and
// makes no comparison; it just describes each column on its own (a
// distribution, or a five-number-ish summary), the same way a researcher's
// own first pass over a new dataset usually starts. Nothing here writes
// anything or requires a banner plan -- it reads straight off the same
// headers/rows document_tables already has, for a raw OR an aggregated
// table alike, immediately on upload.

export type Row = Record<string, string | number | null>;

export type CategoricalDigest = {
  kind: "categorical";
  column: string;
  bars: { category: string; count: number; percent: number }[];
  distinctCount: number;
  n: number;
  // True once categories ran past MAX_CATEGORIES_SHOWN -- the chart below
  // only shows the top N by frequency, folding the rest into "Other" rather
  // than silently dropping them, so the bar heights still read as the whole
  // column.
  otherCount: number;
};

export type NumericDigest = {
  kind: "numeric";
  column: string;
  n: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  // Pre-binned so the chart is a plain bar chart (consistent with the rest
  // of this feature's non-negotiable "no dual-axis, no cleverness" marks)
  // rather than asking Plot to bin on the fly from a value array repeated
  // into every render.
  bins: { from: number; to: number; count: number }[];
};

export type SkippedDigest = {
  kind: "skipped";
  column: string;
  reason: "too_many_distinct_values" | "no_usable_values";
};

export type ColumnDigest = CategoricalDigest | NumericDigest | SkippedDigest;

// Same reasoning as tableComputation.ts/bannerPlanComputation.ts's own
// bounds: a wide table doesn't get 40 columns charted, and an ID-like or
// free-text column (hundreds of distinct values) never gets mistaken for a
// categorical one.
const MAX_COLUMNS_EXAMINED = 15;
const MAX_CATEGORY_CARDINALITY = 10;
const MAX_CATEGORIES_SHOWN = 8;
const MIN_USABLE_VALUES = 3;
const TARGET_BIN_COUNT = 10;

function presentValues(rows: Row[], column: string): (string | number)[] {
  return rows
    .map((row) => row[column])
    .filter(
      (v): v is string | number => v !== null && v !== undefined && v !== "",
    );
}

function isNumericColumn(values: (string | number)[]): boolean {
  if (values.length < MIN_USABLE_VALUES) return false;
  return values.every((v) => typeof v === "number");
}

function buildHistogramBins(
  values: number[],
): { from: number; to: number; count: number }[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [{ from: min, to: max, count: values.length }];
  }
  const binCount = Math.min(
    TARGET_BIN_COUNT,
    Math.max(3, Math.round(Math.sqrt(values.length))),
  );
  const width = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    from: Math.round((min + i * width) * 100) / 100,
    to: Math.round((min + (i + 1) * width) * 100) / 100,
    count: 0,
  }));
  for (const v of values) {
    const idx = Math.min(binCount - 1, Math.floor((v - min) / width));
    bins[idx].count++;
  }
  return bins;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  const m =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(m * 100) / 100;
}

function digestColumn(rows: Row[], column: string): ColumnDigest {
  const values = presentValues(rows, column);
  if (values.length < MIN_USABLE_VALUES) {
    return { kind: "skipped", column, reason: "no_usable_values" };
  }

  if (isNumericColumn(values)) {
    const numbers = (values as number[]).slice().sort((a, b) => a - b);
    const mean =
      Math.round((numbers.reduce((a, b) => a + b, 0) / numbers.length) * 100) /
      100;
    return {
      kind: "numeric",
      column,
      n: numbers.length,
      mean,
      median: median(numbers),
      min: numbers[0],
      max: numbers[numbers.length - 1],
      bins: buildHistogramBins(numbers),
    };
  }

  const asStrings = values.map((v) => String(v));
  const counts = new Map<string, number>();
  for (const v of asStrings) counts.set(v, (counts.get(v) ?? 0) + 1);
  if (counts.size > MAX_CATEGORY_CARDINALITY) {
    return { kind: "skipped", column, reason: "too_many_distinct_values" };
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const shown = sorted.slice(0, MAX_CATEGORIES_SHOWN);
  const rest = sorted.slice(MAX_CATEGORIES_SHOWN);
  const otherCount = rest.reduce((a, [, c]) => a + c, 0);
  const n = asStrings.length;
  const bars = shown.map(([category, count]) => ({
    category,
    count,
    percent: Math.round((count / n) * 1000) / 10,
  }));
  if (otherCount > 0) {
    bars.push({
      category: "Other",
      count: otherCount,
      percent: Math.round((otherCount / n) * 1000) / 10,
    });
  }

  return {
    kind: "categorical",
    column,
    bars,
    distinctCount: counts.size,
    n,
    otherCount,
  };
}

/**
 * One digest per column, in header order, capped to MAX_COLUMNS_EXAMINED.
 * Pure and synchronous -- cheap enough to run on every render of a table
 * preview rather than needing its own server round-trip or cache.
 */
export function buildTableDigest(
  headers: string[],
  rows: Row[],
): ColumnDigest[] {
  return headers
    .slice(0, MAX_COLUMNS_EXAMINED)
    .map((column) => digestColumn(rows, column));
}
