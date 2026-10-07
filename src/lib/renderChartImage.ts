// Server-side rendering of a ChartSpec (see findingsChartData.ts) to a PNG
// buffer, for embedding into the Insights Report exports (deckSlides.ts /
// docxReport.ts) -- those routes run in Node with no browser DOM, so the
// same Observable Plot call the on-screen FindingsChart.tsx makes can't
// just run as-is.
//
// linkedom supplies a minimal DOM (Plot only needs createElementNS,
// createElement, and a document.documentElement to clone from) so Plot.plot
// produces a real SVG element here exactly as it would in a browser; sharp
// then rasterizes that SVG string to PNG. Neither a headless browser nor
// jsdom's much heavier footprint is needed for marks this simple (bars,
// rules, text).
//
// buildPlotOptions (plotChartOptions.ts) is the single source of truth for
// the chart recipe itself, shared with FindingsChart.tsx, so an exported
// chart and the one shown on the Findings page are never two different
// pictures of the same ChartSpec. The one deliberate difference: Plot's own
// color.legend renders as an HTML swatch strip wrapped in a <figure> around
// the <svg>, which sharp can't rasterize as a single image (it expects an
// <svg> root). So the legend is turned off in buildPlotOptions here and
// redrawn as a second, tiny SVG this file builds by hand, then composited
// above the chart with sharp -- same colors, same labels, same fixed order,
// just assembled as one flat image instead of Plot's own figure markup.

import * as Plot from "@observablehq/plot";
import { DOMParser } from "linkedom";
import sharp from "sharp";
import {
  buildPlotOptions,
  crosstabLegendEntries,
  CHART_HEIGHT,
} from "./plotChartOptions";
import type { ChartSpec } from "./findingsChartData";

function createPlotDocument() {
  return new DOMParser().parseFromString(
    "<!doctype html><html><body></body></html>",
    "text/html",
  );
}

export type RenderedChartImage = {
  /** PNG bytes, ready to hand straight to pptxgenjs addImage / docx ImageRun. */
  png: Buffer;
  /** The image's pixel dimensions, i.e. the aspect ratio to lay it out at. */
  width: number;
  height: number;
};

// 220 DPI (~3x a 72dpi SVG) keeps bar labels and axis text crisp once the
// image is placed at a few inches wide on a slide or in a docx page --
// confirmed visually against a sample render before wiring this in.
const RENDER_DENSITY = 220;

const LEGEND_SWATCH = 12;
const LEGEND_GAP = 8;
const LEGEND_FONT_SIZE = 11;
const LEGEND_BAND_HEIGHT = 32;

function buildLegendSvg(
  entries: { label: string; color: string }[],
  width: number,
): string {
  // No real text-measurement available outside a browser, so item widths
  // are estimated from character count -- generous enough (0.6em/char at
  // this font) that labels don't collide, at the cost of the legend not
  // being perfectly centered when estimates run a little long.
  const itemWidths = entries.map(
    (e) =>
      LEGEND_SWATCH +
      4 +
      e.label.length * (LEGEND_FONT_SIZE * 0.6) +
      LEGEND_GAP * 2,
  );
  const totalWidth = itemWidths.reduce((a, b) => a + b, 0);
  let x = Math.max(0, (width - totalWidth) / 2);
  const rectY = (LEGEND_BAND_HEIGHT - LEGEND_SWATCH) / 2;

  const items = entries
    .map((entry, i) => {
      const itemWidth = itemWidths[i];
      const swatchX = x + LEGEND_GAP;
      const textX = swatchX + LEGEND_SWATCH + 4;
      const markup =
        `<rect x="${swatchX}" y="${rectY}" width="${LEGEND_SWATCH}" height="${LEGEND_SWATCH}" rx="2" fill="${entry.color}" />` +
        `<text x="${textX}" y="${rectY + LEGEND_SWATCH - 1}" font-size="${LEGEND_FONT_SIZE}" font-family="system-ui, sans-serif" fill="#374151">${escapeXml(entry.label)}</text>`;
      x += itemWidth;
      return markup;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LEGEND_BAND_HEIGHT}">${items}</svg>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function rasterizeSvg(svg: string): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
}> {
  const buffer = await sharp(Buffer.from(svg), { density: RENDER_DENSITY })
    .png()
    .toBuffer();
  const metadata = await sharp(buffer).metadata();
  return { buffer, width: metadata.width ?? 0, height: metadata.height ?? 0 };
}

export async function renderChartImage(
  spec: ChartSpec,
  widthPx = 640,
): Promise<RenderedChartImage> {
  // linkedom's Document is structurally a DOM Document for everything Plot
  // actually calls (createElementNS, createElement, documentElement) but
  // doesn't implement the full lib.dom.d.ts surface, so Plot's own
  // PlotOptions["document"] type (a real Document) needs an escape hatch
  // here rather than TypeScript rejecting a perfectly working value.
  const document = createPlotDocument() as unknown as Document;
  const options = buildPlotOptions(Plot, spec, widthPx, { legend: false });
  const svgElement = Plot.plot({
    ...options,
    document,
  }) as unknown as { outerHTML: string; remove?: () => void };

  const chartSvg = svgElement.outerHTML;
  svgElement.remove?.();

  const chart = await rasterizeSvg(chartSvg);

  if (spec.kind !== "categorical_crosstab") {
    return { png: chart.buffer, width: chart.width, height: chart.height };
  }

  // Crosstab charts need the legend to be readable at all (fill color is
  // the only thing distinguishing the stub categories), so always build and
  // composite it rather than making it optional.
  const legendEntries = crosstabLegendEntries(spec);
  const legendSvg = buildLegendSvg(legendEntries, widthPx);
  const legend = await rasterizeSvg(legendSvg);

  const combinedWidth = Math.max(chart.width, legend.width);
  const combinedHeight = chart.height + legend.height;

  const png = await sharp({
    create: {
      width: combinedWidth,
      height: combinedHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      {
        input: legend.buffer,
        top: 0,
        left: Math.round((combinedWidth - legend.width) / 2),
      },
      { input: chart.buffer, top: legend.height, left: 0 },
    ])
    .png()
    .toBuffer();

  return { png, width: combinedWidth, height: combinedHeight };
}

// Re-exported so callers (the export routes) can size the placed image
// without re-deriving the base chart height Plot itself was given.
export { CHART_HEIGHT };
