// The one place the actual Observable Plot recipe for a ChartSpec lives.
// FindingsChart.tsx (client, renders into the browser DOM) and
// renderChartImage.ts (server, renders into a linkedom document for export
// into the Insights Report pptx/docx) both call buildPlotOptions and feed
// the result straight to Plot.plot -- so the two can never quietly drift
// into two different-looking charts for the same ChartSpec.
//
// This file intentionally does not import Plot itself: it returns a plain
// options object plus a marks-builder that needs the caller's own `Plot`
// import, because the client bundle and the server bundle could in
// principle resolve @observablehq/plot differently (ESM vs CJS) and this
// keeps that resolution entirely up to the caller.

import type * as PlotNS from "@observablehq/plot";
import type { ChartSpec } from "./findingsChartData";

// A fixed-order, colorblind-safe categorical palette (Okabe & Ito, 2008),
// used only for the stub-category series in a crosstab chart -- never
// cycled, never reused for status/significance (those stay in the app's own
// success/danger tokens elsewhere on the page). Capped at 8 before a chart
// would need faceting instead of more colors.
export const CATEGORICAL_PALETTE = [
  "#0072B2",
  "#E69F00",
  "#009E73",
  "#CC79A7",
  "#56B4E9",
  "#D55E00",
  "#F0E442",
  "#999999",
];

export const PRIMARY = "#2563eb";

// The scatter chart's linear-fit overlay line: distinct from PRIMARY (the
// points themselves) and from the crosstab's categorical palette, so it
// reads as "a guide drawn over the data" rather than as another data
// series of its own.
export const TREND_LINE_COLOR = "#D55E00";

// Both chart kinds render at this same fixed height so a grid of mixed
// crosstab/means charts comes out even -- see FindingsChart.tsx's own
// comment for why this used to vary and why that was wrong.
export const CHART_HEIGHT = 280;

export type BuildPlotOptionsConfig = {
  // Plot's own color.legend renders as an HTML <div> of swatches sitting
  // alongside the <svg> inside a wrapping <figure> -- fine in a browser,
  // but it means Plot.plot no longer returns a bare <svg> root, which the
  // server-side PNG renderer needs (see renderChartImage.ts, which builds
  // its own manual SVG legend band instead and composites it above the
  // chart). The client component always wants Plot's native legend; the
  // server renderer always wants this off.
  legend?: boolean;
};

export function buildPlotOptions(
  Plot: typeof PlotNS,
  spec: ChartSpec,
  width: number,
  config: BuildPlotOptionsConfig = {},
): PlotNS.PlotOptions {
  const { legend = true } = config;

  if (spec.kind === "categorical_crosstab") {
    const stubCategories = Array.from(
      new Set(spec.bars.map((b) => b.stubCategory)),
    );
    return {
      width,
      height: CHART_HEIGHT,
      marginLeft: 48,
      marginBottom: 36,
      x: { axis: null, paddingInner: 0.1 },
      fx: { label: spec.bannerColumn, tickSize: 0 },
      y: {
        label: `% within ${spec.bannerColumn} group`,
        grid: true,
        percent: false,
      },
      color: {
        legend,
        domain: stubCategories,
        range: CATEGORICAL_PALETTE.slice(0, stubCategories.length),
      },
      marks: [
        Plot.ruleY([0]),
        Plot.barY(spec.bars, {
          x: "stubCategory",
          y: "percent",
          fx: "bannerCategory",
          fill: "stubCategory",
          rx: 2,
          tip: true,
          title: (d: {
            bannerCategory: string;
            stubCategory: string;
            percent: number;
          }) => `${d.bannerCategory} → ${d.stubCategory}\n${d.percent}%`,
        }),
        Plot.axisY({ label: null }),
      ],
    };
  }

  if (spec.kind === "group_means") {
    return {
      width,
      height: CHART_HEIGHT,
      marginLeft: 56,
      marginBottom: 48,
      x: {
        label: spec.bannerColumn,
        tickRotate: spec.bars.length > 5 ? -20 : 0,
      },
      y: { label: `Mean ${spec.stubColumn}`, grid: true },
      marks: [
        Plot.ruleY([0]),
        Plot.barY(spec.bars, {
          x: "category",
          y: "mean",
          fill: PRIMARY,
          rx: 2,
          tip: true,
          title: (d: { category: string; mean: number; n: number }) =>
            `${d.category}\nmean ${d.mean} (n=${d.n})`,
        }),
        Plot.text(spec.bars, {
          x: "category",
          y: "mean",
          text: (d: { mean: number }) => String(d.mean),
          dy: -8,
          fill: "#374151",
          fontSize: 11,
        }),
        Plot.axisY({ label: null }),
      ],
    };
  }

  if (spec.kind === "scatter") {
    return {
      width,
      height: CHART_HEIGHT,
      marginLeft: 56,
      marginBottom: 48,
      x: { label: spec.variable1, grid: true },
      y: { label: spec.variable2, grid: true },
      marks: [
        Plot.dot(spec.points, {
          x: "x",
          y: "y",
          r: 3,
          fill: PRIMARY,
          fillOpacity: 0.55,
          tip: true,
        }),
        // A linear fit line is a visual aid for the association's direction
        // and strength, not a claim of a linear model fit to report on its
        // own -- the caption's r-value is what's actually being asserted.
        Plot.linearRegressionY(spec.points, {
          x: "x",
          y: "y",
          stroke: TREND_LINE_COLOR,
          strokeWidth: 2,
        }),
      ],
    };
  }

  // outlier_strip
  return {
    width,
    height: CHART_HEIGHT,
    marginLeft: 56,
    marginBottom: 48,
    x: {
      label: "Flagged values, ranked by size of deviation",
      tickRotate: spec.bars.length > 8 ? -20 : 0,
    },
    y: { label: "SD from comparison mean", grid: true },
    marks: [
      Plot.ruleY([0]),
      Plot.barY(spec.bars, {
        x: "label",
        y: "z",
        fill: PRIMARY,
        rx: 2,
        tip: true,
        title: (d: { label: string; z: number; value: number }) =>
          `${d.label}: value ${d.value}\n${d.z >= 0 ? "+" : ""}${d.z} SD`,
      }),
      // Plot's `dy` is a constant style option, not a per-datum channel, so
      // positive and negative bars (whose labels sit above vs. below the
      // bar tip) need two separate text layers rather than one dy function.
      Plot.text(
        spec.bars.filter((d) => d.z >= 0),
        {
          x: "label",
          y: "z",
          text: (d: { value: number }) => String(d.value),
          dy: -8,
          fill: "#374151",
          fontSize: 11,
        },
      ),
      Plot.text(
        spec.bars.filter((d) => d.z < 0),
        {
          x: "label",
          y: "z",
          text: (d: { value: number }) => String(d.value),
          dy: 14,
          fill: "#374151",
          fontSize: 11,
        },
      ),
      Plot.axisY({ label: null }),
    ],
  };
}

// Categories + matching colors for the categorical_crosstab's legend, in
// the same fixed order buildPlotOptions assigns them -- used by
// renderChartImage.ts to draw the manual legend band it composites above
// the rasterized chart.
export function crosstabLegendEntries(
  spec: Extract<ChartSpec, { kind: "categorical_crosstab" }>,
): { label: string; color: string }[] {
  const stubCategories = Array.from(
    new Set(spec.bars.map((b) => b.stubCategory)),
  );
  return stubCategories.map((label, i) => ({
    label,
    color: CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length],
  }));
}
