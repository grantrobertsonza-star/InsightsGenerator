"use client";

import { useRef } from "react";
import type { ChartResult } from "@/lib/chartActions";
import type { LegendPos } from "./ChartCustomize";
import { ChartExportButtons, useSvgImageExport } from "./chartImageExport";

/**
 * A slide-ready column chart of one variable's answer distribution, one series of columns per group
 * category when the chart was split by a second variable. Same drawing and export approach as NpsVisual:
 * one inline SVG, rasterised client-side for "Copy image" and "Download PNG", no charting library and no
 * server round trip.
 *
 * Title, colours and legend position are controlled from the parent rather than held here: when several
 * of these sit in a grid together (the Analytics chart tool), one shared customise panel edits whichever
 * card is selected, instead of every card carrying its own copy of the same controls.
 *
 * `variant` (Grant, 2026-10-20) draws the same distribution three ways on the same axes: "bar" (the
 * original columns, unchanged), "line" (one line with point markers per series across the same
 * categories) and "histogram" (one series of touching columns, in the order the values come). The
 * figures are identical in all three; only the drawing differs.
 */
// Shades of the app's own primary blue (#2563eb) rather than a rainbow categorical palette, so a chart with
// several series reads as part of the same product instead of clashing with it. Dark to light, with enough
// separation between adjacent steps to stay readable up to the 8-series cap.
export const SERIES_COLORS = ["#1e3a8a", "#2563eb", "#0ea5e9", "#1d4ed8", "#38bdf8", "#1e40af", "#7dd3fc", "#172554"];
const round1 = (x: number) => Math.round(x * 10) / 10;

const BASE_W = 760;
const PAD_L = 44;
const PAD_R = 30;
const PAD_TOP = 60;
const PLOT_H = 320;
const PAD_BOTTOM = 64;
const LEGEND_H = 26;
// A bar narrower than this is where value labels start landing on top of their neighbour's, the
// "wall of numbers" failure mode a fixed-width chart hits once there are several series and a dozen-plus
// categories. Below it the chart still draws (categories can't be dropped), it just stops captioning
// every single bar.
const MIN_BAR_W = 20;
const BAR_GAP = 3;
const CLUSTER_GAP = 20;

export default function ChartVisual({
  result,
  title,
  colors,
  legendPos = "top",
  variant = "bar",
}: {
  result: ChartResult;
  title: string;
  colors: string[];
  legendPos?: LegendPos;
  variant?: "bar" | "line" | "histogram";
}) {
  const series = result.series;
  const grouped = result.grouped && series.length > 1;
  const categories = series[0]?.bars.map((b) => b.label) ?? [];
  const n = categories.length;
  const legendH = grouped ? LEGEND_H : 0;
  const legendTop = grouped && legendPos === "top" ? legendH : 0;
  const legendBottom = grouped && legendPos === "bottom" ? legendH + 14 : 0;
  const H = PAD_TOP + legendTop + PLOT_H + PAD_BOTTOM + legendBottom;

  // Width grows with how much is actually being plotted (categories x series) instead of squeezing an
  // arbitrary number of bars into a fixed canvas: every bar keeps at least MIN_BAR_W, and the chart scrolls
  // horizontally once that no longer fits the card rather than shrinking bars to a few illegible pixels.
  const clusterW = series.length * MIN_BAR_W + Math.max(0, series.length - 1) * BAR_GAP;
  const colW = Math.max(56, clusterW + CLUSTER_GAP);
  // The viewBox matches what's actually being plotted, no artificial minimum: with few categories a wider
  // floor here used to leave the bars bunched on the left once the card stretched to fill its column, with
  // everything past the last bar left blank. A chart with plenty of categories still scrolls instead of
  // squeezing (the "wide" case below), it just no longer also forces that width on a two-bar chart.
  const plotW = n * colW;
  const W = PAD_L + PAD_R + plotW;
  const wide = W > BASE_W;

  const maxPct = Math.max(...series.flatMap((s) => s.bars.map((b) => b.pct)), 1) * 1.15;
  const baseline = PAD_TOP + legendTop + PLOT_H;
  const xOf = (i: number) => PAD_L + (i + 0.5) * colW;
  const barW = MIN_BAR_W;
  const yOf = (pct: number) => baseline - (pct / maxPct) * PLOT_H;
  const colorOf = (j: number) => colors[j] ?? SERIES_COLORS[j % SERIES_COLORS.length];
  // Every bar gets its value: MIN_BAR_W already guarantees real room between bars (the chart grows and
  // scrolls rather than squeezing them), so the label just needs to stay small enough to sit over its own
  // bar without reaching into the next one.
  const labelSize = grouped ? (series.length > 4 ? "7.5" : "8.5") : "12";

  const svgRef = useRef<SVGSVGElement>(null);
  const exp = useSvgImageExport(svgRef, `chart-${result.variable}.png`, W, H);

  if (n === 0) return null;
  // Long category text (full answer wording) reads better rotated under the column; a short scale like
  // 0 to 10 stays flat.
  const longLabels = categories.some((c) => c.length > 4);

  const legendRow = (y: number) => (
    <g transform={`translate(${PAD_L}, ${y})`}>
      {series.map((s, j) => (
        <g key={s.name} transform={`translate(${j * 150}, 0)`}>
          <rect width="10" height="10" rx="2" fill={colorOf(j)} />
          <text x="14" y="9" fontSize="10.5" fontWeight="600" fill="#334155" fontFamily="system-ui, -apple-system, sans-serif">
            {s.name.length > 20 ? `${s.name.slice(0, 19)}…` : s.name} (n={s.n})
          </text>
        </g>
      ))}
    </g>
  );

  return (
    <div className="max-w-3xl space-y-3">
      <div className={wide ? "overflow-x-auto rounded-xl border border-border bg-white" : "rounded-xl border border-border bg-white"}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width={wide ? W : "100%"}
          height={wide ? H : undefined}
          style={wide ? { display: "block" } : undefined}
          className={wide ? undefined : "w-full"}
        >
          <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
          <text x={W / 2} y="26" textAnchor="middle" fontSize="18" fontWeight="700" fill="#0f172a" fontFamily="system-ui, -apple-system, sans-serif">
            {title}
          </text>
          <text x={W / 2} y="44" textAnchor="middle" fontSize="11.5" fill="#64748b" fontFamily="system-ui, -apple-system, sans-serif">
            {result.n.toLocaleString()} cases{result.weighted ? ", weighted" : ""}
            {result.grouped ? `, split by ${result.groupLabel}` : ""}
          </text>
          {grouped && legendPos === "top" && legendRow(PAD_TOP + 6)}
          <line x1={PAD_L} y1={baseline} x2={W - PAD_R} y2={baseline} stroke="currentColor" opacity="0.3" />
          {categories.map((label, i) => {
            const cx = xOf(i);
            const text = label.length > 22 ? `${label.slice(0, 21)}…` : label;
            return (
              <text
                key={`label-${i}`}
                x={cx}
                y={baseline + (longLabels ? 14 : 16)}
                textAnchor={longLabels ? "end" : "middle"}
                fontSize="11"
                fill="#334155"
                fontFamily="system-ui, -apple-system, sans-serif"
                transform={longLabels ? `rotate(-35 ${cx} ${baseline + 14})` : undefined}
              >
                {text}
              </text>
            );
          })}
          {variant === "bar" &&
            categories.map((_, i) => {
              const cx = xOf(i);
              return (
                <g key={i}>
                  {series.map((s, j) => {
                    const b = s.bars[i];
                    const pct = b?.pct ?? 0;
                    const x0 = cx - clusterW / 2 + j * (clusterW / series.length) + (clusterW / series.length - barW) / 2;
                    const y = yOf(pct);
                    const h = Math.max(1, baseline - y);
                    return (
                      <g key={j}>
                        <rect x={x0} y={y} width={barW} height={h} rx="3" fill={colorOf(j)} />
                        <text
                          x={x0 + barW / 2}
                          y={y - 5}
                          textAnchor="middle"
                          fontSize={labelSize}
                          fontWeight="700"
                          fill="#0f172a"
                          fontFamily="system-ui, -apple-system, sans-serif"
                        >
                          {round1(pct)}%
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
          {variant === "histogram" &&
            // Touching columns, one per bin or answer value: the gap a bar chart puts between separate
            // categories would misread as a break in a continuous range.
            categories.map((_, i) => {
              const pct = series[0]?.bars[i]?.pct ?? 0;
              const x0 = PAD_L + i * colW;
              const y = yOf(pct);
              return (
                <g key={i}>
                  <rect x={x0 + 0.5} y={y} width={colW - 1} height={Math.max(1, baseline - y)} fill={colorOf(0)} stroke="#ffffff" strokeWidth="1" />
                  <text x={x0 + colW / 2} y={y - 5} textAnchor="middle" fontSize="11" fontWeight="700" fill="#0f172a" fontFamily="system-ui, -apple-system, sans-serif">
                    {round1(pct)}%
                  </text>
                </g>
              );
            })}
          {variant === "line" &&
            series.map((s, j) => {
              const pts = categories.map((_, i) => [xOf(i), yOf(s.bars[i]?.pct ?? 0)] as const);
              return (
                <g key={j}>
                  <polyline points={pts.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke={colorOf(j)} strokeWidth="2.5" strokeLinejoin="round" />
                  {pts.map(([x, y], i) => (
                    <g key={i}>
                      <circle cx={x} cy={y} r="4" fill="#ffffff" stroke={colorOf(j)} strokeWidth="2" />
                      {/* Values are captioned on a single line only; with several lines they would overprint. */}
                      {series.length === 1 && (
                        <text x={x} y={y - 9} textAnchor="middle" fontSize="11" fontWeight="700" fill="#0f172a" fontFamily="system-ui, -apple-system, sans-serif">
                          {round1(s.bars[i]?.pct ?? 0)}%
                        </text>
                      )}
                    </g>
                  ))}
                </g>
              );
            })}
          {grouped && legendPos === "bottom" && legendRow(baseline + PAD_BOTTOM + 10)}
        </svg>
      </div>
      <ChartExportButtons exp={exp} />
    </div>
  );
}
