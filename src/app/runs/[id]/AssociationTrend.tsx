"use client";

// R5 waves: the client's brand's association with each attribute across the included waves up to this one, as small
// multiples (one compact line per attribute). Figures and every reason a point is missing come from src/lib
// (trackerPageChanges.ts loadBrandAssociationsWithChange); a missing point is a gap, never 0.
import type { AssociationTrend as Trend } from "@/lib/trackerPageChanges";
import { waveDateText } from "./WaveSelector";

function Spark({ values, labels, testId }: { values: (number | null)[]; labels: string[]; testId: string }) {
  const W = 132;
  const H = 40;
  const known = values.filter((v): v is number => v !== null);
  const max = Math.max(10, ...known);
  const x = (i: number) => (values.length <= 1 ? W / 2 : 6 + (i * (W - 12)) / (values.length - 1));
  const y = (v: number) => 4 + (1 - v / max) * (H - 8);
  // Segments only between neighbouring known points: a gap stays a gap.
  const segments = values.slice(1).flatMap((v, i) => (v !== null && values[i] !== null ? [`M${x(i)},${y(values[i] as number)}L${x(i + 1)},${y(v)}`] : []));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={values.map((v, i) => `${labels[i]}: ${v === null ? "no figure" : `${v.toFixed(1)}%`}`).join("; ")} data-testid={testId}>
      <path d={segments.join("")} stroke="#2563eb" strokeWidth={1.5} fill="none" />
      {values.map((v, i) => (v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill="#2563eb" />))}
    </svg>
  );
}

export function AssociationTrend({ trend }: { trend: NonNullable<Trend> }) {
  const labels = trend.waves.map((w) => `${w.wave} (${waveDateText(w.waveDate)})`);
  const failed = trend.waves.filter((w) => w.status === "failed");
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5" data-testid="tracker-association-trend" aria-label={`${trend.brand.label} associations across waves`}>
      <h3 className="text-base font-semibold text-slate-900">{trend.brand.label} associations across waves</h3>
      <p className="mt-0.5 text-[11px] text-slate-500">
        Share of those aware of {trend.brand.label}, per wave: {trend.waves.map((w) => w.wave).join(", ")}. Independent samples; a gap is a wave where the attribute is not the same question or not asked.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        {trend.attributes.map((a) => {
          const points = trend.waves.map((w) => w.cells[a.variable] ?? null);
          const values = points.map((p) => p?.share ?? null);
          const last = values[values.length - 1];
          const gaps = points.map((p, i) => (p && p.share === null && p.reason ? `${trend.waves[i].wave}: ${p.reason}` : null)).filter(Boolean);
          return (
            <div key={a.variable} className="min-w-0" title={gaps.join(" ") || undefined} data-testid="tracker-association-trend-item">
              <p className="truncate text-xs text-slate-700">{a.item}</p>
              <div className="flex items-end gap-2">
                <Spark values={values} labels={labels} testId="tracker-association-spark" />
                <span className="text-xs font-semibold tabular-nums text-slate-900">{last === null ? "n/a" : `${last.toFixed(1)}%`}</span>
              </div>
            </div>
          );
        })}
      </div>
      {failed.length > 0 && <p className="mt-2 text-[11px] text-amber-800">{failed.map((w) => `${w.wave} could not be read: ${w.error}`).join(" ")}</p>}
    </section>
  );
}
