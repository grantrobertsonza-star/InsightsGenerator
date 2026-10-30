"use client";

import { useRef } from "react";
import type { ScatterResult } from "@/lib/scatterActions";
import { jitterOffset } from "@/lib/scatter";
import { ChartExportButtons, useSvgImageExport } from "./chartImageExport";

const W = 760;
const H = 480;
const PAD_L = 64;
const PAD_R = 24;
const PAD_TOP = 60;
const PAD_BOTTOM = 64;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_TOP - PAD_BOTTOM;
const FONT = "system-ui, -apple-system, sans-serif";

/** Up to six tick values across [min, max]: every code on a short scale, else round steps. */
function ticks(min: number, max: number, distinct: number): number[] {
  if (max <= min) return [min];
  if (distinct <= 12 && Number.isInteger(min) && Number.isInteger(max) && max - min <= 12) {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }
  const raw = (max - min) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/**
 * A scatter plot of two numeric variables, one point per complete case (or an even sample of them
 * when there are more than the drawing cap), as an inline SVG with the same Copy image and Download
 * PNG as the other charts. Axis ticks carry a code's value label where the file has one. "Spread
 * overlapping points" (`spread`) moves each point by a small fixed amount inside its own code's slot so
 * stacked points on a short scale become visible; it changes the drawing only, never the values or
 * the correlation.
 */
export default function ScatterVisual({ result, title, color, spread }: { result: ScatterResult; title: string; color: string; spread: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const exp = useSvgImageExport(svgRef, `scatter-${result.x.name}-${result.y.name}.png`, W, H);
  const pad = (a: { min: number; max: number }) => {
    const span = a.max - a.min || 1;
    return { lo: a.min - span * 0.04, hi: a.max + span * 0.04 };
  };
  const xr = pad(result.x);
  const yr = pad(result.y);
  const xOf = (v: number) => PAD_L + ((v - xr.lo) / (xr.hi - xr.lo)) * PLOT_W;
  const yOf = (v: number) => PAD_TOP + PLOT_H - ((v - yr.lo) / (yr.hi - yr.lo)) * PLOT_H;
  const xTicks = ticks(result.x.min, result.x.max, result.x.distinct);
  const yTicks = ticks(result.y.min, result.y.max, result.y.distinct);
  // One code's slot on a short scale, so a spread point never wanders onto a neighbouring code.
  const slot = (a: { min: number; max: number; distinct: number }, px: number) => (a.distinct <= 12 && a.max > a.min ? (px / (a.max - a.min)) * 0.5 : 0);
  const jx = spread ? slot(result.x, PLOT_W) : 0;
  const jy = spread ? slot(result.y, PLOT_H) : 0;
  const tickLabel = (a: ScatterResult["x"], v: number) => {
    const lab = a.valueLabels?.[String(v)];
    const t = lab ? `${v} ${lab}` : `${v}`;
    return t.length > 16 ? `${t.slice(0, 15)}…` : t;
  };
  const opacity = result.points.length > 1500 ? 0.35 : result.points.length > 300 ? 0.55 : 0.75;
  return (
    <div className="max-w-3xl space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Scatter plot of ${result.y.label} against ${result.x.label}`}>
          <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
          <text x={W / 2} y="26" textAnchor="middle" fontSize="18" fontWeight="700" fill="#0f172a" fontFamily={FONT}>
            {title}
          </text>
          <text x={W / 2} y="44" textAnchor="middle" fontSize="11.5" fill="#64748b" fontFamily={FONT}>
            {`${result.complete.toLocaleString()} complete cases${result.capped ? ` (${result.capped.shown.toLocaleString()} drawn)` : ""}${result.weighted ? ", weighted correlation" : ""}`}
          </text>
          {yTicks.map((v) => (
            <g key={`y${v}`}>
              <line x1={PAD_L} x2={W - PAD_R} y1={yOf(v)} y2={yOf(v)} stroke="#e2e8f0" />
              <text x={PAD_L - 6} y={yOf(v) + 4} textAnchor="end" fontSize="10.5" fill="#475569" fontFamily={FONT}>
                {tickLabel(result.y, v)}
              </text>
            </g>
          ))}
          {xTicks.map((v) => (
            <g key={`x${v}`}>
              <line x1={xOf(v)} x2={xOf(v)} y1={PAD_TOP} y2={PAD_TOP + PLOT_H} stroke="#f1f5f9" />
              <text x={xOf(v)} y={PAD_TOP + PLOT_H + 16} textAnchor="middle" fontSize="10.5" fill="#475569" fontFamily={FONT}>
                {tickLabel(result.x, v)}
              </text>
            </g>
          ))}
          <line x1={PAD_L} x2={W - PAD_R} y1={PAD_TOP + PLOT_H} y2={PAD_TOP + PLOT_H} stroke="#94a3b8" />
          <line x1={PAD_L} x2={PAD_L} y1={PAD_TOP} y2={PAD_TOP + PLOT_H} stroke="#94a3b8" />
          {result.points.map(([x, y], i) => (
            <circle key={i} cx={xOf(x) + jx * jitterOffset(i, 0)} cy={yOf(y) + jy * jitterOffset(i, 1)} r="3" fill={color} fillOpacity={opacity} />
          ))}
          <text x={PAD_L + PLOT_W / 2} y={H - 18} textAnchor="middle" fontSize="12" fontWeight="600" fill="#334155" fontFamily={FONT}>
            {result.x.label.length > 70 ? `${result.x.label.slice(0, 69)}…` : result.x.label}
          </text>
          <text x={16} y={PAD_TOP + PLOT_H / 2} textAnchor="middle" fontSize="12" fontWeight="600" fill="#334155" fontFamily={FONT} transform={`rotate(-90 16 ${PAD_TOP + PLOT_H / 2})`}>
            {result.y.label.length > 50 ? `${result.y.label.slice(0, 49)}…` : result.y.label}
          </text>
        </svg>
      </div>
      <ChartExportButtons exp={exp} />
    </div>
  );
}
