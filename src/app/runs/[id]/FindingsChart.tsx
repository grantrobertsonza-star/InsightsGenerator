"use client";

// Renders a ChartSpec (see findingsChartData.ts) built from a theme group of
// banner_comparison findings. Observable Plot draws straight into a plain
// DOM node rather than through React's own render tree, so this is a thin
// ref + useEffect wrapper -- same pattern any non-React charting library
// needs inside a React tree.
//
// The actual chart recipe (marks, scales, colors) lives in
// plotChartOptions.ts, shared with the server-side renderer used by the
// Insights Report export -- so an exported chart image and this on-screen
// chart can never quietly drift apart.

import { useEffect, useRef } from "react";
import * as Plot from "@observablehq/plot";
import type { ChartSpec } from "@/lib/findingsChartData";
import { buildPlotOptions } from "@/lib/plotChartOptions";

export default function FindingsChart({ spec }: { spec: ChartSpec }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = Math.min(container.clientWidth || 640, 760);
    const plot = Plot.plot(
      buildPlotOptions(Plot, spec, width),
    ) as unknown as HTMLElement & {
      remove?: () => void;
    };

    container.innerHTML = "";
    container.appendChild(plot);
    return () => {
      plot.remove?.();
    };
  }, [spec]);

  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <div ref={containerRef} className="w-full overflow-x-auto" />
      <p className="mt-2 text-xs leading-relaxed text-muted">{spec.caption}</p>
    </div>
  );
}
