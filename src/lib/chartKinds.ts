/**
 * Which histogram a numeric question gets in the Analytics charts (Grant, 2026-10-20). The engine
 * tabulates a numeric question as answer categories unless it has no value labels and more than 25
 * distinct values (NUMERIC_AS_CATEGORIES_MAX in api/parse-stats-file.py); only then does it return
 * histogram bins. So a scale such as 0 to 10 is drawn with one bar per answer value, and an age or an
 * income with the engine's bins. The rule here only labels the chart; the figures are the engine's.
 */
export const NUMERIC_AS_CATEGORIES_MAX = 25;

export function histogramSource(v: { labelled: boolean; nDistinct: number }): "bins" | "values" {
  return !v.labelled && v.nDistinct > NUMERIC_AS_CATEGORIES_MAX ? "bins" : "values";
}

export const HISTOGRAM_SOURCE_NOTE: Record<"bins" | "values", string> = {
  bins: "Bins from the engine: each bar is a range of values.",
  values: "One bar per answer value, in the order of the values.",
};
