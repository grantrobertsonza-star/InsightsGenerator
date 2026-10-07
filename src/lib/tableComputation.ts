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
import { withTenant } from "./db";

// Every comparison this module reports comes from scanning more than one
// column pair (every categorical x numeric pair for segment_difference,
// every numeric x numeric pair for relationship) and testing each one
// independently against an uncorrected significance threshold. That matches
// standard market research tab software, which runs the same uncorrected
// column tests by default (see Q Research Software's own multiple
// comparison correction being an opt-in, not a default). Replicating that
// convention is the deliberate choice here, not an oversight, but it's
// disclosed on every pattern this produces rather than left implicit.
const MULTIPLE_COMPARISONS_CAVEAT = "uncorrected_multiple_comparisons";

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

export type TableComputationResult = {
  patterns: ComputedPattern[];
  // A short, plain-text summary of the strongest patterns found, for the
  // cross-document grounding digest (see getTableGroundingDigest below).
  digest: string;
};

// Bounds that keep this a bounded, predictable pass over a table rather than
// an open-ended combinatorial search: a 40-column table doesn't get 40x40
// column pairs examined, and a free-text or ID-like column (hundreds of
// distinct values) never gets mistaken for a segmenting category.
const MAX_COLUMNS_EXAMINED = 15;
const MAX_CATEGORY_CARDINALITY = 10;
const MIN_GROUP_SIZE = 5;
const MAX_PATTERNS_PER_TABLE = 25;
const CORRELATION_THRESHOLD = 0.3;
const MAX_SCATTER_POINTS = 300;

// An evenly-spaced sample rather than the first N: the first N rows of a
// table are frequently a single stratum (sorted input, an early batch of
// one survey wave), and charting only that slice would show a biased
// slice of the relationship rather than the one the full-data correlation
// above was actually computed from.
function samplePairs(
  paired: { a: number; b: number }[],
  maxPoints: number,
): { x: number; y: number }[] {
  if (paired.length <= maxPoints) {
    return paired.map((p) => ({ x: p.a, y: p.b }));
  }
  const step = paired.length / maxPoints;
  const sampled: { x: number; y: number }[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const p = paired[Math.floor(i * step)];
    sampled.push({ x: p.a, y: p.b });
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

function categoricalValues(rows: Row[], header: string): string[] | null {
  const present = rows
    .map((row) => row[header])
    .filter(
      (value): value is string | number =>
        value !== null && value !== undefined,
    );
  if (present.length < MIN_GROUP_SIZE * 2) return null;
  const distinct = Array.from(new Set(present.map((value) => String(value))));
  if (distinct.length < 2 || distinct.length > MAX_CATEGORY_CARDINALITY)
    return null;
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

export function computeTablePatterns(
  headers: string[],
  rows: Row[],
): TableComputationResult {
  const columns = headers.slice(0, MAX_COLUMNS_EXAMINED);
  const numericColumns = columns.filter((h) => isNumericColumn(rows, h));
  const categoricalColumns = columns
    .filter((h) => !numericColumns.includes(h))
    .map((header) => ({ header, categories: categoricalValues(rows, header) }))
    .filter(
      (c): c is { header: string; categories: string[] } =>
        c.categories !== null,
    );

  const patterns: ComputedPattern[] = [];
  const pushPattern = (pattern: ComputedPattern) => {
    if (patterns.length < MAX_PATTERNS_PER_TABLE) patterns.push(pattern);
  };

  // --- Segment differences: a categorical column's two largest groups,
  // compared on a numeric outcome. Mirrors how a researcher naturally reads
  // a cross-tab -- the two biggest segments, not every possible pairing.
  for (const { header: catHeader, categories } of categoricalColumns) {
    for (const numHeader of numericColumns) {
      const groups = categories
        .map((category) => ({
          category,
          values: rows
            .map((row, index) => ({ index, value: row[numHeader] }))
            .filter(
              (r) =>
                String(row(rows, r.index)[catHeader]) === category &&
                typeof r.value === "number",
            ),
        }))
        .filter((g) => g.values.length >= MIN_GROUP_SIZE)
        .sort((a, b) => b.values.length - a.values.length);

      if (groups.length < 2) continue;
      const [g1, g2] = groups;
      const comparison = compareGroupMeans(
        g1.values.map((v) => v.value as number),
        g2.values.map((v) => v.value as number),
      );
      if (
        comparison.significant &&
        comparison.mean1 !== null &&
        comparison.mean2 !== null
      ) {
        pushPattern({
          patternType: "segment_difference",
          description:
            `${catHeader} "${g1.category}" averages ${comparison.mean1} on ${numHeader} (n=${g1.values.length}), ` +
            `versus ${comparison.mean2} for "${g2.category}" (n=${g2.values.length}): a gap of ${comparison.gap} ` +
            `(t=${comparison.tScore}).`,
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
            caveats: [MULTIPLE_COMPARISONS_CAVEAT],
          },
          rowIndices: [
            ...g1.values.map((v) => v.index),
            ...g2.values.map((v) => v.index),
          ],
        });
      }
    }
  }

  // --- Relationships: every numeric-column pair, correlated directly.
  for (let i = 0; i < numericColumns.length; i++) {
    for (let j = i + 1; j < numericColumns.length; j++) {
      const colA = numericColumns[i];
      const colB = numericColumns[j];
      const paired = rows
        .map((row) => ({ a: row[colA], b: row[colB] }))
        .filter(
          (r): r is { a: number; b: number } =>
            typeof r.a === "number" && typeof r.b === "number",
        );
      if (paired.length < 3) continue;
      const result = pearsonCorrelation(
        paired.map((p) => p.a),
        paired.map((p) => p.b),
      );
      if (result.r !== null && Math.abs(result.r) >= CORRELATION_THRESHOLD) {
        pushPattern({
          patternType: "relationship",
          description: `${colA} and ${colB} move together across ${paired.length} rows (r=${result.r}). ${result.note}`,
          theme: themeFor(colA, colB),
          statedStats: {
            ...result,
            variable1: colA,
            variable2: colB,
            pairCount: paired.length,
            // A capped, evenly-spaced sample of the actual (a, b) pairs this
            // r was computed from, so a scatter chart (findingsChartData.ts)
            // has real points to draw rather than just the summary
            // coefficient -- the correlation itself is still computed from
            // every pair above, this sample is for the picture only.
            // MAX_SCATTER_POINTS caps jsonb size on a large table without
            // visibly thinning a scatter (a few hundred points reads the
            // same as a few thousand at chart scale).
            points: samplePairs(paired, MAX_SCATTER_POINTS),
            caveats: [MULTIPLE_COMPARISONS_CAVEAT],
          },
          rowIndices: [],
        });
      }
    }
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
    for (const { index, value } of values) {
      const others = values
        .filter((v) => v.index !== index)
        .map((v) => v.value);
      const result = flagOutlier(value, others);
      if (result.flag) {
        pushPattern({
          patternType: "outlier",
          description: `${header} value of ${value} at row ${index + 1}. ${result.flag}`,
          theme: themeFor(header),
          statedStats: { ...result, column: header, value },
          rowIndices: [index],
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

  const digest = patterns
    .slice(0, 8)
    .map((p) => `- ${p.description}`)
    .join("\n");

  return { patterns, digest };
}

// Tiny helper so the segment-difference loop above can index back into the
// original rows array by row index without re-destructuring each time.
function row(rows: Row[], index: number): Row {
  return rows[index];
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
  limit = 20,
): Promise<TableGroundingDigestEntry[]> {
  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query<{ id: string; finding_text: string }>(
      `select id, finding_text from findings
       where run_id = $1 and origin = 'generated' and status != 'rejected'
       order by created_at asc
       limit $2`,
      [runId, limit],
    );
    return result.rows;
  });

  return rows.map((r: { id: string; finding_text: string }, i: number) => ({
    index: i + 1,
    findingId: r.id,
    text: r.finding_text,
  }));
}
