// The same statistical checks used throughout the pipeline, implemented
// once here so every agent step calls real arithmetic rather than asking
// the model to compute it inside a prompt.

const Z_SCORES = { 90: 1.645, 95: 1.96, 99: 2.576 } as const;

export function marginOfError(n: number, p: number, confidence: 90 | 95 | 99 = 95) {
  if (n <= 0) throw new Error("sample_size must be positive");
  const z = Z_SCORES[confidence];
  const moe = z * Math.sqrt((p * (1 - p)) / n);
  return { marginOfErrorPercent: Math.round(moe * 1000) / 10, z, confidence };
}

export function designEffect(weights: number[]) {
  const mean = weights.reduce((a, b) => a + b, 0) / weights.length;
  const variance = weights.reduce((a, w) => a + (w - mean) ** 2, 0) / weights.length;
  const cv = Math.sqrt(variance) / mean;
  return { designEffect: Math.round((1 + cv ** 2) * 100) / 100 };
}

export type BaseSizeTag = "base_size_small" | "base_size_borderline" | null;

export function checkBaseSize(n: number, segmentName: string): { flag: string | null; tag: BaseSizeTag } {
  // No formal ESOMAR/MRS/Insights Association numeric floor exists; these
  // bands are informal conventions only. Never surface this as a standards
  // violation, only as a caution. A 50-99 base is treated as usable without
  // comment, same as 100+; only below 50 gets flagged, since below 30 and
  // the 30-49 band carry meaningfully different confidence even though
  // neither is a hard cutoff.
  if (n < 30) {
    return {
      tag: "base_size_small",
      flag: `${segmentName} has a base size of ${n}, below the informal n=30 caution threshold.`,
    };
  }
  if (n < 50) {
    return {
      tag: "base_size_borderline",
      flag: `${segmentName} has a base size of ${n}, in the borderline 30-49 range: usable but weaker than a medium or large base.`,
    };
  }
  return { tag: null, flag: null };
}

export function twoProportionGap(n1: number, p1: number, n2: number, p2: number, confidence: 90 | 95 | 99 = 95) {
  const z = Z_SCORES[confidence];
  const pPool = (p1 * n1 + p2 * n2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (se === 0) return { gapPercent: Math.round((p1 - p2) * 1000) / 10, zScore: null as number | null, significant: false };
  const zObs = (p1 - p2) / se;
  return {
    gapPercent: Math.round((p1 - p2) * 1000) / 10,
    zScore: Math.round(zObs * 100) / 100,
    significant: Math.abs(zObs) >= z,
  };
}

export function flagOutlier(value: number, comparisonValues: number[]) {
  if (comparisonValues.length < 3) return { flag: null as string | null };
  const mean = comparisonValues.reduce((a, b) => a + b, 0) / comparisonValues.length;
  const variance = comparisonValues.reduce((a, v) => a + (v - mean) ** 2, 0) / comparisonValues.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return { flag: null as string | null };
  const z = (value - mean) / sd;
  return Math.abs(z) >= 2
    ? { flag: `Value ${value} is ${Math.round(z * 10) / 10} SD from the comparison mean of ${Math.round(mean * 10) / 10}. Descriptive heuristic, not a formal outlier test.` }
    : { flag: null as string | null };
}

export function pearsonCorrelation(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n !== ys.length || n < 3) throw new Error("need matched lists of at least 3 pairs");
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  const cov = xs.reduce((a, x, i) => a + (x - meanX) * (ys[i] - meanY), 0);
  const sdX = Math.sqrt(xs.reduce((a, x) => a + (x - meanX) ** 2, 0));
  const sdY = Math.sqrt(ys.reduce((a, y) => a + (y - meanY) ** 2, 0));
  if (sdX === 0 || sdY === 0) return { r: null as number | null };
  return { r: Math.round((cov / (sdX * sdY)) * 100) / 100, note: "descriptive association only; not evidence of causation" };
}

// Approximate thresholds for Welch's t, reused from the same Z_SCORES table
// rather than a true t-distribution lookup. With the group sizes this
// pipeline actually sees (rarely under a dozen per side, often far more),
// the t and normal distributions are close enough that this stays a fair
// descriptive heuristic, consistent with flagOutlier's and twoProportionGap's
// own z-based thresholds elsewhere in this file -- not a claim of exact
// statistical rigor.
const APPROX_T_THRESHOLDS = Z_SCORES;

/**
 * Compares the means of two numeric groups (Welch's t-test, unequal
 * variances assumed), the continuous-outcome counterpart to
 * twoProportionGap's binary/proportion comparison. Used for a numeric
 * column split by a category -- "do Region=East rows average higher
 * satisfaction than the rest?" -- rather than a yes/no rate.
 */
export function compareGroupMeans(group1: number[], group2: number[], confidence: 90 | 95 | 99 = 95) {
  if (group1.length < 2 || group2.length < 2) {
    return { mean1: null as number | null, mean2: null as number | null, gap: null as number | null, tScore: null as number | null, significant: false };
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = (xs: number[], m: number) => xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  const m1 = mean(group1);
  const m2 = mean(group2);
  const v1 = variance(group1, m1);
  const v2 = variance(group2, m2);
  const se = Math.sqrt(v1 / group1.length + v2 / group2.length);
  const mean1 = Math.round(m1 * 100) / 100;
  const mean2 = Math.round(m2 * 100) / 100;
  const gap = Math.round((m1 - m2) * 100) / 100;
  if (se === 0) return { mean1, mean2, gap, tScore: null as number | null, significant: false };
  const t = (m1 - m2) / se;
  return {
    mean1,
    mean2,
    gap,
    tScore: Math.round(t * 100) / 100,
    significant: Math.abs(t) >= APPROX_T_THRESHOLDS[confidence],
  };
}

export type DecisionStumpResult = {
  splitColumn: string;
  outcomeColumn: string;
  splitDescription: string;
  group1Indices: number[];
  group1Mean: number;
  group2Indices: number[];
  group2Mean: number;
  gap: number;
  tScore: number;
};

/**
 * A single-level decision stump: searches one candidate splitting column
 * (numeric, tried at every midpoint between its distinct sorted values; or
 * categorical, tried as each category versus everything else) for whichever
 * split most separates a numeric outcome column, via compareGroupMeans.
 * Deliberately not a full decision tree -- one split, picked because it's
 * the strongest this table actually supports for this outcome, not because
 * it was assumed in advance. Returns null when no split clears both the
 * minimum group size and the significance threshold.
 */
export function findBestStumpSplit(
  rows: Record<string, string | number | null>[],
  splitColumn: string,
  outcomeColumn: string,
  minGroupSize = 5
): DecisionStumpResult | null {
  const pairs = rows
    .map((row, index) => ({ index, split: row[splitColumn], outcome: row[outcomeColumn] }))
    .filter(
      (p): p is { index: number; split: string | number; outcome: number } =>
        p.split !== null && p.split !== undefined && typeof p.outcome === "number"
    );

  if (pairs.length < minGroupSize * 2) return null;

  const splitIsNumeric = pairs.every((p) => typeof p.split === "number");

  type Candidate = { label: string; group1: typeof pairs; group2: typeof pairs };
  const candidates: Candidate[] = [];

  if (splitIsNumeric) {
    const uniqueSorted = Array.from(new Set(pairs.map((p) => p.split as number))).sort((a, b) => a - b);
    for (let i = 0; i < uniqueSorted.length - 1; i++) {
      const threshold = (uniqueSorted[i] + uniqueSorted[i + 1]) / 2;
      const group1 = pairs.filter((p) => (p.split as number) < threshold);
      const group2 = pairs.filter((p) => (p.split as number) >= threshold);
      if (group1.length >= minGroupSize && group2.length >= minGroupSize) {
        candidates.push({ label: `${splitColumn} < ${Math.round(threshold * 100) / 100}`, group1, group2 });
      }
    }
  } else {
    const categories = Array.from(new Set(pairs.map((p) => String(p.split))));
    for (const category of categories) {
      const group1 = pairs.filter((p) => String(p.split) === category);
      const group2 = pairs.filter((p) => String(p.split) !== category);
      if (group1.length >= minGroupSize && group2.length >= minGroupSize) {
        candidates.push({ label: `${splitColumn} = "${category}"`, group1, group2 });
      }
    }
  }

  let best: { candidate: Candidate; mean1: number; mean2: number; gap: number; tScore: number } | null = null;

  for (const candidate of candidates) {
    const comparison = compareGroupMeans(
      candidate.group1.map((p) => p.outcome),
      candidate.group2.map((p) => p.outcome)
    );
    if (comparison.tScore === null || comparison.mean1 === null || comparison.mean2 === null) continue;
    if (!best || Math.abs(comparison.tScore) > Math.abs(best.tScore)) {
      best = { candidate, mean1: comparison.mean1, mean2: comparison.mean2, gap: comparison.gap ?? 0, tScore: comparison.tScore };
    }
  }

  if (!best) return null;
  // Reuse the 95%-confidence threshold as the bar for "worth surfacing as a
  // pattern" -- the same bar compareGroupMeans itself uses by default.
  if (Math.abs(best.tScore) < APPROX_T_THRESHOLDS[95]) return null;

  return {
    splitColumn,
    outcomeColumn,
    splitDescription: best.candidate.label,
    group1Indices: best.candidate.group1.map((p) => p.index),
    group1Mean: best.mean1,
    group2Indices: best.candidate.group2.map((p) => p.index),
    group2Mean: best.mean2,
    gap: best.gap,
    tScore: best.tScore,
  };
}

// ---------------------------------------------------------------------------
// One-way ANOVA: the correct omnibus test for "does this numeric outcome
// differ across these groups overall", for a banner column with MORE than
// two categories (bannerPlanComputation.ts uses compareGroupMeans directly
// when there are exactly two, since an ANOVA across two groups reduces to
// the same comparison). Unlike every other threshold in this file, which
// approximates with a z-score lookup, the F-distribution's shape depends on
// both degrees of freedom, so there's no small fixed table to reuse -- this
// computes a real p-value via the regularized incomplete beta function
// (Numerical Recipes' betacf/betai, the standard approach when no stats
// library is available), rather than a cruder approximation.
// ---------------------------------------------------------------------------

function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const xm1 = x - 1;
  let a = c[0];
  const t = xm1 + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (xm1 + i);
  return 0.5 * Math.log(2 * Math.PI) + (xm1 + 0.5) * Math.log(t) - t + Math.log(a);
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const MAX_ITERATIONS = 200;
  const EPSILON = 3e-9;
  const MIN_VALUE = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < MIN_VALUE) d = MIN_VALUE;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITERATIONS; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < MIN_VALUE) d = MIN_VALUE;
    c = 1 + aa / c;
    if (Math.abs(c) < MIN_VALUE) c = MIN_VALUE;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < MIN_VALUE) d = MIN_VALUE;
    c = 1 + aa / c;
    if (Math.abs(c) < MIN_VALUE) c = MIN_VALUE;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPSILON) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b), used below to turn an
 * F-statistic into a real p-value. */
function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const logBt = logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const bt = Math.exp(logBt);
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (bt * betaContinuedFraction(1 - x, b, a)) / b;
}

/** The upper-tail p-value for an F-statistic with (d1, d2) degrees of
 * freedom: P(F >= f). */
export function fTestPValue(f: number, d1: number, d2: number): number {
  if (f <= 0 || d1 <= 0 || d2 <= 0) return 1;
  const x = d2 / (d2 + d1 * f);
  return regularizedIncompleteBeta(x, d2 / 2, d1 / 2);
}

/**
 * One-way ANOVA across any number of groups: tests whether a numeric
 * outcome's mean genuinely differs across all of them at once, the single
 * omnibus comparison market-research convention runs before (not instead
 * of) pairwise post-hoc comparisons when a banner column has more than two
 * categories. Groups with fewer than 2 values are dropped rather than
 * failing the whole test, same tolerance compareGroupMeans has for a group
 * too small to have a variance.
 */
export function oneWayAnova(
  groups: { label: string; values: number[] }[],
  confidence: 90 | 95 | 99 = 95
): {
  fStat: number | null;
  pValue: number | null;
  dfBetween: number | null;
  dfWithin: number | null;
  significant: boolean;
  groupMeans: { label: string; n: number; mean: number }[];
} {
  const usable = groups.filter((g) => g.values.length >= 2);
  if (usable.length < 2) {
    return { fStat: null, pValue: null, dfBetween: null, dfWithin: null, significant: false, groupMeans: [] };
  }

  const groupMeansRaw = usable.map((g) => g.values.reduce((a, b) => a + b, 0) / g.values.length);
  const allValues = usable.flatMap((g) => g.values);
  const grandMean = allValues.reduce((a, b) => a + b, 0) / allValues.length;

  const sumSquaresBetween = usable.reduce(
    (sum, g, i) => sum + g.values.length * (groupMeansRaw[i] - grandMean) ** 2,
    0
  );
  const sumSquaresWithin = usable.reduce(
    (sum, g, i) => sum + g.values.reduce((s, v) => s + (v - groupMeansRaw[i]) ** 2, 0),
    0
  );

  const dfBetween = usable.length - 1;
  const dfWithin = allValues.length - usable.length;
  const groupMeans = usable.map((g, i) => ({
    label: g.label,
    n: g.values.length,
    mean: Math.round(groupMeansRaw[i] * 100) / 100,
  }));

  if (dfWithin <= 0) {
    return { fStat: null, pValue: null, dfBetween, dfWithin, significant: false, groupMeans };
  }

  const meanSquareBetween = sumSquaresBetween / dfBetween;
  const meanSquareWithin = sumSquaresWithin / dfWithin;

  if (meanSquareWithin === 0) {
    // Every group has zero internal spread: any non-zero gap between group
    // means is as significant a difference as this data can show.
    const significant = meanSquareBetween > 0;
    return { fStat: null, pValue: significant ? 0 : 1, dfBetween, dfWithin, significant, groupMeans };
  }

  const fStat = meanSquareBetween / meanSquareWithin;
  const pValue = fTestPValue(fStat, dfBetween, dfWithin);
  const alpha = confidence === 90 ? 0.1 : confidence === 99 ? 0.01 : 0.05;

  return {
    fStat: Math.round(fStat * 100) / 100,
    pValue: Math.round(pValue * 1000) / 1000,
    dfBetween,
    dfWithin,
    significant: pValue < alpha,
    groupMeans,
  };
}
