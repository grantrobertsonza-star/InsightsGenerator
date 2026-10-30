// Where each driver stands today, for the importance against performance view (D2b, 28 October 2026 plan: "relative
// importance against each predictor's performance on its own scale (top-two share or mean); binary indicators are
// shown with their share, not a mean; predictors on different scales are not placed on one performance axis without a
// caution"). One rule for the whole file, for each segment, and for stated importance.
//
// The measure is read from the predictor's answer domain, never from the answers that happen to be present (Codex
// T2-F01, 30 October 2026: a declared 1 to 5 scale answered only 4 and 5 read as a mean, and a declared 0 to 10 scale
// answered only 0 and 1 read as a 0/1 indicator). The domain is the engine's (driver_columns `answerDomain`, owner
// `_non_answer_codes`, claude/answer-domain.md):
//   - "declared": the file's answer list (non-answers such as Don't know and user-missing codes left out) together
//     with every observed answer. A scale point nobody chose still sets the scale's range.
//   - "observed": no answer list, so only the answers present; said with every result (domainSource), because the
//     measure can change when answers not seen before appear.
// Given the domain:
//   - Every code 0 or 1: an indicator, the share answering 1 (measure "share").
//   - Whole-number codes spanning 3 to 11 points (a declared list labelling only the end points still spans its
//     range): the share in the top two points of the scale, counted down from the domain's top, and the mean
//     (measure "topTwo"). An observed domain also needs 3 or more different answers, as before, since two observed
//     codes (say 1 and 5) are no evidence of a scale.
//   - Anything else: the mean only.
// Weighted when the analysis is weighted; cases are those with an outcome and an answer to the predictor (the caller
// chooses them). No answers: mean and top two are unknown (null), never 0.
export type AnswerDomain = {
  source: "declared" | "observed";
  min: number;
  max: number;
  /** Number of different codes in the domain. */
  count: number;
  integers: boolean;
};
export type PredictorScale = {
  min: number;
  max: number;
  distinct: number;
  /** The engine's answer domain; absent from columns that did not come from driver_columns (the observed fallback). */
  answerDomain?: AnswerDomain;
  valueLabels?: Record<string, string>;
};
export type PerformanceMeasure = "share" | "topTwo" | "mean";

export type PredictorPerformance = {
  mean: number | null;
  topTwo: number | null;
  /** The figure the performance axis reads. */
  measure: PerformanceMeasure;
  /** The scale the top two counted from (topTwo only, else null): its lowest and highest code. */
  scaleTop: number | null;
  scaleMin: number | null;
  /** Whether the scale top is the declared answer list's (true) or the highest answer seen (false); null when not a scale. */
  scaleStated: boolean | null;
  /** Where the measure was read from: the declared answer list, or only the answers present (the fallback). */
  domainSource: AnswerDomain["source"];
};

/** The domain the measure is read from: the engine's, else the observed answers (explicitly marked "observed"). */
export function answerDomainOf(p: PredictorScale): AnswerDomain {
  if (p.answerDomain) return p.answerDomain;
  return { source: "observed", min: p.min, max: p.max, count: p.distinct, integers: Number.isInteger(p.min) && Number.isInteger(p.max) };
}

function measureFor(d: AnswerDomain): PerformanceMeasure {
  if (d.min >= 0 && d.max <= 1) return "share";
  const points = d.max - d.min + 1;
  const enoughCodes = d.source === "declared" || d.count >= 3;
  return d.integers && enoughCodes && points >= 3 && points <= 11 ? "topTwo" : "mean";
}

/**
 * The default top box for a binary driver outcome (Codex T2-F01, the same answer-domain rule as performance): read from
 * the declared answer list when there is one, so a five-point scale answered only 1 to 4 still has its top box at 4 and
 * 5, not at 3 and 4. An indicator (a domain of two codes) is its top code; any other scale is its top two codes. Without
 * an answer list the observed answers are the domain (source "observed"), as before. `lowest` is the domain's lowest
 * code, against which a chosen top box is checked.
 */
export function outcomeTopBox(o: PredictorScale): { min: number; lowest: number; top: number; source: AnswerDomain["source"] } {
  const d = answerDomainOf(o);
  const twoCodes = d.count === 2 || (d.min >= 0 && d.max <= 1);
  return { min: twoCodes ? d.max : d.max - 1, lowest: d.min, top: d.max, source: d.source };
}

export function predictorPerformance(p: PredictorScale, vals: number[], ws: number[]): PredictorPerformance {
  const d = answerDomainOf(p);
  const sw = ws.reduce((a, b) => a + b, 0);
  const mean = vals.length > 0 && sw > 0 ? vals.reduce((a, v, i) => a + v * ws[i], 0) / sw : null;
  const measure = measureFor(d);
  if (measure !== "topTwo") return { mean, topTwo: null, measure, scaleTop: null, scaleMin: null, scaleStated: null, domainSource: d.source };
  const topTwo = vals.length > 0 && sw > 0 ? vals.reduce((a, v, i) => a + (v >= d.max - 1 ? ws[i] : 0), 0) / sw : null;
  return { mean, topTwo, measure, scaleTop: d.max, scaleMin: d.min, scaleStated: d.source === "declared", domainSource: d.source };
}

/**
 * Whether the predictors can share one performance axis: "same" when every one is read the same way on the same scale
 * (all indicators, or all top-two on scales of the same length), else "mixed", which the view must state. The scale
 * length is the answer domain's (scaleTop - scaleMin), so a sparse declared 1 to 5 sits with a full one. Means are on
 * one axis only when their domains have the same range; `scales` supplies them, in the same order as `perf`.
 */
export function performanceScales(
  perf: Pick<Partial<PredictorPerformance>, "measure" | "scaleTop" | "scaleMin">[],
  scales: PredictorScale[] = [],
): "same" | "mixed" {
  const kinds = new Set(perf.map((x) => x.measure ?? "mean"));
  if (kinds.size > 1) return "mixed";
  if (kinds.has("topTwo")) {
    const lengths = new Set(perf.map((x) => (x.scaleTop ?? 0) - (x.scaleMin ?? 0)));
    return lengths.size > 1 ? "mixed" : "same";
  }
  if (kinds.has("mean")) {
    if (scales.length !== perf.length) return "mixed"; // ranges unknown: not claimed to be one axis
    const ranges = new Set(scales.map((s) => { const d = answerDomainOf(s); return `${d.min}-${d.max}`; }));
    return ranges.size > 1 ? "mixed" : "same";
  }
  return "same";
}
