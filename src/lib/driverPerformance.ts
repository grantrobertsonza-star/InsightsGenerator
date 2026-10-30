// Where each driver stands today, for the importance against performance view (D2b, 28 October 2026 plan: "relative
// importance against each predictor's performance on its own scale (top-two share or mean); binary indicators are
// shown with their share, not a mean; predictors on different scales are not placed on one performance axis without a
// caution"). One rule for the whole file and for each segment.
//   - A 0/1 indicator: the share answering 1 (measure "share").
//   - A scale of 3 to 11 points: the share in its top two answers, the top being the scale's (scaleTop: the highest
//     declared answer, or the highest observed when nothing is declared, said by scaleStated), and the mean.
//   - Anything else: the mean only.
// Weighted when the analysis is weighted; cases are those with an outcome and an answer to the predictor.
export type PredictorScale = { min: number; max: number; distinct: number; scaleTop?: number; scaleStated?: boolean; valueLabels?: Record<string, string> };
export type PerformanceMeasure = "share" | "topTwo" | "mean";

export type PredictorPerformance = {
  mean: number | null;
  topTwo: number | null;
  /** The figure the performance axis reads. */
  measure: PerformanceMeasure;
  /** The top of the scale used for the top two, and whether it is the declared scale (true) or the highest answer seen. */
  scaleTop: number | null;
  scaleStated: boolean | null;
};

const isIndicator = (p: PredictorScale) => p.distinct <= 2 && p.min >= 0 && p.max <= 1;

export function predictorPerformance(p: PredictorScale, vals: number[], ws: number[]): PredictorPerformance {
  const sw = ws.reduce((a, b) => a + b, 0);
  const mean = vals.length > 0 && sw > 0 ? vals.reduce((a, v, i) => a + v * ws[i], 0) / sw : null;
  if (isIndicator(p)) return { mean, topTwo: null, measure: "share", scaleTop: 1, scaleStated: null };
  const top = p.scaleTop ?? p.max;
  const points = top - p.min + 1;
  const scale = p.distinct >= 3 && p.distinct <= 11 && points <= 11;
  if (!scale) return { mean, topTwo: null, measure: "mean", scaleTop: null, scaleStated: null };
  const topTwo = sw > 0 ? vals.reduce((a, v, i) => a + (v >= top - 1 ? ws[i] : 0), 0) / sw : null;
  return { mean, topTwo, measure: "topTwo", scaleTop: top, scaleStated: p.scaleStated ?? null };
}

/**
 * Whether the predictors can share one performance axis: "same" when every one is read the same way on the same scale
 * (all indicators, or all top-two on scales of the same length), else "mixed", which the view must state.
 */
export function performanceScales(perf: PredictorPerformance[], scales: PredictorScale[]): "same" | "mixed" {
  const kinds = new Set(perf.map((x) => x.measure));
  if (kinds.size > 1) return "mixed";
  if (kinds.has("topTwo")) {
    const lengths = new Set(perf.map((x, i) => (x.scaleTop ?? 0) - scales[i].min));
    return lengths.size > 1 ? "mixed" : "same";
  }
  if (kinds.has("mean")) {
    const ranges = new Set(scales.map((s) => `${s.min}-${s.max}`));
    return ranges.size > 1 ? "mixed" : "same";
  }
  return "same";
}
