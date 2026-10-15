"use client";

import { useRef, useState } from "react";
import type { NpsResult, NpsSegment } from "@/lib/npsActions";
import { ChartCustomizePanel } from "./ChartCustomize";

/**
 * A slide-ready picture of one NPS result: a donut split by promoters/passives/detractors with the score
 * in the middle, a percentage legend, and the full 0-10 breakdown underneath. Drawn as one inline SVG so
 * "Copy image" and "Download PNG" can rasterise it client-side onto a canvas, no server round trip and no
 * extra library.
 */
const COLORS = { promoters: "#16a34a", passives: "#f59e0b", detractors: "#dc2626", other: "#cbd5e1" };
const round1 = (x: number) => Math.round(x * 10) / 10;

function point(cx: number, cy: number, r: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

/** An SVG path for one ring segment, clockwise from startDeg to endDeg (0deg = 12 o'clock). */
function donutSlice(cx: number, cy: number, rOuter: number, rInner: number, startDeg: number, endDeg: number): string {
  if (endDeg - startDeg <= 0.05) return "";
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const po1 = point(cx, cy, rOuter, startDeg);
  const po2 = point(cx, cy, rOuter, endDeg);
  const pi2 = point(cx, cy, rInner, endDeg);
  const pi1 = point(cx, cy, rInner, startDeg);
  return [
    `M ${po1.x} ${po1.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${po2.x} ${po2.y}`,
    `L ${pi2.x} ${pi2.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${pi1.x} ${pi1.y}`,
    "Z",
  ].join(" ");
}

const W = 760;

export default function NpsVisual({ result, trendStyle = false }: { result: NpsResult; trendStyle?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<"copy" | "download" | null>(null);
  const [title, setTitle] = useState("Net Promoter Score");
  const [colors, setColors] = useState(COLORS);

  /** Which bucket a 0-10 point falls in, for the breakdown row's colour. Reads the customisable palette, not the module default. */
  const bucketColor = (value: number): string => {
    if (value >= 9) return colors.promoters;
    if (value >= 7) return colors.passives;
    return colors.detractors;
  };

  const segments2 = result.segments ?? [];
  const hasSegments = segments2.length > 0;

  // Promoters, passives and detractors should cover every valid answer; a sliver left over (rounding, or a
  // handful of answers the crosstab couldn't place) is drawn as a neutral "other" wedge rather than silently
  // dropped, so the ring always reads as the true 100%.
  const other = Math.max(0, round1(100 - result.promoters - result.passives - result.detractors));
  const segments = [
    { key: "promoters", label: "Promoters (9-10)", pct: result.promoters, color: colors.promoters },
    { key: "passives", label: "Passives (7-8)", pct: result.passives, color: colors.passives },
    { key: "detractors", label: "Detractors (0-6)", pct: result.detractors, color: colors.detractors },
    ...(other > 0.05 ? [{ key: "other", label: "No answer", pct: other, color: colors.other }] : []),
  ];
  let angle = 0;
  const arcs = segments.map((s) => {
    const start = angle;
    const end = angle + (s.pct / 100) * 360;
    angle = end;
    return { ...s, d: donutSlice(170, 170, 134, 90, start, end) };
  });

  // The 0-10 breakdown row: one point per scale value actually present in this file, evenly spaced.
  const scale = result.scale;
  // The legend (promoters/passives/detractors, plus a "no answer" row when the three don't quite add to
  // 100%) sets how far down the confidence-interval box, and everything stacked under it, has to start.
  // With the usual 3 rows this reproduces the old fixed layout exactly; a 4th row pushes it down instead
  // of the box overlapping that row, which is what happened before this was computed.
  const legendRows = segments.length;
  const ciBoxY = 90 + legendRows * 46 + 24;
  const ciBoxBottom = ciBoxY + 66;
  const BREAKDOWN_Y = scale.length > 0 ? Math.max(350, ciBoxBottom + 20) : 0;
  const SEG_ROW_H = 42;
  const SEG_TOP = scale.length > 0 ? BREAKDOWN_Y + 140 : Math.max(330, ciBoxBottom + 12);
  const segBlockH = hasSegments ? (trendStyle ? 300 : 36 + segments2.length * SEG_ROW_H + 16) : 0;
  const baseH = scale.length > 0 ? BREAKDOWN_Y + 210 : SEG_TOP + 40;
  const H = hasSegments ? SEG_TOP + segBlockH + 40 : baseH;
  const padX = 56;
  const rowW = W - padX * 2;
  const stepX = scale.length > 1 ? rowW / (scale.length - 1) : 0;
  const xOf = (i: number) => padX + i * stepX;
  const groups: { label: string; color: string; from: number; to: number }[] = [];
  for (const s of scale) {
    const color = bucketColor(s.value);
    const last = groups[groups.length - 1];
    if (last && last.color === color) last.to = s.value;
    else groups.push({ label: "", color, from: s.value, to: s.value });
  }
  for (const g of groups) {
    g.label = g.color === colors.promoters ? "PROMOTERS" : g.color === colors.passives ? "PASSIVES" : "DETRACTORS";
  }

  async function toPngBlob(scaleFactor = 2): Promise<Blob | null> {
    const svg = svgRef.current;
    if (!svg) return null;
    const xml = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("The image could not be rendered."));
        im.src = url;
      });
      const w = svg.viewBox.baseVal.width || W;
      const h = svg.viewBox.baseVal.height || H;
      const canvas = document.createElement("canvas");
      canvas.width = w * scaleFactor;
      canvas.height = h * scaleFactor;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function download() {
    setBusy("download");
    setStatus(null);
    const blob = await toPngBlob(2);
    setBusy(null);
    if (!blob) {
      setStatus("Could not render the image.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nps-${result.variable}.png`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Downloaded.");
  }

  async function copy() {
    setBusy("copy");
    setStatus(null);
    const blob = await toPngBlob(2);
    setBusy(null);
    if (!blob) {
      setStatus("Could not render the image.");
      return;
    }
    try {
      const Ctor = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (navigator.clipboard && "write" in navigator.clipboard && Ctor) {
        await navigator.clipboard.write([new Ctor({ "image/png": blob })]);
        setStatus("Copied. Paste it into your slide.");
      } else {
        await download();
        setStatus("This browser can't copy images, so it downloaded instead.");
      }
    } catch {
      await download();
      setStatus("Copying didn't work, so it downloaded instead.");
    }
  }

  return (
    <div className="max-w-3xl space-y-3">
      <ChartCustomizePanel
        title={title}
        onTitle={setTitle}
        colors={[
          { label: "Promoters", value: colors.promoters },
          { label: "Passives", value: colors.passives },
          { label: "Detractors", value: colors.detractors },
          { label: "No answer", value: colors.other },
        ]}
        onColor={(i, v) => {
          const keys: (keyof typeof colors)[] = ["promoters", "passives", "detractors", "other"];
          setColors((prev) => ({ ...prev, [keys[i]]: v }));
        }}
        onResetColors={() => setColors(COLORS)}
      />
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" className="rounded-xl border border-border bg-white">
        <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
        <text x={W / 2} y="38" textAnchor="middle" fontSize="20" fontWeight="700" fill="#0f172a" fontFamily="system-ui, -apple-system, sans-serif">
          {title}
        </text>
        <text x={W / 2} y="58" textAnchor="middle" fontSize="12" fill="#64748b" fontFamily="system-ui, -apple-system, sans-serif">
          {result.label}
        </text>

        <g transform="translate(40, 24)">
          {arcs.map((s) => (
            <path key={s.key} d={s.d} fill={s.color} />
          ))}
          <text x="170" y="178" textAnchor="middle" fontSize="42" fontWeight="800" fill="#0f172a" fontFamily="system-ui, -apple-system, sans-serif">
            {result.nps}
          </text>
          <text x="170" y="200" textAnchor="middle" fontSize="12" fill="#64748b" fontFamily="system-ui, -apple-system, sans-serif">
            NPS
          </text>
        </g>
        {segments.map((s, i) => (
          <g key={s.key} transform={`translate(420, ${90 + i * 46})`}>
            <rect width="14" height="14" rx="3" fill={s.color} />
            <text x="22" y="12" fontSize="16" fontWeight="700" fill="#0f172a" fontFamily="system-ui, -apple-system, sans-serif">
              {round1(s.pct)}%
            </text>
            <text x="22" y="29" fontSize="11" fill="#64748b" fontFamily="system-ui, -apple-system, sans-serif">
              {s.label}
            </text>
          </g>
        ))}

        <g transform={`translate(420, ${ciBoxY})`}>
          <rect x="0" y="0" width="300" height="66" rx="10" fill="#f8fafc" stroke="#e2e8f0" />
          <text x="16" y="22" fontSize="11" fontWeight="700" fill="#94a3b8" fontFamily="system-ui, -apple-system, sans-serif">
            95% CONFIDENCE INTERVAL
          </text>
          <text x="16" y="46" fontSize="19" fontWeight="800" fill="#0f172a" fontFamily="system-ui, -apple-system, sans-serif">
            {result.lo} to {result.hi}
          </text>
          <text x="16" y="60" fontSize="10.5" fill="#64748b" fontFamily="system-ui, -apple-system, sans-serif">
            {result.n.toLocaleString()} effective base
            {result.rawN !== result.n ? ` (${result.rawN.toLocaleString()} respondents)` : ""}{result.weighted ? ", weighted" : ""}
            {/* ANA-NPS-003: this headline card is what a researcher actually screenshots or
                downloads, so the interval's own uncertainty qualification belongs here too, not
                only in the committed finding's stats. "cluster design" names which variance
                calculation ran (exact contrast SE vs the coarser average-design-effect
                approximation) - it is never phrased as the interval itself being exact, since
                both still use the same 1.96 normal-approximation multiplier. */}
            {result.designBased ? (result.designExact ? ", cluster design" : ", cluster design (approx.)") : ""}
            {/* ANA-NPS-003: casesMissingDesign/designAmbiguous are qualifications Codex's
                counter-review found computed server-side and then dropped before reaching this
                headline card or the committed finding - folded into this same line, as a short
                suffix, rather than new text elements: this card's layout is fixed-coordinate SVG
                with no renderer available here to confirm a taller box wouldn't overlap the
                scale-breakdown section fixed below it. */}
            {result.casesMissingDesign ? ` (${result.casesMissingDesign.toLocaleString()} missing design info)` : ""}
            {result.designAmbiguous ? " (design candidates ambiguous)" : ""}
          </text>
        </g>

        {scale.length > 0 && (
          <g transform={`translate(0, ${BREAKDOWN_Y})`}>
            <text x={padX} y="0" fontSize="11" fontWeight="600" fill="#94a3b8" fontFamily="system-ui, -apple-system, sans-serif">
              SHARE CHOOSING EACH POINT ON THE SCALE
            </text>
            {/* the connecting line, behind the dots */}
            <line x1={xOf(0)} y1="48" x2={xOf(scale.length - 1)} y2="48" stroke="#e2e8f0" strokeWidth="2" />
            {scale.map((s, i) => (
              <g key={s.value} transform={`translate(${xOf(i)}, 20)`}>
                <circle cx="0" cy="28" r="18" fill={bucketColor(s.value)} />
                <text x="0" y="33" textAnchor="middle" fontSize="15" fontWeight="700" fill="#ffffff" fontFamily="system-ui, -apple-system, sans-serif">
                  {s.value}
                </text>
                <rect x="-17" y="52" width="34" height="18" rx="9" fill="#334155" />
                <text x="0" y="65" textAnchor="middle" fontSize="10.5" fontWeight="600" fill="#ffffff" fontFamily="system-ui, -apple-system, sans-serif">
                  {Math.round(s.pct)}%
                </text>
              </g>
            ))}
            {groups.map((g, i) => (
              <text
                key={i}
                x={(xOf(scale.findIndex((s) => s.value === g.from)) + xOf(scale.findIndex((s) => s.value === g.to))) / 2}
                y="110"
                textAnchor="middle"
                fontSize="12"
                fontWeight="700"
                fill={g.color}
                fontFamily="system-ui, -apple-system, sans-serif"
              >
                {g.label}
              </text>
            ))}
          </g>
        )}

        {hasSegments && trendStyle && (
          <g transform={`translate(0, ${SEG_TOP})`}>
            <text x={padX} y="0" fontSize="11" fontWeight="600" fill="#94a3b8" fontFamily="system-ui, -apple-system, sans-serif">
              {(result.groupLabel ?? "").toUpperCase()} HISTORY
            </text>
            {(() => {
              const trackTop = 28;
              const trackH = 190;
              const trackBottom = trackTop + trackH;
              const n = segments2.length;
              const trackLeft = padX + 10;
              const trackRight = W - padX - 10;
              const trackW = trackRight - trackLeft;
              const slot = n > 0 ? trackW / n : trackW;
              const barW = Math.min(64, slot * 0.46);
              const xCenter = (i: number) => trackLeft + slot * (i + 0.5);
              // Score line: -100 to 100 mapped onto the same track, 0 at the vertical middle.
              const scoreY = (score: number) => trackTop + trackH / 2 - (score / 100) * (trackH / 2);
              const stackY = (pct: number) => trackBottom - (pct / 100) * trackH;
              const linePath = segments2
                .map((seg, i) => `${i === 0 ? "M" : "L"} ${xCenter(i)} ${scoreY(seg.nps)}`)
                .join(" ");
              return (
                <>
                  <line x1={trackLeft} y1={trackTop + trackH / 2} x2={trackRight} y2={trackTop + trackH / 2} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3" />
                  <text x={trackLeft - 6} y={trackTop + trackH / 2 + 4} textAnchor="end" fontSize="9.5" fill="#cbd5e1" fontFamily="system-ui, -apple-system, sans-serif">
                    0
                  </text>
                  {segments2.map((seg, i) => {
                    const x0 = xCenter(i) - barW / 2;
                    const other = Math.max(0, round1(100 - seg.promoters - seg.passives - seg.detractors));
                    let cursor = 0;
                    const stack = [
                      { pct: seg.detractors, color: colors.detractors },
                      { pct: seg.passives, color: colors.passives },
                      { pct: seg.promoters, color: colors.promoters },
                      ...(other > 0.05 ? [{ pct: other, color: colors.other }] : []),
                    ];
                    const rects = stack.map((s, j) => {
                      const y0 = stackY(cursor + s.pct);
                      const y1 = stackY(cursor);
                      cursor += s.pct;
                      return <rect key={j} x={x0} y={y0} width={barW} height={Math.max(0, y1 - y0)} fill={s.color} />;
                    });
                    return (
                      <g key={seg.name}>
                        {rects}
                        <text x={xCenter(i)} y={trackBottom + 18} textAnchor="middle" fontSize="11" fontWeight="600" fill="#334155" fontFamily="system-ui, -apple-system, sans-serif">
                          {seg.name}
                        </text>
                        <text x={xCenter(i)} y={trackBottom + 31} textAnchor="middle" fontSize="9.5" fill="#94a3b8" fontFamily="system-ui, -apple-system, sans-serif">
                          n={seg.n.toLocaleString()}
                        </text>
                      </g>
                    );
                  })}
                  <path d={linePath} fill="none" stroke="#0f172a" strokeWidth="2.5" />
                  {segments2.map((seg, i) => (
                    <g key={`dot-${seg.name}`}>
                      <circle cx={xCenter(i)} cy={scoreY(seg.nps)} r="4.5" fill="#ffffff" stroke="#0f172a" strokeWidth="2.5" />
                      <rect x={xCenter(i) - 20} y={scoreY(seg.nps) - (seg.nps >= 0 ? 28 : -14)} width="40" height="17" rx="8" fill="#0f172a" />
                      <text
                        x={xCenter(i)}
                        y={scoreY(seg.nps) - (seg.nps >= 0 ? 28 : -14) + 12}
                        textAnchor="middle"
                        fontSize="11"
                        fontWeight="700"
                        fill="#ffffff"
                        fontFamily="system-ui, -apple-system, sans-serif"
                      >
                        {seg.nps}
                      </text>
                    </g>
                  ))}
                  <g transform={`translate(${trackLeft}, ${trackBottom + 52})`}>
                    {[
                      { label: "Score", color: "#0f172a" },
                      { label: "Promoters", color: colors.promoters },
                      { label: "Passives", color: colors.passives },
                      { label: "Detractors", color: colors.detractors },
                    ].map((l, i) => (
                      <g key={l.label} transform={`translate(${i * 130}, 0)`}>
                        <rect width="12" height="12" rx="3" fill={l.color} />
                        <text x="18" y="10.5" fontSize="10.5" fill="#64748b" fontFamily="system-ui, -apple-system, sans-serif">
                          {l.label}
                        </text>
                      </g>
                    ))}
                  </g>
                </>
              );
            })()}
          </g>
        )}
        {hasSegments && !trendStyle && (
          <g transform={`translate(0, ${SEG_TOP})`}>
            <text x={56} y="0" fontSize="11" fontWeight="600" fill="#94a3b8" fontFamily="system-ui, -apple-system, sans-serif">
              NPS BY {(result.groupLabel ?? "").toUpperCase()}
            </text>
            {(() => {
              const segPadX = 170;
              const segTrackW = W - segPadX - 70;
              const segCx = segPadX + segTrackW / 2;
              // Headroom so the biggest bar never reaches the full track width: at full scale its value
              // label (drawn just past the bar's tip) would land right on top of the group name and base
              // size printed in the margin beside it, which is the overlap this works around.
              const maxAbs = Math.max(...segments2.map((x) => Math.abs(x.nps)), 10) * 1.25;
              const segX = (v: number) => segCx + (v / maxAbs) * (segTrackW / 2);
              return segments2.map((seg, i) => {
                const y = 24 + i * SEG_ROW_H;
                const barX0 = Math.min(segX(0), segX(seg.nps));
                const barW = Math.max(2, Math.abs(segX(seg.nps) - segX(0)));
                const color = seg.nps >= 0 ? colors.promoters : colors.detractors;
                return (
                  <g key={seg.name}>
                    <text x={segPadX - 10} y={y + 16} textAnchor="end" fontSize="11.5" fontWeight="600" fill="#334155" fontFamily="system-ui, -apple-system, sans-serif">
                      {seg.name}
                    </text>
                    <text x={segPadX - 10} y={y + 29} textAnchor="end" fontSize="9.5" fill="#94a3b8" fontFamily="system-ui, -apple-system, sans-serif">
                      n={seg.n.toLocaleString()}
                    </text>
                    <line x1={segCx} y1={y} x2={segCx} y2={y + 26} stroke="#e2e8f0" strokeWidth="1" />
                    <rect x={barX0} y={y + 4} width={barW} height="18" rx="3" fill={color} />
                    <text
                      x={seg.nps >= 0 ? segX(seg.nps) + 8 : segX(seg.nps) - 8}
                      y={y + 17}
                      textAnchor={seg.nps >= 0 ? "start" : "end"}
                      fontSize="13"
                      fontWeight="700"
                      fill="#0f172a"
                      fontFamily="system-ui, -apple-system, sans-serif"
                    >
                      {seg.nps}
                    </text>
                  </g>
                );
              });
            })()}
          </g>
        )}

        <text x={W / 2} y={H - 16} textAnchor="middle" fontSize="10" fill="#cbd5e1" fontFamily="system-ui, -apple-system, sans-serif">
          {hasSegments
            ? "Each bar is that group's own NPS, same promoters/detractors math as the overall score above."
            : "The interval shows how much the score could move on a repeat sample."}
        </text>
      </svg>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copy}
          disabled={busy !== null}
          className="rounded-lg border border-primary px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
        >
          {busy === "copy" ? "Copying..." : "Copy image"}
        </button>
        <button
          type="button"
          onClick={download}
          disabled={busy !== null}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "download" ? "Downloading..." : "Download PNG"}
        </button>
        {status && <span className="text-[11px] text-muted">{status}</span>}
      </div>
    </div>
  );
}


/**
 * One wave's NPS as a small donut + percentage legend, no 0-10 breakdown and no trend chart, so several
 * can sit side by side. Uses the same colours and the same SVG donut math as the full NpsVisual above,
 * just at card scale.
 */
function NpsWaveCard({ seg, highlight }: { seg: NpsSegment; highlight: boolean }) {
  const other = Math.max(0, round1(100 - seg.promoters - seg.passives - seg.detractors));
  const segs = [
    { key: "promoters", label: "Promoters", pct: seg.promoters, color: COLORS.promoters },
    { key: "passives", label: "Passives", pct: seg.passives, color: COLORS.passives },
    { key: "detractors", label: "Detractors", pct: seg.detractors, color: COLORS.detractors },
    ...(other > 0.05 ? [{ key: "other", label: "No answer", pct: other, color: COLORS.other }] : []),
  ];
  let angle = 0;
  const arcs = segs.map((s) => {
    const start = angle;
    const end = angle + (s.pct / 100) * 360;
    angle = end;
    return { ...s, d: donutSlice(56, 56, 50, 34, start, end) };
  });
  return (
    <div
      className={`space-y-3 rounded-xl border bg-white p-3 shadow-sm ${
        highlight ? "border-primary ring-1 ring-primary" : "border-border"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-xs font-semibold text-foreground" title={seg.name}>
          {seg.name}
        </p>
        <p className="shrink-0 text-[10px] text-muted">n = {seg.n.toLocaleString()}</p>
      </div>
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 112 112" width="88" height="88" className="shrink-0">
          {arcs.map((s) => (
            <path key={s.key} d={s.d} fill={s.color} />
          ))}
          <text x="56" y="60" textAnchor="middle" fontSize="22" fontWeight="800" fill="#0f172a" fontFamily="system-ui, -apple-system, sans-serif">
            {seg.nps}
          </text>
          <text x="56" y="74" textAnchor="middle" fontSize="9" fill="#64748b" fontFamily="system-ui, -apple-system, sans-serif">
            NPS
          </text>
        </svg>
        <div className="space-y-1.5 text-[11px]">
          {segs.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="font-semibold text-foreground">{round1(s.pct)}%</span>
              <span className="text-muted">{s.label}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted">
            95% CI: {seg.lo} to {seg.hi}
            {seg.designBased ? (seg.designExact ? ", cluster design" : ", cluster design (approx.)") : ""}
          </p>
          {/* Overnight queue, package 4: this wave's own design caveats, previously computed
              and then discarded before they ever reached this card - mirrors the single-file
              caveat line above (NpsVisual's top-level result.casesMissingDesign/designAmbiguous
              rendering), but per wave, since each wave is its own file and can genuinely differ. */}
          {(seg.casesMissingDesign || seg.designAmbiguous) && (
            <p className="text-[10px] text-muted">
              {seg.casesMissingDesign ? `${seg.casesMissingDesign.toLocaleString()} missing design info` : ""}
              {seg.casesMissingDesign && seg.designAmbiguous ? "; " : ""}
              {seg.designAmbiguous ? "design candidates ambiguous" : ""}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The per-wave NPS comparison: one compact donut+legend card per wave, side by side, rather than the
 * single stacked-bar/line history chart. This is the common case (wave tracking, not a demographic
 * segment split), so it reads off the same result.segments the trend chart used, just drawn differently.
 */
export function NpsWaveCards({ result }: { result: NpsResult }) {
  const segments = result.segments ?? [];
  if (segments.length === 0) return null;
  const cols = segments.length >= 3 ? "sm:grid-cols-3" : segments.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-1";
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-muted">{result.label}, by wave</p>
        <p className="text-[10px] text-muted">
          Overall: {result.nps} NPS, {result.n.toLocaleString()} effective base
          {result.rawN !== result.n ? ` (${result.rawN.toLocaleString()} respondents)` : ""}{result.weighted ? ", weighted" : ""}
        </p>
      </div>
      <div className={`grid grid-cols-1 gap-3 ${cols}`}>
        {segments.map((seg, i) => (
          <NpsWaveCard key={seg.name} seg={seg} highlight={i === segments.length - 1} />
        ))}
      </div>
    </div>
  );
}
