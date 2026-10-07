import { describe, it, expect } from "vitest";
import {
  buildChartForThemeGroup,
  type ChartableFinding,
} from "../findingsChartData";

function crosstabFinding(
  overrides: Partial<ChartableFinding> & {
    stats?: Record<string, unknown>;
  } = {},
): ChartableFinding {
  const { stats, ...rest } = overrides;
  return {
    id: "f1",
    origin: "generated",
    pattern_type: "banner_comparison",
    theme: "AgeBand & PreferredChannel",
    status: "accepted",
    stated_stats: {
      bannerColumn: "AgeBand",
      stubColumn: "PreferredChannel",
      stubCategory: "App",
      group1Label: "18-24",
      group2Label: "25-34",
      n1: 50,
      n2: 60,
      pctA: 40.1,
      pctB: 25.3,
      gapPercent: 14.8,
      zScore: 2.1,
      significant: true,
      ...stats,
    },
    ...rest,
  };
}

describe("buildChartForThemeGroup", () => {
  it("returns null for an empty list", () => {
    expect(buildChartForThemeGroup([])).toBeNull();
  });

  it("returns null when the theme mixes in a non-generated finding", () => {
    const findings = [
      crosstabFinding(),
      crosstabFinding({ id: "f2", origin: "stated", pattern_type: null }),
    ];
    expect(buildChartForThemeGroup(findings)).toBeNull();
  });

  it("builds a categorical crosstab chart, deduping repeated category percentages", () => {
    const findings = [
      crosstabFinding({
        id: "f1",
        stats: {
          stubCategory: "App",
          group1Label: "18-24",
          group2Label: "25-34",
          pctA: 40,
          pctB: 25,
          gapPercent: 15,
          zScore: 2.5,
          significant: true,
        },
      }),
      crosstabFinding({
        id: "f2",
        stats: {
          stubCategory: "App",
          group1Label: "18-24",
          group2Label: "35-44",
          pctA: 40,
          pctB: 20,
          gapPercent: 20,
          zScore: 3.1,
          significant: true,
        },
      }),
      crosstabFinding({
        id: "f3",
        stats: {
          stubCategory: "Branch",
          group1Label: "18-24",
          group2Label: "25-34",
          pctA: 10,
          pctB: 12,
          gapPercent: -2,
          zScore: 0.4,
          significant: false,
        },
      }),
    ];

    const spec = buildChartForThemeGroup(findings);
    expect(spec).not.toBeNull();
    if (!spec || spec.kind !== "categorical_crosstab")
      throw new Error("wrong kind");

    expect(spec.bannerColumn).toBe("AgeBand");
    expect(spec.stubColumn).toBe("PreferredChannel");
    expect(spec.comparisonCount).toBe(3);
    expect(spec.significantCount).toBe(2);
    // 18-24/App appears in two findings with the same 40 -- deduped to one bar.
    const appBars = spec.bars.filter((b) => b.stubCategory === "App");
    expect(appBars).toHaveLength(3); // 18-24, 25-34, 35-44
    expect(appBars.find((b) => b.bannerCategory === "18-24")?.percent).toBe(40);
    expect(spec.caption).toContain("2 of 3 comparisons");
    expect(spec.caption).toContain("18-24");
    expect(spec.caption).toContain("35-44");
  });

  it("falls back gracefully when pctA/pctB are missing (pre-migration findings)", () => {
    const findings = [
      crosstabFinding({
        stats: { pctA: undefined, pctB: undefined },
      }),
    ];
    expect(buildChartForThemeGroup(findings)).toBeNull();
  });

  it("builds a group_means chart from an ANOVA finding's groupMeans", () => {
    const findings: ChartableFinding[] = [
      {
        id: "a1",
        origin: "generated",
        pattern_type: "banner_comparison",
        theme: "Education & Satisfaction",
        status: "accepted",
        stated_stats: {
          testType: "one_way_anova",
          bannerColumn: "Education",
          stubColumn: "Satisfaction",
          fStat: 5.2,
          pValue: 0.002,
          significant: true,
          groupMeans: [
            { label: "Degree", n: 40, mean: 7.48 },
            { label: "Postgrad", n: 30, mean: 6.76 },
            { label: "Diploma", n: 25, mean: 7.1 },
          ],
        },
      },
      {
        id: "a2",
        origin: "generated",
        pattern_type: "banner_comparison",
        theme: "Education & Satisfaction",
        status: "accepted",
        stated_stats: {
          bannerColumn: "Education",
          stubColumn: "Satisfaction",
          group1Label: "Degree",
          group2Label: "Postgrad",
          mean1: 7.48,
          mean2: 6.76,
          gap: 0.72,
          tScore: 2.9,
          significant: true,
          n1: 40,
          n2: 30,
        },
      },
    ];

    const spec = buildChartForThemeGroup(findings);
    expect(spec).not.toBeNull();
    if (!spec || spec.kind !== "group_means") throw new Error("wrong kind");
    expect(spec.testType).toBe("anova");
    expect(spec.bars).toHaveLength(3);
    expect(spec.bars.find((b) => b.category === "Degree")?.mean).toBe(7.48);
    expect(spec.caption).toContain("Significant overall difference");
    expect(spec.caption).toContain("Degree");
  });

  it("builds a group_means chart from a lone pairwise mean-gap finding (two-category case)", () => {
    const findings: ChartableFinding[] = [
      {
        id: "p1",
        origin: "generated",
        pattern_type: "banner_comparison",
        theme: "Gender & Spend",
        status: "accepted",
        stated_stats: {
          bannerColumn: "Gender",
          stubColumn: "Spend",
          group1Label: "Male",
          group2Label: "Female",
          mean1: 120,
          mean2: 95,
          gap: 25,
          tScore: 1.8,
          significant: false,
          n1: 40,
          n2: 42,
        },
      },
    ];

    const spec = buildChartForThemeGroup(findings);
    expect(spec).not.toBeNull();
    if (!spec || spec.kind !== "group_means") throw new Error("wrong kind");
    expect(spec.testType).toBe("pairwise");
    expect(spec.bars).toHaveLength(2);
    expect(spec.caption).toContain("No statistically significant gap");
  });

  it("builds a group_means chart from a segment_difference finding via the bannerColumn/stubColumn aliasing", () => {
    const findings: ChartableFinding[] = [
      {
        id: "s1",
        origin: "generated",
        pattern_type: "segment_difference",
        theme: "Region & Tenure",
        status: "accepted",
        stated_stats: {
          bannerColumn: "Region",
          stubColumn: "Tenure",
          group1Label: "North",
          group2Label: "South",
          mean1: 4.2,
          mean2: 3.1,
          gap: 1.1,
          tScore: 2.4,
          significant: true,
          n1: 35,
          n2: 38,
        },
      },
    ];

    const spec = buildChartForThemeGroup(findings);
    expect(spec).not.toBeNull();
    if (!spec || spec.kind !== "group_means") throw new Error("wrong kind");
    expect(spec.bannerColumn).toBe("Region");
    expect(spec.stubColumn).toBe("Tenure");
    expect(spec.testType).toBe("pairwise");
    expect(spec.bars).toHaveLength(2);
    expect(spec.caption).toContain("Statistically significant gap");
  });

  it("returns null for a theme mixing segment_difference and banner_comparison findings", () => {
    const findings: ChartableFinding[] = [
      {
        id: "m1",
        origin: "generated",
        pattern_type: "segment_difference",
        theme: "Mixed & Theme",
        status: "accepted",
        stated_stats: {
          bannerColumn: "Region",
          stubColumn: "Tenure",
          group1Label: "North",
          group2Label: "South",
          mean1: 4.2,
          mean2: 3.1,
          gap: 1.1,
          tScore: 2.4,
          significant: true,
          n1: 35,
          n2: 38,
        },
      },
      {
        id: "m2",
        origin: "generated",
        pattern_type: "banner_comparison",
        theme: "Mixed & Theme",
        status: "accepted",
        stated_stats: {
          bannerColumn: "Region",
          stubColumn: "Tenure",
          group1Label: "North",
          group2Label: "East",
          mean1: 4.2,
          mean2: 3.6,
          gap: 0.6,
          tScore: 1.1,
          significant: false,
          n1: 35,
          n2: 30,
        },
      },
    ];

    expect(buildChartForThemeGroup(findings)).toBeNull();
  });

  it("builds a scatter chart from a relationship finding, picking the larger |r| when several share a theme", () => {
    const points = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i * 2 }));
    const findings: ChartableFinding[] = [
      {
        id: "r1",
        origin: "generated",
        pattern_type: "relationship",
        theme: "Spend & Visits",
        status: "accepted",
        stated_stats: {
          variable1: "Spend",
          variable2: "Visits",
          r: 0.42,
          pairCount: 10,
          points,
        },
      },
      {
        id: "r2",
        origin: "generated",
        pattern_type: "relationship",
        theme: "Spend & Visits",
        status: "accepted",
        stated_stats: {
          variable1: "Spend",
          variable2: "Visits",
          r: -0.81,
          pairCount: 10,
          points,
        },
      },
    ];

    const spec = buildChartForThemeGroup(findings);
    expect(spec).not.toBeNull();
    if (!spec || spec.kind !== "scatter") throw new Error("wrong kind");
    expect(spec.variable1).toBe("Spend");
    expect(spec.variable2).toBe("Visits");
    expect(spec.r).toBe(-0.81);
    expect(spec.points).toHaveLength(10);
    expect(spec.caption).toContain("Strong negative association");
    expect(spec.caption).toContain("not evidence of causation");
  });

  it("returns null for a relationship finding missing points", () => {
    const findings: ChartableFinding[] = [
      {
        id: "r1",
        origin: "generated",
        pattern_type: "relationship",
        theme: "Spend & Visits",
        status: "accepted",
        stated_stats: {
          variable1: "Spend",
          variable2: "Visits",
          r: 0.42,
          pairCount: 10,
        },
      },
    ];
    expect(buildChartForThemeGroup(findings)).toBeNull();
  });

  it("builds an outlier_strip chart, sorting bars by |z| and labeling by rank", () => {
    const findings: ChartableFinding[] = [
      {
        id: "o1",
        origin: "generated",
        pattern_type: "outlier",
        theme: "MonthlySpend",
        status: "accepted",
        stated_stats: { column: "MonthlySpend", z: 2.1, value: 980 },
      },
      {
        id: "o2",
        origin: "generated",
        pattern_type: "outlier",
        theme: "MonthlySpend",
        status: "accepted",
        stated_stats: { column: "MonthlySpend", z: -3.4, value: 12 },
      },
      {
        id: "o3",
        origin: "generated",
        pattern_type: "outlier",
        theme: "MonthlySpend",
        status: "accepted",
        stated_stats: { column: "MonthlySpend", z: 2.6, value: 1100 },
      },
    ];

    const spec = buildChartForThemeGroup(findings);
    expect(spec).not.toBeNull();
    if (!spec || spec.kind !== "outlier_strip") throw new Error("wrong kind");
    expect(spec.column).toBe("MonthlySpend");
    expect(spec.bars).toHaveLength(3);
    // Sorted by |z| descending: -3.4, 2.6, 2.1
    expect(spec.bars.map((b) => b.label)).toEqual(["#1", "#2", "#3"]);
    expect(spec.bars[0].z).toBe(-3.4);
    expect(spec.bars[0].value).toBe(12);
    expect(spec.caption).toContain("3 values flagged as unusual");
    expect(spec.caption).toContain("not row order");
  });

  it("returns null for an outlier theme with inconsistent columns", () => {
    const findings: ChartableFinding[] = [
      {
        id: "o1",
        origin: "generated",
        pattern_type: "outlier",
        theme: "MonthlySpend",
        status: "accepted",
        stated_stats: { column: "MonthlySpend", z: 2.1, value: 980 },
      },
      {
        id: "o2",
        origin: "generated",
        pattern_type: "outlier",
        theme: "MonthlySpend",
        status: "accepted",
        stated_stats: { column: "AnnualSpend", z: -3.4, value: 12 },
      },
    ];
    expect(buildChartForThemeGroup(findings)).toBeNull();
  });
});
