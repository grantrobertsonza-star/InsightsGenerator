// Tier 1 of the findings-page charting feature (2026-10-05 decision), later
// extended the same evening (2026-10-05) to cover the table-computation
// patterns too, not just banner-plan comparisons: for a theme group of
// code-computed findings -- banner_comparison (bannerPlanComputation.ts),
// or segment_difference/relationship/outlier (tableComputation.ts, the
// no-banner-plan path that runs against an already-aggregated table) --
// build a single chart-ready summary instead of asking the reader to read
// N cards one at a time.
//
// Deliberately scoped to origin: 'generated' findings whose pattern_type is
// one of CHARTABLE_PATTERN_TYPES below: those are the only findings
// carrying structured stated_stats this needs. A finding pulled from a
// report sentence or a transcript (origin 'stated'/'coded') has no such
// structure to chart -- those stay exactly as they are today, cards only.
// Nothing here calls a model; every number comes straight from
// stated_stats, which is itself nothing but arithmetic a prior computation
// step already ran. The captions built below are computed from that same
// arithmetic (a count, a superlative, a coefficient), not written by an
// LLM -- a future, tension-aware AI narrative would plug in on top of these
// same ChartSpecs.
//
// Note on scope: tableComputation.ts's segment_difference/relationship/
// outlier patterns only ever get computed against an "aggregated"
// document_table (see generateFindingsFromTable.ts's own comment) -- a raw,
// case-level upload produces none of these until a banner plan exists, by
// a deliberate 2026-10-04 product decision about the multiple-comparisons
// risk of scanning a wide raw table unprompted. This module charts whatever
// findings exist; it doesn't change which findings get generated.

const CHARTABLE_PATTERN_TYPES = [
  "banner_comparison",
  "segment_difference",
  "relationship",
  "outlier",
] as const;

export type ChartableFinding = {
  id: string;
  origin: "stated" | "generated" | "coded";
  pattern_type: string | null;
  theme: string | null;
  status: "pending" | "accepted" | "rejected";
  stated_stats: Record<string, unknown> | null;
};

export type CrosstabBar = {
  bannerCategory: string;
  stubCategory: string;
  percent: number;
};

export type MeansBar = {
  category: string;
  mean: number;
  n: number;
};

export type ScatterPoint = { x: number; y: number };

export type OutlierBar = {
  label: string;
  z: number;
  value: number;
};

export type ChartSpec =
  | {
      kind: "categorical_crosstab";
      bannerColumn: string;
      stubColumn: string;
      bars: CrosstabBar[];
      caption: string;
      comparisonCount: number;
      significantCount: number;
    }
  | {
      kind: "group_means";
      bannerColumn: string;
      stubColumn: string;
      bars: MeansBar[];
      caption: string;
      testType: "anova" | "pairwise";
      comparisonCount: number;
      significantCount: number;
    }
  | {
      kind: "scatter";
      variable1: string;
      variable2: string;
      points: ScatterPoint[];
      r: number;
      caption: string;
    }
  | {
      kind: "outlier_strip";
      column: string;
      bars: OutlierBar[];
      caption: string;
    };

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Attempts to build a chart from one theme group's findings. Returns null
 * whenever the group isn't a clean, fully-structured, single-pattern-type
 * set of computed findings -- mixed origins, mixed pattern types under one
 * theme, a theme shared with a stated/coded finding, missing fields (e.g.
 * findings extracted before a field this needs existed) -- rather than
 * rendering a partial or misleading chart. The caller falls back to the
 * existing card grid in every one of those cases.
 */
export function buildChartForThemeGroup(
  findings: ChartableFinding[],
): ChartSpec | null {
  if (findings.length === 0) return null;
  const patternType = findings[0].pattern_type;
  const eligible = findings.filter(
    (f) =>
      f.origin === "generated" &&
      f.pattern_type === patternType &&
      (CHARTABLE_PATTERN_TYPES as readonly string[]).includes(
        patternType ?? "",
      ),
  );
  // Only chart a theme where EVERY finding in it is the same chartable,
  // code-computed pattern type -- a theme name can in principle be shared
  // with a stated/coded finding, or (less likely, but themeFor() doesn't
  // guarantee otherwise) a different pattern type, and silently dropping
  // those from the chart's view would make it look like the chart is the
  // whole picture when it isn't.
  if (eligible.length === 0 || eligible.length !== findings.length) return null;

  const withStats = eligible
    .map((f) => ({ finding: f, stats: f.stated_stats }))
    .filter(
      (f): f is { finding: ChartableFinding; stats: Record<string, unknown> } =>
        f.stats !== null,
    );
  if (withStats.length === 0) return null;

  if (patternType === "relationship") {
    return buildScatterChart(withStats);
  }
  if (patternType === "outlier") {
    return buildOutlierChart(withStats);
  }

  // banner_comparison and segment_difference both land here: the latter's
  // stated_stats is given the same bannerColumn/stubColumn/group1Label/
  // group2Label/mean1/mean2 field names as a banner-plan pairwise mean-gap
  // finding (see tableComputation.ts's own comment on this), specifically
  // so it can share this one chart builder instead of needing a near-
  // identical second one.
  const bannerColumn = str(withStats[0].stats.bannerColumn);
  const stubColumn = str(withStats[0].stats.stubColumn);
  if (!bannerColumn || !stubColumn) return null;
  // All findings in a theme share the same banner/stub pair by construction
  // (theme is literally `${bannerColumn} & ${stubColumn}`), but double-check
  // rather than assume -- a chart built from mismatched columns is worse
  // than no chart.
  if (
    withStats.some(
      (f) =>
        str(f.stats.bannerColumn) !== bannerColumn ||
        str(f.stats.stubColumn) !== stubColumn,
    )
  ) {
    return null;
  }

  const anovaRows = withStats.filter(
    (f) => f.stats.testType === "one_way_anova",
  );
  const crosstabRows = withStats.filter((f) => str(f.stats.stubCategory));
  const meanGapRows = withStats.filter(
    (f) =>
      str(f.stats.stubCategory) === null &&
      f.stats.testType !== "one_way_anova" &&
      f.stats.testType !== "descriptive_summary" &&
      num(f.stats.mean1) !== null &&
      num(f.stats.mean2) !== null,
  );

  if (crosstabRows.length > 0) {
    return buildCrosstabChart(bannerColumn, stubColumn, crosstabRows);
  }
  if (anovaRows.length > 0 || meanGapRows.length > 0) {
    return buildMeansChart(bannerColumn, stubColumn, anovaRows, meanGapRows);
  }
  return null;
}

function buildCrosstabChart(
  bannerColumn: string,
  stubColumn: string,
  rows: { finding: ChartableFinding; stats: Record<string, unknown> }[],
): ChartSpec | null {
  // Every pairwise comparison for a given stub category restates both
  // sides' own percentage (pctA/pctB) -- a category that appears in several
  // pairs (the normal case once there are 3+ banner categories) repeats the
  // same percent each time, so a Map naturally dedupes it rather than
  // double-counting or averaging rounding noise.
  const key = (stubCategory: string, category: string) =>
    `${stubCategory}\u0000${category}`;
  const percentByKey = new Map<string, number>();
  let significantCount = 0;
  let largestGap: {
    gapAbs: number;
    catA: string;
    catB: string;
    stubCategory: string;
    zScore: number | null;
  } | null = null;

  for (const { stats } of rows) {
    const stubCategory = str(stats.stubCategory);
    const catA = str(stats.group1Label);
    const catB = str(stats.group2Label);
    const pctA = num(stats.pctA);
    const pctB = num(stats.pctB);
    if (!stubCategory || !catA || !catB || pctA === null || pctB === null) {
      // An older finding generated before pctA/pctB existed -- skip it
      // rather than fail the whole chart, but it does mean this bar group's
      // columns may be sparser than the full plan until re-extraction.
      continue;
    }
    percentByKey.set(key(stubCategory, catA), pctA);
    percentByKey.set(key(stubCategory, catB), pctB);

    if (stats.significant === true) significantCount++;
    const gapPercent = num(stats.gapPercent);
    if (gapPercent !== null) {
      const gapAbs = Math.abs(gapPercent);
      if (!largestGap || gapAbs > largestGap.gapAbs) {
        largestGap = {
          gapAbs,
          catA,
          catB,
          stubCategory,
          zScore: num(stats.zScore),
        };
      }
    }
  }

  if (percentByKey.size === 0) return null;

  const bars: CrosstabBar[] = Array.from(percentByKey.entries()).map(
    ([k, percent]) => {
      const [stubCategory, bannerCategory] = k.split("\u0000");
      return { bannerCategory, stubCategory, percent };
    },
  );

  const comparisonCount = rows.length;
  const captionParts = [
    `${significantCount} of ${comparisonCount} comparisons statistically significant.`,
  ];
  if (largestGap) {
    const zText = largestGap.zScore !== null ? `, z=${largestGap.zScore}` : "";
    captionParts.push(
      `Largest gap: ${bannerColumn} "${largestGap.catA}" vs "${largestGap.catB}" on ${stubColumn}="${largestGap.stubCategory}" (${largestGap.gapAbs} points${zText}).`,
    );
  }

  return {
    kind: "categorical_crosstab",
    bannerColumn,
    stubColumn,
    bars,
    caption: captionParts.join(" "),
    comparisonCount,
    significantCount,
  };
}

function buildMeansChart(
  bannerColumn: string,
  stubColumn: string,
  anovaRows: { finding: ChartableFinding; stats: Record<string, unknown> }[],
  meanGapRows: { finding: ChartableFinding; stats: Record<string, unknown> }[],
): ChartSpec | null {
  // The omnibus ANOVA finding (when present -- only run when a banner
  // column has more than two categories) already carries every group's
  // mean in one place; it's the authoritative source for the bars. Without
  // it (the plain two-category case, which is the only shape
  // segment_difference ever produces -- it always compares exactly the two
  // largest segments), the single pairwise mean-gap finding is the whole
  // comparison.
  if (anovaRows.length > 0) {
    const anova = anovaRows[0].stats;
    const groupMeans = Array.isArray(anova.groupMeans)
      ? (anova.groupMeans as unknown[]).filter(
          (g): g is { label: string; n: number; mean: number } =>
            typeof g === "object" &&
            g !== null &&
            typeof (g as { label?: unknown }).label === "string" &&
            typeof (g as { mean?: unknown }).mean === "number",
        )
      : [];
    if (groupMeans.length === 0) return null;

    const bars: MeansBar[] = groupMeans.map((g) => ({
      category: g.label,
      mean: g.mean,
      n: g.n,
    }));
    const significantCount = meanGapRows.filter(
      (r) => r.stats.significant === true,
    ).length;
    const fStat = num(anova.fStat);
    const pValue = num(anova.pValue);
    const sorted = [...bars].sort((a, b) => b.mean - a.mean);
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    const statsText =
      fStat !== null && pValue !== null
        ? ` (F=${fStat}, p=${pValue < 0.001 ? "<0.001" : pValue})`
        : "";
    const caption = anova.significant
      ? `Significant overall difference across ${bars.length} ${bannerColumn} groups on ${stubColumn}${statsText}. Highest: "${top.category}" at ${top.mean}, lowest: "${bottom.category}" at ${bottom.mean}.`
      : `No statistically significant overall difference across ${bars.length} ${bannerColumn} groups on ${stubColumn}${statsText}.`;

    return {
      kind: "group_means",
      bannerColumn,
      stubColumn,
      bars,
      caption,
      testType: "anova",
      comparisonCount: meanGapRows.length + 1,
      significantCount,
    };
  }

  if (meanGapRows.length > 0) {
    // Plain two-category case: one pairwise finding is the entire
    // comparison. (If more than one such finding somehow shares this theme,
    // the categories are deduped by label the same way the crosstab branch
    // dedupes percentages.)
    const byCategory = new Map<string, MeansBar>();
    let significantCount = 0;
    for (const { stats } of meanGapRows) {
      const catA = str(stats.group1Label);
      const catB = str(stats.group2Label);
      const mean1 = num(stats.mean1);
      const mean2 = num(stats.mean2);
      const n1 = num(stats.n1);
      const n2 = num(stats.n2);
      if (!catA || !catB || mean1 === null || mean2 === null) continue;
      byCategory.set(catA, { category: catA, mean: mean1, n: n1 ?? 0 });
      byCategory.set(catB, { category: catB, mean: mean2, n: n2 ?? 0 });
      if (stats.significant === true) significantCount++;
    }
    if (byCategory.size === 0) return null;
    const bars = Array.from(byCategory.values());
    const first = meanGapRows[0].stats;
    const tScore = num(first.tScore);
    const gap = num(first.gap);
    const caption =
      first.significant === true
        ? `Statistically significant gap of ${gap !== null ? Math.abs(gap) : "?"} on ${stubColumn} between ${bannerColumn} groups${tScore !== null ? ` (t=${tScore})` : ""}.`
        : `No statistically significant gap found on ${stubColumn} between these ${bannerColumn} groups.`;

    return {
      kind: "group_means",
      bannerColumn,
      stubColumn,
      bars,
      caption,
      testType: "pairwise",
      comparisonCount: meanGapRows.length,
      significantCount,
    };
  }

  return null;
}

/**
 * A "relationship" theme is one correlated column pair
 * (themeFor(colA, colB) is deterministic per pair, so in the overwhelming
 * majority of cases this group holds exactly one finding). If more than
 * one somehow shares the theme, the one with the larger |r| wins rather
 * than averaging two different correlations together.
 */
function buildScatterChart(
  rows: { finding: ChartableFinding; stats: Record<string, unknown> }[],
): ChartSpec | null {
  const withR = rows
    .map((r) => ({ ...r, r: num(r.stats.r) }))
    .filter((r): r is typeof r & { r: number } => r.r !== null)
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  if (withR.length === 0) return null;

  const { stats, r } = withR[0];
  const variable1 = str(stats.variable1);
  const variable2 = str(stats.variable2);
  const rawPoints = Array.isArray(stats.points) ? stats.points : null;
  if (!variable1 || !variable2 || !rawPoints) return null;

  const points: ScatterPoint[] = rawPoints
    .filter(
      (p): p is { x: unknown; y: unknown } =>
        typeof p === "object" && p !== null,
    )
    .map((p) => ({ x: num(p.x), y: num(p.y) }))
    .filter((p): p is ScatterPoint => p.x !== null && p.y !== null);
  if (points.length === 0) return null;

  const direction = r > 0 ? "positive" : "negative";
  const strength =
    Math.abs(r) >= 0.7 ? "strong" : Math.abs(r) >= 0.5 ? "moderate" : "weak";
  const pairCount = num(stats.pairCount) ?? points.length;
  const caption = `${strength[0].toUpperCase()}${strength.slice(1)} ${direction} association between ${variable1} and ${variable2} across ${pairCount} rows (r=${r}). Descriptive association only, not evidence of causation.`;

  return {
    kind: "scatter",
    variable1,
    variable2,
    points,
    r,
    caption,
  };
}

/**
 * An "outlier" theme is one column (themeFor(header) names only that
 * column), and can legitimately hold several findings -- one per row
 * flagged as unusual on that column. Each becomes one bar, labeled by row
 * number, so a reader sees every flagged row on that column at a glance
 * instead of reading N near-identical one-line cards.
 */
function buildOutlierChart(
  rows: { finding: ChartableFinding; stats: Record<string, unknown> }[],
): ChartSpec | null {
  const column = str(rows[0].stats.column);
  if (!column) return null;
  if (rows.some((r) => str(r.stats.column) !== column)) return null;

  const unlabeled = rows
    .map((r) => {
      const z = num(r.stats.z);
      const value = num(r.stats.value);
      return z !== null && value !== null ? { z, value } : null;
    })
    .filter((b): b is { z: number; value: number } => b !== null)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  if (unlabeled.length === 0) return null;

  // Labeled by rank, not by the row's actual position in the source table
  // (stated_stats doesn't carry the row index, only source_cells does, and
  // ChartableFinding doesn't thread that through) -- the caption spells
  // this out so a "#1" bar is never mistaken for literal row 1.
  const bars: OutlierBar[] = unlabeled.map((b, index) => ({
    label: `#${index + 1}`,
    ...b,
  }));

  const largest = bars[0];
  const caption = `${bars.length} value${bars.length === 1 ? "" : "s"} flagged as unusual on ${column}, ranked by size of deviation (not row order). Largest: ${largest.value} (${largest.z >= 0 ? "+" : ""}${largest.z} SD from the comparison mean). Descriptive heuristic, not a formal outlier test.`;

  return {
    kind: "outlier_strip",
    column,
    bars,
    caption,
  };
}
