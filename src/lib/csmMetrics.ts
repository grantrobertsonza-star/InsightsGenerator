// No "use server" here on purpose: a server-action module (csmActions.ts, which has the
// directive) can only export async functions, so these plain synchronous helpers live in their
// own ordinary module and get imported by both the server actions and the client panel.

import { leadingNumber } from "./descriptiveFindings";
import type { ChartSeries } from "./chartActions";
import type { CsmDashboard, CsmFindingSection } from "./csmActions";

const round1 = (x: number) => Math.round(x * 10) / 10;

/** How an attribute's box score is cut. "mean" reports the average code, not a box. */
export type CsmMetric = "mean" | "top1" | "top2" | "top3";

/**
 * The scale-width default Grant set: a 10-point scale is reported as a mean, a 7-point as
 * top-3-combined, a 5-point as top-2, a 4-point (or narrower) as top-box only. Anything wider
 * than 10 also defaults to a mean, since a bare numeric code with that many points behaves like
 * a continuous measure rather than a labelled scale. This is only ever a default: every
 * attribute in a CSM module's mapping can override it.
 */
export function defaultMetricForScale(points: number): CsmMetric {
  if (points >= 9) return "mean";
  if (points === 7 || points === 8) return "top3";
  if (points === 5 || points === 6) return "top2";
  return "top1";
}

export function metricLabel(metric: CsmMetric): string {
  if (metric === "mean") return "Mean";
  if (metric === "top1") return "Top box";
  if (metric === "top2") return "Top 2 box";
  return "Top 3 box";
}

/**
 * Reduces one series of a distribution (a chart's "All respondents" row, or one segment's
 * row) to a single CSM number: the weighted mean of the bars' leading numeric codes, or the
 * summed share of the top-N codes by value. Bars whose label carries no leading number (an
 * open-ended "Other", say) are dropped from a mean and from the box, not counted as zero.
 */
export function summarizeSeries(series: ChartSeries, metric: CsmMetric): { value: number | null; exact: number | null; base: number } {
  // Overnight queue, package 4 (IMP-004): a labelled scale's display text often carries no
  // leading digit ("Very dissatisfied" ... "Very satisfied"), so deriving the code purely
  // from the label text (leadingNumber) previously returned null for every bar on such a
  // scale even when the chart's own data already carries the real underlying code in
  // rawCode. Prefer rawCode (parsed as a number) when present and numeric; fall back to
  // leadingNumber(label) only when rawCode is absent, unparseable, or not itself numeric -
  // preserving existing behavior for series that never had rawCode populated.
  const codeOf = (b: ChartSeries["bars"][number]): number | null => {
    if (b.rawCode !== undefined && b.rawCode !== null && b.rawCode !== "") {
      const fromRaw = Number(b.rawCode);
      if (Number.isFinite(fromRaw)) return fromRaw;
    }
    return leadingNumber(b.label);
  };
  // CT5K-F01: the mean and the box are added from each bar's unrounded share (the engine's pctExact,
  // carried as `share`) and rounded once at the end, never from the one-decimal display `pct`. A bar the
  // table suppressed (share null) makes this reading unavailable rather than counting as 0. A series
  // built without shares (wave tracking) is read from pct, as before.
  const shareOf = (b: ChartSeries["bars"][number]): number | null => (b.share !== undefined ? b.share : b.pct);
  const codedAll = series.bars.map((b) => ({ code: codeOf(b), pct: shareOf(b) })).filter((b) => b.code !== null);
  if (codedAll.some((b) => b.pct === null)) return { value: null, exact: null, base: series.n };
  const coded = codedAll as { code: number; pct: number }[];
  if (coded.length === 0) return { value: null, exact: null, base: series.n };

  if (metric === "mean") {
    const totalPct = coded.reduce((s, b) => s + b.pct, 0);
    if (totalPct <= 0) return { value: null, exact: null, base: series.n };
    const mean = coded.reduce((s, b) => s + b.code * b.pct, 0) / totalPct;
    return { value: round1(mean), exact: mean, base: series.n };
  }

  const topN = metric === "top1" ? 1 : metric === "top2" ? 2 : 3;
  const ranked = [...coded].sort((a, b) => b.code - a.code).slice(0, topN);
  const value = ranked.reduce((s, b) => s + b.pct, 0);
  // exact: the same figure unrounded, for figures built on it (brand funnel ratios, category averages
  // and gaps); value is the one-decimal display figure.
  return { value: round1(value), exact: value, base: series.n };
}

/** A stable key for the variable(s) a section's finding is about, so re-mapping to a different question posts a new finding rather than silently overwriting the old one. Null when the section has nothing to post yet. */
export function csmFindingKey(dashboard: CsmDashboard, section: CsmFindingSection): string | null {
  if (section === "overall") return dashboard.overall?.variable ?? null;
  if (section === "attributes") return dashboard.attributes.length ? dashboard.attributes.map((a) => a.variable).sort().join("|") : null;
  if (section === "loyalty") return dashboard.loyalty?.variable ?? null;
  return dashboard.driver ? [dashboard.driver.request.outcome, ...dashboard.driver.request.predictors].join("|") : null;
}

/**
 * The share of a series in the given answer codes (Codex D3A-F01): a box on a stated scale (8 to 10 on 0 to 10; the
 * top two on a shorter scale) counts exactly those codes, whichever of them the data holds; an absent one is 0. The
 * base is every answer the series has (non-answer codes are already outside it, as in a Cross tab). A suppressed bar
 * makes the reading unavailable.
 */
export function shareOfCodes(series: ChartSeries, codes: number[]): { value: number | null; exact: number | null; base: number } {
  const want = new Set(codes);
  const bars = series.bars.map((b) => ({ code: b.rawCode !== undefined && b.rawCode !== null && b.rawCode !== "" ? Number(b.rawCode) : leadingNumber(b.label), share: b.share !== undefined ? b.share : b.pct }));
  if (bars.some((b) => b.share === null)) return { value: null, exact: null, base: series.n };
  const exact = bars.filter((b) => b.code !== null && want.has(b.code)).reduce((a, b) => a + (b.share as number), 0);
  return { value: round1(exact), exact, base: series.n };
}

