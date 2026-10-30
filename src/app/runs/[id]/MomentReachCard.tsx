"use client";

// Page 02 "Moments & needs": the Moment reach card (Grant, 30 October 2026). How widely each brand is linked to the
// category's moments: moments per person (ranked bars by default), moment penetration, moments per linker and share
// of moment links, any of them chosen to rank by, the others on hover and in the table. Figures come from
// loadMomentReachAction (src/lib/trackerMomentReach.ts, contract in claude/d2-design-2026-10-29.md, D3c); ranking and
// headline from src/lib/momentProfileView.ts. This screen never computes a figure.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { loadMomentReachAction } from "@/lib/trackerDashboardActions";
import type { BrandMoments } from "@/lib/trackerMoments";
import type { MomentReach } from "@/lib/trackerMomentReach";
import { REACH_MEASURES, rankReach, reachHeadline, reachValueText, type ReachMeasure } from "@/lib/momentProfileView";

type Load = { doc: string; source: BrandMoments } & ({ state: "loading" } | { state: "failed"; error: string } | { state: "ready"; reach: MomentReach });

export function MomentReachCard({
  runId,
  documentId,
  moments,
  brands,
  focal,
  frame,
}: {
  runId: string;
  documentId: string;
  /** Page 02's figures: a new load (a weighting or mapping change) reloads this card. */
  moments: BrandMoments;
  brands: { code: string; label: string }[];
  focal: string | null;
  frame: (subtitle: ReactNode, body: ReactNode) => ReactNode;
}) {
  const [load, setLoad] = useState<Load | null>(null);
  const [measure, setMeasure] = useState<ReachMeasure>("perPerson");
  const latest = useRef(0);
  const current = load && load.doc === documentId && load.source === moments ? load : null;
  const start = useCallback(async () => {
    const id = ++latest.current;
    setLoad({ doc: documentId, source: moments, state: "loading" });
    void loadMomentReachAction(runId, documentId).then(
      (r) => {
        if (id !== latest.current) return;
        setLoad(r.ok ? { doc: documentId, source: moments, state: "ready", reach: r.reach } : { doc: documentId, source: moments, state: "failed", error: r.error });
      },
      (e: unknown) => {
        if (id !== latest.current) return;
        setLoad({ doc: documentId, source: moments, state: "failed", error: e instanceof Error ? e.message : String(e) });
      },
    );
  }, [runId, documentId, moments]);
  const needsLoad = current === null;
  useEffect(() => {
    // Calculated when shown, once per file and per load of page 02 (the panel's pattern for its pages).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (needsLoad) void start();
  }, [needsLoad, start]);

  const labelOf = (code: string) => brands.find((b) => b.code === code)?.label ?? code;
  const reach = current?.state === "ready" ? current.reach : null;
  const weighting = reach ? (reach.weighted ? `Weighted by ${reach.weightVar}` : "Unweighted") : "";
  const ok = reach?.reach.status === "ok" ? reach.reach : null;
  const bases = ok ? [...new Set(ok.brands.map((b) => b.base).filter((n): n is number => n !== null))] : [];
  const baseText = bases.length === 0 ? "" : bases.length === 1 ? `n=${bases[0].toLocaleString()}` : `n=${Math.min(...bases).toLocaleString()} to ${Math.max(...bases).toLocaleString()}`;
  const subtitle = `How widely each brand is linked to the ${ok ? `${ok.moments} ` : ""}moments. All eligible respondents answering every moment for the brand${baseText ? `, ${baseText}` : ""}${weighting ? `. ${weighting}` : ""}.`;

  return frame(
    subtitle,
    current === null || current.state === "loading" ? (
      <p className="text-sm text-slate-500" role="status">
        Calculating moment reach from this file...
      </p>
    ) : current.state === "failed" ? (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="moment-reach-failed">
        <p>Moment reach could not be calculated: {current.error}</p>
        <button type="button" onClick={() => void start()} className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs">
          Try again
        </button>
      </div>
    ) : !ok ? (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4" data-testid="moment-reach-unavailable" data-status={current.reach.reach.status}>
        <p className="text-sm font-semibold text-slate-700">{current.reach.reach.status === "not_measured" ? "Not measured" : "Mapping needed"}</p>
        <p className="mt-1 text-xs text-slate-500">{current.reach.reach.status !== "ok" && current.reach.reach.reason}</p>
      </div>
    ) : (
      <ReachBody reach={ok} focal={focal} labelOf={labelOf} measure={measure} setMeasure={setMeasure} />
    ),
  );
}

function ReachBody({
  reach,
  focal,
  labelOf,
  measure,
  setMeasure,
}: {
  reach: Extract<MomentReach["reach"], { status: "ok" }>;
  focal: string | null;
  labelOf: (code: string) => string;
  measure: ReachMeasure;
  setMeasure: (m: ReachMeasure) => void;
}) {
  const ranked = rankReach(reach.brands, measure);
  const top = Math.max(0, ...ranked.map((r) => r.brand[measure] ?? 0));
  const headline = reachHeadline(reach.brands, focal, labelOf);
  const focalRow = reach.brands.find((b) => b.code === focal);
  const others = (code: string) =>
    REACH_MEASURES.filter((m) => m.key !== measure)
      .map((m) => `${m.label} ${reachValueText(m.key, reach.brands.find((b) => b.code === code)![m.key])}`)
      .join("; ");
  const naNotes = reach.brands
    .filter((b) => b[measure] === null)
    .map((b) => `${labelOf(b.code)}: ${(measure === "shareOfLinks" ? b.shareReason : measure === "perLinker" ? (b.perLinkerReason ?? b.reason) : b.reason) ?? "Not available."}`);
  const leftOut = reach.brands.filter((b) => (b.noneValid ?? 0) + (b.partlyValid ?? 0) > 0);
  return (
    <div data-testid="moment-reach">
      <p className="text-[15px] font-semibold text-slate-900" data-testid="moment-reach-headline">
        {headline ?? (focal ? `${labelOf(focal)}: ${focalRow?.reason ?? "moments per person not available."}` : "No client brand is set, so there is no headline.")}
      </p>
      <div role="group" aria-label="Rank brands by" className="mt-3 inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs" data-testid="moment-reach-measure">
        {REACH_MEASURES.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={measure === m.key}
            onClick={() => setMeasure(m.key)}
            className={`rounded-md px-3 py-1 font-medium ${measure === m.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <ol className="mt-3 flex flex-col gap-2" aria-label={`Brands ranked by ${REACH_MEASURES.find((m) => m.key === measure)!.label.toLowerCase()}`}>
        {ranked.map(({ brand, rank }) => {
          const v = brand[measure];
          const isFocal = brand.code === focal;
          return (
            <li
              key={brand.code}
              tabIndex={0}
              className={`grid grid-cols-[1.75rem_minmax(0,9rem)_minmax(0,1fr)_4rem] items-center gap-3 rounded-md px-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${isFocal ? "bg-blue-50 font-semibold" : ""}`}
              title={`${labelOf(brand.code)}: ${others(brand.code)}`}
              aria-label={`${rank === null ? "Not ranked" : `${rank} of ${ranked[0].of}`}, ${labelOf(brand.code)}: ${reachValueText(measure, v)}; ${others(brand.code)}`}
              data-testid="moment-reach-row"
              data-code={brand.code}
            >
              <span className="text-right text-xs tabular-nums text-slate-400">{rank ?? "-"}</span>
              <span className={`truncate ${isFocal ? "text-blue-700" : "text-slate-700"}`}>{labelOf(brand.code)}</span>
              <span className="h-3 rounded bg-slate-100">
                {v !== null && <span className="block h-full rounded" style={{ width: `${top > 0 ? Math.max(0.5, (v / top) * 100) : 0}%`, background: isFocal ? "#2563eb" : "#94a3b8" }} />}
              </span>
              <span className="text-right tabular-nums text-slate-900" data-testid="moment-reach-value">
                {reachValueText(measure, v)}
              </span>
            </li>
          );
        })}
      </ol>
      {naNotes.length > 0 && (
        <p className="mt-2 text-[11px] text-slate-500" data-testid="moment-reach-na">
          n/a: {naNotes.join(" ")}
        </p>
      )}
      <p className="mt-2 text-[11px] text-slate-500" data-testid="moment-reach-note">
        Moments per person = moment penetration x moments per linker. Share of moment links: each brand&apos;s links as a share of every listed brand&apos;s links.
        {leftOut.length > 0 && ` Left out of a brand's base: ${leftOut.map((b) => `${labelOf(b.code)} ${b.noneValid ?? 0} with no moment answered, ${b.partlyValid ?? 0} with some unanswered`).join("; ")}.`}{" "}
        No statistical comparison implied.
      </p>
      <details className="mt-2 text-xs" data-testid="moment-reach-table">
        <summary className="cursor-pointer text-slate-600">Show the figures as a table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Moment reach by brand</caption>
            <thead>
              <tr>
                <th scope="col" className="py-1 pr-2 font-medium text-slate-500">
                  Brand
                </th>
                {REACH_MEASURES.map((m) => (
                  <th key={m.key} scope="col" className="px-2 py-1 text-right font-medium text-slate-500">
                    {m.label}
                  </th>
                ))}
                <th scope="col" className="px-2 py-1 text-right font-medium text-slate-500">
                  Base
                </th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ brand }) => (
                <tr key={brand.code} className={`border-t border-slate-100 ${brand.code === focal ? "font-semibold text-blue-700" : "text-slate-700"}`} data-testid="moment-reach-table-row" data-code={brand.code}>
                  <th scope="row" className="py-1 pr-2 font-normal">
                    {labelOf(brand.code)}
                  </th>
                  {REACH_MEASURES.map((m) => (
                    <td key={m.key} className="px-2 py-1 text-right tabular-nums" data-measure={m.key}>
                      {reachValueText(m.key, brand[m.key])}
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right tabular-nums">
                    {brand.base === null ? "n/a" : `n=${brand.base.toLocaleString()}`}
                    {brand.effectiveBase !== null && <span className="ml-1 text-[10px] text-slate-400">eff. {Math.round(brand.effectiveBase).toLocaleString()}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
