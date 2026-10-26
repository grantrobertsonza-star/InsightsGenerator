import type { ChartMethod } from "./chartActions";

/**
 * The note under a histogram saying how its bars were made (Grant, 2026-10-20). It is taken from
 * the method the distribution action reports it applied (ChartResult.method), never from the
 * variable's labels or number of distinct values (IR-10): the engine tabulates a numeric question as
 * answer categories unless it has no value labels and more than 25 distinct values, but a
 * researcher's correction (for example marking it categorical) changes that, so only the result
 * knows. No method, no note: a chart that cannot say how it was built says nothing rather than guess.
 */
export const HISTOGRAM_SOURCE_NOTE: Record<ChartMethod, string> = {
  bins: "Bins from the engine: each bar is a range of values.",
  values: "One bar per answer value, in the order of the values.",
};

export function histogramNote(method: ChartMethod | undefined): string | null {
  return method ? HISTOGRAM_SOURCE_NOTE[method] : null;
}
