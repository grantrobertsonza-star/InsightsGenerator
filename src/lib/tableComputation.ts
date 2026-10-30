// Runs real, code-computed statistics over a parsed table's full rows --
// descriptive comparisons, correlations, outlier checks, and a simple
// one-level decision stump -- before any model ever sees the table. This is
// the "model-derived-vs-summarised" split in practice: a finding produced
// here carries real numbers that nothing with a temperature ever touched,
// as distinct from a finding extracted from a sentence in a report or
// transcript (see extractFindings.ts's "stated" origin findings).
//
// generateFindingsFromTable.ts used to ask the model to propose candidate
// patterns and the exact numbers behind them, then verify those numbers
// against stats.ts afterward. That order only ever rejects a wrong
// proposal; it can't discover a real pattern the model never thought to
// propose, and it can't be trusted as "the data's own numbers" when a model
// typed them first. This module does the discovery itself, directly
// against the parsed rows, so there's nothing left for a model to
// mis-propose in the first place.

import { flagOutlier, pearsonCorrelation, compareGroupMeans } from "./stats";
import { findingBasis } from "./findingBasis";
import { withTenant } from "./db";

// Every tested comparison this module reports comes from scanning more than one column pair (every
// categorical x numeric pair for segment_difference, every numeric x numeric pair for relationship).
// EF-FND-F01 (batch 62): the scan used to look at the first 15 columns only, so a relationship
// between two later columns was never examined and the table read as "nothing found". Every column is
// now examined, and the multiple-comparison treatment is scaled to the tests actually run: a
// Benjamini-Hochberg false discovery rate across every segment and relationship test of the table
// (the family), and a pattern is kept only when its q-value is below 0.05. Each kept pattern records
// its q, the family size and the caveat "fdr_controlled_within_table" (the tag the cross tab commit
// uses for the same control). Outliers are a descriptive heuristic, not tests, and are not in the family.
const FDR_CAVEAT = "fdr_controlled_within_table";
const FDR_LEVEL = 0.05;

type Row = Record<string, string | number | null>;

export type ComputedPatternType =
  "segment_difference" | "trend" | "outlier" | "relationship" | "segment_split";

export type ComputedPattern = {
  patternType: ComputedPatternType;
  description: string;
  theme: string;
  statedStats: Record<string, unknown>;
  rowIndices: number[];
};

/** Why a column took no part in the scan. */
export type ColumnOmissionReason =
  /** Named in `excludedColumns` by the caller (an intentional exclusion). */
  | "excluded"
  /** Fewer than ten present values, too few for a group comparison or a correlation. */
  | "too_few_values"
  /** One distinct value: nothing to compare or correlate. */
  | "single_value"
  /** Text (or mixed) with more than MAX_CATEGORY_CARDINALITY distinct values: an id or free text, not a segment. */
  | "too_many_categories";

/**
 * What the scan looked at, so "nothing found" (every eligible column examined, no test passed) can be
 * told apart from a selection cap (patterns found, some not kept) and from columns that could not take
 * part (omitted, with the reason).
 */
export type TableScanCoverage = {
  columnsInTable: number;
  examined: { name: string; role: "numeric" | "categorical" }[];
  omitted: { name: string; reason: ColumnOmissionReason }[];
  /** Tests that produced a p-value, by kind; their sum is the false discovery rate family. */
  testsRun: { segmentDifference: number; relationship: number };
  /** Tests whose q-value passed, and outliers flagged, before the per-table cap. */
  patternsFound: number;
  patternsKept: number;
  /** MAX_PATTERNS_PER_TABLE; `capped` is true when patternsFound exceeded it. */
  selectionCap: number;
  capped: boolean;
};

export type TableComputationResult = {
  patterns: ComputedPattern[];
  // A short, plain-text summary of the strongest patterns found, for the
  // cross-document grounding digest (see getTableGroundingDigest below).
  digest: string;
  scan: TableScanCoverage;
};

// A free-text or ID-like column (hundreds of distinct values) never gets mistaken for a segmenting
// category. MAX_PATTERNS_PER_TABLE is a display bound on how many findings one table adds, applied
// after the tests (strongest of each kind, taking turns) and reported as `capped`; it never limits
// which columns are examined.
const MAX_CATEGORY_CARDINALITY = 10;
const MIN_GROUP_SIZE = 5;
const MAX_PATTERNS_PER_TABLE = 25;
const CORRELATION_THRESHOLD = 0.3;
// Fewer pairs than this cannot support a correlation claim.
const MIN_PAIRS_FOR_CORRELATION = 10;
const MAX_SCATTER_POINTS = 300;
// Outlier screening margin (see outlierCandidates): far below the 2 SD flag, so floating-point
// differences between the closed form and flagOutlier's own arithmetic can never hide a flag.
const OUTLIER_SCREEN_Z = 1.5;

// An evenly-spaced sample rather than the first N: the first N rows of a
// table are frequently a single stratum (sorted input, an early batch of
// one survey wave), and charting only that slice would show a biased
// slice of the relationship rather than the one the full-data correlation
// above was actually computed from.
function samplePairs(
  xs: number[],
  ys: number[],
  maxPoints: number,
): { x: number; y: number }[] {
  if (xs.length <= maxPoints) {
    return xs.map((x, i) => ({ x, y: ys[i] }));
  }
  const step = xs.length / maxPoints;
  const sampled: { x: number; y: number }[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const k = Math.floor(i * step);
    sampled.push({ x: xs[k], y: ys[k] });
  }
  return sampled;
}

function isNumericColumn(rows: Row[], header: string): boolean {
  const present = rows
    .map((row) => row[header])
    .filter((value) => value !== null && value !== undefined);
  if (present.length < MIN_GROUP_SIZE) return false;
  return present.every((value) => typeof value === "number");
}

/** The column's categories, or why it cannot segment the table. */
function categoricalValues(rows: Row[], header: string): string[] | Exclude<ColumnOmissionReason, "excluded"> {
  const present = rows
    .map((row) => row[header])
    .filter(
      (value): value is string | number =>
        value !== null && value !== undefined,
    );
  if (present.length < MIN_GROUP_SIZE * 2) return "too_few_values";
  const distinct = Array.from(new Set(present.map((value) => String(value))));
  if (distinct.length < 2) return "single_value";
  if (distinct.length > MAX_CATEGORY_CARDINALITY) return "too_many_categories";
  return distinct;
}

/**
 * A short theme name built from the column names a pattern involves,
 * instead of asking a model to invent one -- nothing in this module is
 * LLM-authored, themes included.
 */
function themeFor(...columns: string[]): string {
  const unique = Array.from(
    new Set(columns.map((c) => c.trim()).filter(Boolean)),
  );
  return unique.slice(0, 3).join(" & ");
}

/** Benjamini-Hochberg q-values, in the order of `pValues` (the same step-up as the cross tab starter set). */
function benjaminiHochberg(pValues: number[]): number[] {
  const m = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p || a.i - b.i);
  const q = new Array<number>(m);
  let running = 1;
  for (let k = m - 1; k >= 0; k--) {
    running = Math.min(running, (order[k].p * m) / (k + 1));
    q[order[k].i] = running;
  }
  return q;
}

const roundQ = (q: number) => Math.round(q * 10000) / 10000;

/**
 * Indices of values that could be 2 SD or more from the mean of the other values. A closed-form
 * leave-one-out z (mean and population variance of the others from the column totals) screens every
 * value in one pass; only values it puts above OUTLIER_SCREEN_Z, or any value when the closed form is
 * degenerate, go to flagOutlier, which stays the one rule that decides a flag. Measured: the direct
 * pass took 3.7 s on a 15-column, 2,000-row table (every value against every other value), which a
 * scan of every column would multiply; see the batch 62 handover.
 */
function outlierCandidates(values: number[]): number[] {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const ss = values.reduce((a, v) => a + (v - mean) ** 2, 0);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = values[i] - mean;
    const othersVariance = (ss - (n * d * d) / (n - 1)) / (n - 1);
    if (!(othersVariance > 1e-12 * (ss / n + 1e-300))) {
      out.push(i);
      continue;
    }
    const z = (d * n) / (n - 1) / Math.sqrt(othersVariance);
    if (Math.abs(z) >= OUTLIER_SCREEN_Z) out.push(i);
  }
  return out;
}

/** `familyIndex`: this candidate's position in the family of p-values (null for an outlier, which is not a test). */
type Candidate = { pattern: ComputedPattern; strength: number; familyIndex: number | null };

export function computeTablePatterns(
  headers: string[],
  rows: Row[],
  options: { excludedColumns?: readonly string[] } = {},
): TableComputationResult {
  const excluded = new Set(options.excludedColumns ?? []);
  const examined: TableScanCoverage["examined"] = [];
  const omitted: TableScanCoverage["omitted"] = [];
  const numericColumns: string[] = [];
  const categoricalColumns: { header: string; categories: string[] }[] = [];
  for (const header of headers) {
    if (excluded.has(header)) {
      omitted.push({ name: header, reason: "excluded" });
      continue;
    }
    if (isNumericColumn(rows, header)) {
      numericColumns.push(header);
      examined.push({ name: header, role: "numeric" });
      continue;
    }
    const categories = categoricalValues(rows, header);
    if (Array.isArray(categories)) {
      categoricalColumns.push({ header, categories });
      examined.push({ name: header, role: "categorical" });
    } else {
      omitted.push({ name: header, reason: categories });
    }
  }

  // Tested candidates are collected with their p-values first; the false discovery rate across the
  // whole family decides which are kept. Then the cap is applied across the three kinds (strongest
  // of each, taking turns) so a table with many segment gaps still shows its relationships and
  // outliers, and the strongest evidence of each kind survives.
  const tested: Candidate[] = [];
  const familyP: number[] = [];
  let segmentTests = 0;
  let relationshipTests = 0;

  // --- Segment differences: a categorical column's two largest groups,
  // compared on a numeric outcome. Mirrors how a researcher naturally reads
  // a cross-tab -- the two biggest segments, not every possible pairing.
  for (const { header: catHeader, categories } of categoricalColumns) {
    const rowCategory = rows.map((row) => {
      const v = row[catHeader];
      return v === null || v === undefined ? null : String(v);
    });
    for (const numHeader of numericColumns) {
      const buckets = new Map<string, { index: number; value: number }[]>(categories.map((c) => [c, []]));
      rows.forEach((row, index) => {
        const value = row[numHeader];
        const category = rowCategory[index];
        if (category === null || typeof value !== "number") return;
        buckets.get(category)?.push({ index, value });
      });
      const groups = categories
        .map((category) => ({ category, values: buckets.get(category)! }))
        .filter((g) => g.values.length >= MIN_GROUP_SIZE)
        .sort((a, b) => b.values.length - a.values.length);

      if (groups.length < 2) continue;
      const [g1, g2] = groups;
      const comparison = compareGroupMeans(
        g1.values.map((v) => v.value),
        g2.values.map((v) => v.value),
      );
      const familyIndex = comparison.pValue !== null && Number.isFinite(comparison.pValue) ? familyP.push(comparison.pValue) - 1 : null;
      if (familyIndex !== null) segmentTests++;
      if (
        familyIndex !== null &&
        comparison.significant &&
        comparison.mean1 !== null &&
        comparison.mean2 !== null
      ) {
        tested.push({
          familyIndex,
          strength: Math.abs(comparison.tScore ?? 0),
          pattern: {
            patternType: "segment_difference",
            description:
              `${catHeader} "${g1.category}" averages ${comparison.mean1} on ${numHeader} (n=${g1.values.length}), ` +
              `versus ${comparison.mean2} for "${g2.category}" (n=${g2.values.length}): a gap of ${comparison.gap} ` +
              `(t=${comparison.tScore}`,
            theme: themeFor(catHeader, numHeader),
            statedStats: {
              ...comparison,
              group1Label: g1.category,
              group2Label: g2.category,
              n1: g1.values.length,
              n2: g2.values.length,
              // Named the same way bannerPlanComputation.ts names its own
              // pairwise mean-gap stats, even though there's no banner plan
              // here -- findingsChartData.ts's buildChartForThemeGroup reads
              // these two fields generically to label a group_means chart's
              // axes, and giving segment_difference findings the same field
              // names lets them share that one chart builder rather than
              // needing a second one that draws the identical chart shape.
              bannerColumn: catHeader,
              stubColumn: numHeader,
            },
            rowIndices: [
              ...g1.values.map((v) => v.index),
              ...g2.values.map((v) => v.index),
            ],
          },
        });
      }
    }
  }

  // --- Relationships: every numeric-column pair, correlated directly over the rows where both are
  // present. Each column is read out of the row objects once, not once per pair.
  const columnValues = numericColumns.map((h) => rows.map((row) => (typeof row[h] === "number" ? (row[h] as number) : null)));
  for (let i = 0; i < numericColumns.length; i++) {
    for (let j = i + 1; j < numericColumns.length; j++) {
      const colA = numericColumns[i];
      const colB = numericColumns[j];
      const xs: number[] = [];
      const ys: number[] = [];
      const va = columnValues[i];
      const vb = columnValues[j];
      for (let r = 0; r < va.length; r++) {
        const a = va[r];
        const b = vb[r];
        if (a !== null && b !== null) {
          xs.push(a);
          ys.push(b);
        }
      }
      if (xs.length < MIN_PAIRS_FOR_CORRELATION) continue;
      const result = pearsonCorrelation(xs, ys);
      const familyIndex = typeof result.pValue === "number" ? familyP.push(result.pValue) - 1 : null;
      if (familyIndex !== null) relationshipTests++;
      // A relationship is a candidate only when it is both sizeable and distinguishable from zero;
      // the family's false discovery rate then decides whether it is kept.
      if (
        familyIndex !== null &&
        result.r !== null &&
        Math.abs(result.r) >= CORRELATION_THRESHOLD &&
        typeof result.pValue === "number" &&
        result.pValue < 0.05
      ) {
        const exact = result.exact === true;
        tested.push({
          familyIndex,
          strength: Math.abs(result.r),
          pattern: {
            patternType: "relationship",
            description: exact
              ? `${colA} and ${colB} have an exact linear relationship across ${xs.length} rows (r=${result.r}, p=0 as the limit of the test`
              : `${colA} and ${colB} move together across ${xs.length} rows (r=${result.r}, p=${result.pValue}`,
            theme: themeFor(colA, colB),
            statedStats: {
              ...result,
              variable1: colA,
              variable2: colB,
              pairCount: xs.length,
              // A capped, evenly-spaced sample of the actual (a, b) pairs this
              // r was computed from, so a scatter chart (findingsChartData.ts)
              // has real points to draw rather than just the summary
              // coefficient -- the correlation itself is still computed from
              // every pair above, this sample is for the picture only.
              // MAX_SCATTER_POINTS caps jsonb size on a large table without
              // visibly thinning a scatter (a few hundred points reads the
              // same as a few thousand at chart scale).
              points: samplePairs(xs, ys, MAX_SCATTER_POINTS),
            },
            rowIndices: [],
          },
        });
      }
    }
  }

  // The family is every test that produced a p-value, kept or not (a relationship below |r| 0.3 still
  // counts); candidates are a subset of it, and each candidate's q is its BH-adjusted p in the family.
  const family = familyP.length;
  const found: Candidate[] = [];
  if (tested.length > 0) {
    const q = benjaminiHochberg(familyP);
    tested.forEach((c) => {
      const qRaw = q[c.familyIndex!];
      const qValue = roundQ(qRaw);
      if (!(qRaw < FDR_LEVEL)) return;
      const qText = `, false discovery rate q=${qValue < 0.001 ? "<0.001" : qValue} across the ${family} tests run on this table).`;
      found.push({
        ...c,
        pattern: {
          ...c.pattern,
          description:
            c.pattern.patternType === "relationship"
              ? `${c.pattern.description}${qText} ${String(c.pattern.statedStats.note ?? "")}`.trim()
              : `${c.pattern.description}${qText}`,
          statedStats: { ...c.pattern.statedStats, qValue, testsInFamily: family, caveats: [FDR_CAVEAT] },
        },
      });
    });
  }

  // --- Outliers: each numeric column, flagging a value far from the rest
  // of that same column.
  for (const header of numericColumns) {
    const values = rows
      .map((row, index) => ({ index, value: row[header] }))
      .filter(
        (r): r is { index: number; value: number } =>
          typeof r.value === "number",
      );
    if (values.length < 4) continue;
    for (const k of outlierCandidates(values.map((v) => v.value))) {
      const { index, value } = values[k];
      const others = values.filter((v) => v.index !== index).map((v) => v.value);
      const result = flagOutlier(value, others);
      if (result.flag) {
        found.push({
          familyIndex: null,
          strength: Math.abs(result.z ?? 0),
          pattern: {
            patternType: "outlier",
            description: `${header} value of ${value} at row ${index + 1}. ${result.flag}`,
            theme: themeFor(header),
            statedStats: { ...result, column: header, value, caveats: ["descriptive_heuristic"] },
            rowIndices: [index],
          },
        });
      }
    }
  }

  // --- segment_split (the one-level decision stump) is deliberately
  // disabled, not merely unused. It used to search every candidate
  // predictor (numeric or categorical) against every numeric outcome for
  // the single strongest split this table supported, trying every
  // threshold between consecutive unique values for a numeric predictor
  // along the way. That's a search over what can easily be hundreds of
  // implicit comparisons per table, collapsed into "the one significant
  // split" with no correction, the exact multiple-comparisons/p-hacking
  // risk this pipeline otherwise avoids. Per the 2026-10-04 decision that
  // raw data always routes to a dedicated statistical path with a
  // pre-specified, analyst-defined set of comparisons rather than letting
  // any code search its own cuts, this table's own exploratory search has
  // no place running unconditionally here. findBestStumpSplit itself is
  // left in stats.ts, since the disciplined replacement may still want the
  // same split-evaluation arithmetic once comparisons are pre-specified
  // rather than searched for.

  const order: ComputedPattern["patternType"][] = ["segment_difference", "relationship", "outlier"];
  const queues = order.map((t) => found.filter((f) => f.pattern.patternType === t).sort((a, b) => b.strength - a.strength));
  const patterns: ComputedPattern[] = [];
  for (let round = 0; patterns.length < MAX_PATTERNS_PER_TABLE; round++) {
    let added = false;
    for (const q of queues) {
      if (round < q.length && patterns.length < MAX_PATTERNS_PER_TABLE) {
        patterns.push(q[round].pattern);
        added = true;
      }
    }
    if (!added) break;
  }

  const digest = patterns
    .slice(0, 8)
    .map((p) => `- ${p.description}`)
    .join("\n");

  return {
    patterns,
    digest,
    scan: {
      columnsInTable: headers.length,
      examined,
      omitted,
      testsRun: { segmentDifference: segmentTests, relationship: relationshipTests },
      patternsFound: found.length,
      patternsKept: patterns.length,
      selectionCap: MAX_PATTERNS_PER_TABLE,
      capped: found.length > patterns.length,
    },
  };
}

export type TableGroundingDigestEntry = {
  index: number;
  findingId: string;
  text: string;
};

/**
 * A compact, cross-document digest of this run's already-computed,
 * code-verified table findings (origin='generated'), for the report and
 * transcript prose pipelines to use as grounding context. Reads findings
 * generateFindingsFromTable already stored, rather than recomputing
 * anything or needing to know which tables exist in this run.
 */
export async function getTableGroundingDigest(
  tenantId: string,
  runId: string,
  limit = 40,
): Promise<TableGroundingDigestEntry[]> {
  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query<{
      id: string;
      finding_text: string;
      pattern_type: string | null;
      stated_stats: Record<string, unknown> | null;
    }>(
      `select id, finding_text, pattern_type, stated_stats from findings
       where run_id = $1 and origin = 'generated' and status != 'rejected'
       order by created_at asc
       limit 600`,
      [runId],
    );
    return result.rows;
  });

  // A claim should only be tied to a result that stands: leave out findings whose
  // test did not pass or whose basis is unknown, then take the strongest first
  // (smallest q, adjusted p or p) instead of whichever were created first.
  const strength = (stats: Record<string, unknown> | null) => {
    const n = (x: unknown) => (typeof x === "number" ? x : null);
    return n(stats?.qValue) ?? n(stats?.pAdjusted) ?? n(stats?.pValue) ?? 1;
  };
  // Readings (shares, top-two box, NPS) carry no p. They rank after tested differences and before null results,
  // so a report claim like "62% are satisfied" can still be tied to the reading that matches it.
  const rank = (r: { pattern_type: string | null; stated_stats: Record<string, unknown> | null }) =>
    r.pattern_type === "level" ? 0.5 : r.pattern_type === "no_difference" ? 0.9 : strength(r.stated_stats);
  const usable = rows
    .filter((r) => {
      const b = findingBasis({ origin: "generated", pattern_type: r.pattern_type, stated_stats: r.stated_stats });
      return b !== "tested_not_significant" && b !== "unknown";
    })
    .map((r, i) => ({ r, i, s: rank(r) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, limit);

  return usable.map((x, i) => ({
    index: i + 1,
    findingId: x.r.id,
    text: x.r.finding_text,
  }));
}
