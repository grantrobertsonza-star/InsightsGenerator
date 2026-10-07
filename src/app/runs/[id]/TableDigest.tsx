"use client";

// Renders buildTableDigest's column-by-column summary (tableDigestCharts.ts)
// as a small grid of charts -- the "see the shape of this table" step that
// sits before a banner plan exists. One mini chart per column: a bar chart
// of category counts, or a histogram for a numeric column. No comparison,
// no significance test, no banner/stub columns required.

import { useEffect, useRef } from "react";
import * as Plot from "@observablehq/plot";
import {
  buildTableDigest,
  type ColumnDigest,
  type Row,
} from "@/lib/tableDigestCharts";

const NEUTRAL = "#64748b";
const NUMERIC = "#2563eb";

function MiniChart({ digest }: { digest: ColumnDigest }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || digest.kind === "skipped") return;
    const width = Math.max(container.clientWidth || 220, 180);

    const plot =
      digest.kind === "categorical"
        ? Plot.plot({
            width,
            height: 140,
            marginLeft: 8,
            marginBottom: 28,
            x: { axis: null },
            y: { axis: null },
            marks: [
              Plot.barY(digest.bars, {
                x: "category",
                y: "count",
                fill: (d: { category: string }) =>
                  d.category === "Other" ? "#cbd5e1" : NEUTRAL,
                rx: 2,
                tip: true,
                title: (d: {
                  category: string;
                  count: number;
                  percent: number;
                }) => `${d.category}\n${d.count} (${d.percent}%)`,
              }),
              Plot.text(digest.bars, {
                x: "category",
                text: (d: { category: string }) =>
                  d.category.length > 10
                    ? d.category.slice(0, 9) + "…"
                    : d.category,
                y: 0,
                dy: 14,
                fontSize: 9,
                fill: "#475569",
              }),
            ],
          })
        : Plot.plot({
            width,
            height: 140,
            marginLeft: 8,
            marginBottom: 20,
            y: { axis: null },
            x: { ticks: 3, tickSize: 0 },
            marks: [
              Plot.rectY(digest.bins, {
                x1: "from",
                x2: "to",
                y: "count",
                fill: NUMERIC,
                inset: 1,
                tip: true,
                title: (d: { from: number; to: number; count: number }) =>
                  `${d.from}–${d.to}\n${d.count}`,
              }),
            ],
          });

    container.innerHTML = "";
    container.appendChild(plot);
    return () => {
      (plot as unknown as { remove?: () => void }).remove?.();
    };
  }, [digest]);

  if (digest.kind === "skipped") {
    return (
      <div className="flex h-full min-h-[120px] flex-col justify-center rounded-lg border border-dashed border-border bg-slate-50 px-3 py-2">
        <p
          className="truncate text-[11px] font-medium text-foreground"
          title={digest.column}
        >
          {digest.column}
        </p>
        <p className="mt-1 text-[10px] text-muted">
          {digest.reason === "too_many_distinct_values"
            ? "Too many distinct values to chart (likely free text or an ID)."
            : "Not enough data in this column to chart."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-white px-2 pt-2">
      <p
        className="truncate px-1 text-[11px] font-medium text-foreground"
        title={digest.column}
      >
        {digest.column}
      </p>
      <div ref={containerRef} className="w-full" />
      <p className="px-1 pb-1.5 text-[10px] text-muted">
        {digest.kind === "categorical"
          ? `${digest.distinctCount} categories, n=${digest.n}`
          : `mean ${digest.mean}, median ${digest.median} (n=${digest.n}, range ${digest.min}–${digest.max})`}
      </p>
    </div>
  );
}

export default function TableDigest({
  headers,
  rows,
}: {
  headers: string[];
  rows: Row[];
}) {
  const digests = buildTableDigest(headers, rows);
  if (digests.length === 0) return null;

  return (
    <div className="mt-2">
      <p className="mb-1.5 text-[11px] font-medium text-muted">
        Column shapes, before any comparison is set up
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
        {digests.map((digest) => (
          <MiniChart key={digest.column} digest={digest} />
        ))}
      </div>
    </div>
  );
}
