// The disciplined counterpart to tableComputation.ts's exploratory scan.
// tableComputation.ts searches every column pair on an aggregated table
// itself for whatever significant patterns exist, which is an acceptable,
// industry-standard pass over a handful of supplied cross-tab columns (see
// its own MULTIPLE_COMPARISONS_CAVEAT comment). A raw, case-level table
// never gets that search (see generateFindingsFromTable.ts's ingestion_type
// gate): instead, a person names which columns are the banner (segmenting
// variables, e.g. Gender, Age band) and which are the stub (outcome
// measures) via the banner plan (0039_table_banner_plan.sql). This module
// is what actually computes those pre-specified comparisons, nothing more.
//
// Per the 2026-10-04 decision, every category within a named banner column
// is compared against every other by default (standard market-research
// tab-plan behavior), so naming a column is the only discipline required,
// not naming individual comparison pairs within it. That still means more
// than one comparison gets tested per banner/stub pair, so the same
// uncorrected_multiple_comparisons caveat tableComputation.ts attaches
// applies here too, just for a bounded, human-chosen set of columns rather
// than an open search across the whole table.
//
// Stratified probability sampling (a genuine survey design, with strata and
// replicate or design weights) is explicitly parked as later work per the
// 2026-10-04 decision: sampling_design on document_tables is captured for
// whenever that lands, but this module does not read it yet. Every
// comparison here assumes quota or simple-random sampling, exactly the
// "polite fiction" the market-research statistical methodology discussion
// agreed the field already runs on, and is tagged sampling_assumed_random
// to disclose that rather than imply a real design was recreated.

import { twoProportionGap, compareGroupMeans, oneWayAnova } from "./stats";

type Row = Record<string, string | number | null>;

export type BannerComparisonPattern = {
  patternType: "banner_comparison";
  description: string;
  theme: string;
  statedStats: Record<string, unknown>;
  rowIndices: number[];
};

// Same bound tableComputation.ts uses for the same reason: an ID-like or
// free-text column (hundreds of distinct values) named as a banner or stub
// by mistake shouldn't turn into hundreds of categories compared pairwise.
export const MAX_CATEGORY_CARDINALITY = 10;

export function distinctCategories(rows: Row[], column: string): string[] {
  const present = rows
    .map((row) => row[column])
    .filter((value): value is string | number => value !== null && value !== undefined);
  return Array.from(new Set(present.map((value) => String(value))));
}

export function isNumericColumn(rows: Row[], column: string): boolean {
  const present = rows.map((row) => row[column]).filter((value) => value !== null && value !== undefined);
  if (present.length === 0) return false;
  return present.every((value) => typeof value === "number");
}

function categoryPairs(categories: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < categories.length; i++) {
    for (let j = i + 1; j < categories.length; j++) {
      pairs.push([categories[i], categories[j]]);
    }
  }
  return pairs;
}

/**
 * Computes every pre-specified banner x stub comparison for one raw table.
 * Only ever tests the columns named in bannerColumns/stubColumns, via
 * every pairwise comparison of a banner column's own categories (capped at
 * MAX_CATEGORY_CARDINALITY) -- never a search across columns not named,
 * which is exactly the discipline tableComputation.ts's disabled
 * decision-stump search lacked.
 *
 * Per the 2026-10-05 decision, every tested comparison is returned, not
 * just the significant ones: a non-significant result is tagged with a
 * "not_significant" caveat instead of being discarded, so the Findings
 * list shows the full pre-specified plan rather than only the differences
 * that happened to clear significance. verifyFindings.ts reads that tag
 * and routes the finding to a "not_supported" verdict, which keeps it out
 * of insight and recommendation generation while still surfacing it, badged,
 * for review.
 */
export function computeBannerPlanPatterns(
  rows: Row[],
  bannerColumns: string[],
  stubColumns: string[]
): BannerComparisonPattern[] {
  const patterns: BannerComparisonPattern[] = [];

  for (const bannerColumn of bannerColumns) {
    const allBannerCategories = distinctCategories(rows, bannerColumn);
    // A banner column is meant to be a segmenting variable (Gender, Region,
    // a handful of named groups), not a continuous measurement. A numeric
    // column with more distinct values than the cardinality cap is a
    // continuous reading in disguise (Arsenic_Level, a timestamp, an ID),
    // and comparing individual readings against each other row by row is
    // never meaningful, no matter how the categories get capped -- so this
    // skips it entirely rather than silently truncating it into a
    // degenerate comparison. A numeric column with few distinct values
    // (say, number of children, 0-4) is a legitimate discrete banner and
    // still goes through below.
    if (isNumericColumn(rows, bannerColumn) && allBannerCategories.length > MAX_CATEGORY_CARDINALITY) continue;

    const categories = allBannerCategories.slice(0, MAX_CATEGORY_CARDINALITY);
    if (categories.length < 2) continue;

    const groupsByCategory = new Map<string, { index: number; row: Row }[]>();
    for (const category of categories) {
      groupsByCategory.set(
        category,
        rows
          .map((row, index) => ({ index, row }))
          .filter(({ row }) => String(row[bannerColumn]) === category)
      );
    }

    for (const stubColumn of stubColumns) {
      if (stubColumn === bannerColumn) continue;
      const stubIsNumeric = isNumericColumn(rows, stubColumn);

      // Numeric stub with more than two banner categories: run the omnibus
      // ANOVA first, exactly once for this banner/stub pair, instead of
      // going straight to every pairwise combination. Pairwise comparisons
      // only run afterward, and only if the ANOVA itself came back
      // significant -- the standard "omnibus, then post-hoc" convention,
      // which also means a banner column with many categories (common once
      // School/Region/etc. have a dozen+ values) produces one honest answer
      // to "do these groups differ at all" instead of dozens of individually
      // underpowered, multiple-comparison-inflated pairwise tests.
      if (stubIsNumeric && categories.length > 2) {
        const anovaGroups = categories.map((category) => ({
          label: category,
          values: (groupsByCategory.get(category) ?? [])
            .map(({ row }) => row[stubColumn])
            .filter((value): value is number => typeof value === "number"),
        }));
        const anova = oneWayAnova(anovaGroups);

        // oneWayAnova only returns null/null when fewer than two groups
        // have at least two readings each -- most often every group here
        // has exactly one reading (one arsenic test per school, say), so
        // there's no within-group spread to test against at all. That's
        // not "no difference found", it's "nothing to test", so rather
        // than silently dropping the pair, surface one descriptive finding
        // per category: its single value (or small-sample mean), with no
        // significance claim attached. No pairwise fallback either -- the
        // same lack of spread that sinks the omnibus test sinks every
        // pairwise t-test built on it.
        if (anova.fStat === null && anova.pValue === null) {
          for (const category of categories) {
            const groupRows = groupsByCategory.get(category) ?? [];
            const values = groupRows.map(({ row }) => row[stubColumn]).filter((value): value is number => typeof value === "number");
            if (values.length === 0) continue;
            const mean = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
            patterns.push({
              patternType: "banner_comparison",
              description:
                `${stubColumn} for ${bannerColumn} "${category}": ${mean}` +
                (values.length > 1 ? ` (n=${values.length}).` : ` (single reading).`) +
                ` Too little data in this group to test against the others.`,
              theme: `${bannerColumn} & ${stubColumn}`,
              statedStats: {
                testType: "descriptive_summary",
                category,
                n: values.length,
                mean,
                bannerColumn,
                stubColumn,
                caveats: ["insufficient_n_for_test", "sampling_assumed_random"],
              },
              rowIndices: groupRows.map((g) => g.index),
            });
          }
          continue;
        }

        const allRowIndices = categories.flatMap((category) => (groupsByCategory.get(category) ?? []).map((g) => g.index));
        const meansDescription = anova.groupMeans.map((g) => `${g.label}=${g.mean} (n=${g.n})`).join(", ");

        patterns.push({
          patternType: "banner_comparison",
          description:
            `${stubColumn} by ${bannerColumn} across ${anova.groupMeans.length} groups: ${meansDescription}` +
            (anova.fStat !== null && anova.pValue !== null
              ? ` (F=${anova.fStat}, p=${anova.pValue}).`
              : ".") +
            (anova.significant ? "" : " No significant difference across groups overall (one-way ANOVA)."),
          theme: `${bannerColumn} & ${stubColumn}`,
          statedStats: {
            testType: "one_way_anova",
            fStat: anova.fStat,
            pValue: anova.pValue,
            dfBetween: anova.dfBetween,
            dfWithin: anova.dfWithin,
            significant: anova.significant,
            groupMeans: anova.groupMeans,
            bannerColumn,
            stubColumn,
            caveats: anova.significant
              ? ["sampling_assumed_random"]
              : ["not_significant", "sampling_assumed_random"],
          },
          rowIndices: allRowIndices,
        });

        if (!anova.significant) continue;
        // Falls through to the pairwise loop below only when the omnibus
        // test found a real overall difference, to identify which specific
        // groups it came from.
      }

      for (const [catA, catB] of categoryPairs(categories)) {
        const groupA = groupsByCategory.get(catA) ?? [];
        const groupB = groupsByCategory.get(catB) ?? [];
        if (groupA.length === 0 || groupB.length === 0) continue;

        if (stubIsNumeric) {
          const valuesA = groupA
            .map(({ row }) => row[stubColumn])
            .filter((value): value is number => typeof value === "number");
          const valuesB = groupB
            .map(({ row }) => row[stubColumn])
            .filter((value): value is number => typeof value === "number");
          const comparison = compareGroupMeans(valuesA, valuesB);
          if (comparison.mean1 === null || comparison.mean2 === null) continue;

          const isPostHoc = categories.length > 2;
          patterns.push({
            patternType: "banner_comparison",
            description:
              `${bannerColumn} "${catA}" averages ${comparison.mean1} on ${stubColumn} (n=${valuesA.length}), ` +
              `versus ${comparison.mean2} for "${catB}" (n=${valuesB.length}): a gap of ${comparison.gap} ` +
              `(t=${comparison.tScore}).` +
              (comparison.significant ? "" : " Not statistically significant.") +
              (isPostHoc ? " Post-hoc pairwise comparison, following a significant overall difference across all groups." : ""),
            theme: `${bannerColumn} & ${stubColumn}`,
            statedStats: {
              ...comparison,
              group1Label: catA,
              group2Label: catB,
              n1: valuesA.length,
              n2: valuesB.length,
              bannerColumn,
              stubColumn,
              caveats: [
                ...(comparison.significant ? [] : ["not_significant"]),
                "uncorrected_multiple_comparisons",
                "sampling_assumed_random",
                ...(isPostHoc ? ["post_hoc_after_significant_anova"] : []),
              ],
            },
            rowIndices: [...groupA.map((g) => g.index), ...groupB.map((g) => g.index)],
          });
        } else {
          // Categorical stub: compare, for each category the stub column
          // actually takes, the proportion of each banner group that fell
          // into it. A banner column named "Gender" with a stub named
          // "Preferred channel" (App/Branch/Call centre) produces one
          // comparison per stub category, not one comparison overall.
          const stubCategories = distinctCategories(rows, stubColumn).slice(0, MAX_CATEGORY_CARDINALITY);
          for (const stubCategory of stubCategories) {
            const nA = groupA.length;
            const nB = groupB.length;
            const countA = groupA.filter(({ row }) => String(row[stubColumn]) === stubCategory).length;
            const countB = groupB.filter(({ row }) => String(row[stubColumn]) === stubCategory).length;
            const pA = countA / nA;
            const pB = countB / nB;
            const result = twoProportionGap(nA, pA, nB, pB);

            patterns.push({
              patternType: "banner_comparison",
              description:
                `${bannerColumn} "${catA}" (n=${nA}) versus "${catB}" (n=${nB}) on ${stubColumn}="${stubCategory}": ` +
                `${Math.round(pA * 1000) / 10}% vs ${Math.round(pB * 1000) / 10}% (gap ${result.gapPercent} pts, ` +
                `z=${result.zScore}).` +
                (result.significant ? "" : " Not statistically significant."),
              theme: `${bannerColumn} & ${stubColumn}`,
              statedStats: {
                ...result,
                group1Label: catA,
                group2Label: catB,
                n1: nA,
                n2: nB,
                bannerColumn,
                stubColumn,
                stubCategory,
                caveats: result.significant
                  ? ["uncorrected_multiple_comparisons", "sampling_assumed_random"]
                  : ["not_significant", "uncorrected_multiple_comparisons", "sampling_assumed_random"],
              },
              rowIndices: [...groupA.map((g) => g.index), ...groupB.map((g) => g.index)],
            });
          }
        }
      }
    }
  }

  return patterns;
}
