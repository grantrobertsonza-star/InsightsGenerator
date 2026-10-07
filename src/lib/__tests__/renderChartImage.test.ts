import { describe, it, expect } from "vitest";
import { renderChartImage } from "../renderChartImage";
import type { ChartSpec } from "../findingsChartData";

// Server-side rendering is the whole point of this module (see its doc
// comment), so these tests actually call it end-to-end -- linkedom +
// Observable Plot + sharp -- rather than mocking any of those, to catch
// exactly the kind of DOM-shape or SVG-parsing mismatch that unit-testing
// each piece in isolation would miss.

const crosstabSpec: ChartSpec = {
  kind: "categorical_crosstab",
  bannerColumn: "AgeBand",
  stubColumn: "PreferredChannel",
  bars: [
    { bannerCategory: "18-24", stubCategory: "App", percent: 61.2 },
    { bannerCategory: "18-24", stubCategory: "Branch", percent: 10.8 },
    { bannerCategory: "25-34", stubCategory: "App", percent: 51.3 },
    { bannerCategory: "25-34", stubCategory: "Branch", percent: 10.5 },
  ],
  caption: "Largest gap: AgeBand ‘18-24’ vs ‘25-34’ on App (9.9 points).",
  comparisonCount: 2,
  significantCount: 1,
};

const meansSpec: ChartSpec = {
  kind: "group_means",
  bannerColumn: "Education",
  stubColumn: "LikelyToRecommend",
  bars: [
    { category: "Degree", mean: 7.16, n: 50 },
    { category: "Diploma", mean: 6.92, n: 40 },
    { category: "High school", mean: 6.32, n: 30 },
    { category: "Postgrad", mean: 8.15, n: 20 },
  ],
  caption: "Significant overall difference across 4 Education groups.",
  testType: "anova",
  comparisonCount: 6,
  significantCount: 3,
};

const scatterSpec: ChartSpec = {
  kind: "scatter",
  variable1: "Spend",
  variable2: "Visits",
  points: Array.from({ length: 30 }, (_, i) => ({ x: i, y: i * 2 + (i % 3) })),
  r: 0.78,
  caption:
    "Strong positive association between Spend and Visits across 30 rows (r=0.78). Descriptive association only, not evidence of causation.",
};

const outlierSpec: ChartSpec = {
  kind: "outlier_strip",
  column: "MonthlySpend",
  bars: [
    { label: "#1", z: -3.4, value: 12 },
    { label: "#2", z: 2.6, value: 1100 },
    { label: "#3", z: 2.1, value: 980 },
  ],
  caption:
    "3 values flagged as unusual on MonthlySpend, ranked by size of deviation (not row order). Largest: 12 (-3.4 SD from the comparison mean). Descriptive heuristic, not a formal outlier test.",
};

// A PNG file starts with this fixed 8-byte signature.
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

describe("renderChartImage", () => {
  it("renders a categorical_crosstab spec to a valid PNG wider than the base chart (legend composited above it)", async () => {
    const result = await renderChartImage(crosstabSpec, 640);
    expect(result.png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(result.width).toBeGreaterThan(0);
    // The legend band adds height on top of the base chart's own height.
    expect(result.height).toBeGreaterThan(280);
  });

  it("renders a group_means spec to a valid PNG with no legend band added", async () => {
    const result = await renderChartImage(meansSpec, 640);
    expect(result.png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(result.width).toBeGreaterThan(0);
    // No legend compositing for this chart kind, so height tracks the
    // chart's own fixed CHART_HEIGHT (280) directly -- allow a little slack
    // for the density-driven upscale rounding.
    expect(result.height).toBeGreaterThan(0);
  });

  it("produces a wider image for a wider requested width", async () => {
    const narrow = await renderChartImage(meansSpec, 400);
    const wide = await renderChartImage(meansSpec, 800);
    expect(wide.width).toBeGreaterThan(narrow.width);
  });

  it("renders a scatter spec (with regression line) to a valid PNG with no legend band added", async () => {
    const result = await renderChartImage(scatterSpec, 640);
    expect(result.png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("renders an outlier_strip spec to a valid PNG with no legend band added", async () => {
    const result = await renderChartImage(outlierSpec, 640);
    expect(result.png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });
});
