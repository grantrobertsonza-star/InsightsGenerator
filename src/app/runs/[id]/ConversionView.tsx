"use client";

// The "Conversion" view of the brand dashboard's funnel card on page 01 (Grant, 30 October 2026). Of the respondents
// at one stage for a brand, the share also at the next stage, per brand, one small ranked bar chart per step. The
// figures come from src/lib/trackerConversion.ts (loadBrandConversionAction), the ranking and headline wording from
// src/lib/trackerConversionDisplay.ts (rankConversion, conversionHeadline); this screen formats them and never
// computes a figure.
//
// A toggle on the funnel card ("Funnel" / "Conversion") rather than a card of its own: the conversion charts take the
// funnel card's place instead of adding a row of the same height under it, and the conversion is calculated only when
// it is first asked for (one engine table per brand and stage, about 40 for a ten-brand file).
//
// Requests: only the latest answer is shown (a reload of the dashboard or another file makes earlier answers stale);
// a failed calculation says why with "Try again", never an empty chart.
import { useCallback, useEffect, useRef, useState } from "react";
import { loadBrandConversionAction } from "@/lib/trackerConversionActions";
import { conversionHeadline, conversionStageName, rankConversion, type ConversionCell } from "@/lib/trackerConversionDisplay";
import type { BrandConversion, ConversionStep } from "@/lib/trackerConversion";
import type { FunnelStage } from "@/lib/trackerRoles";

const FOCAL_COLOUR = "#2563eb";
const OTHER_COLOUR = "#93c5fd";

export type FunnelView = "funnel" | "conversion";

/** The funnel card's switch between the stage shares and the stage-to-stage conversion. */
export function FunnelViewSwitch({ value, onChange }: { value: FunnelView; onChange: (v: FunnelView) => void }) {
  return (
    <div role="group" aria-label="Funnel card view" className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs" data-testid="tracker-funnel-view">
      {(["funnel", "conversion"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1 ${value === v ? "bg-white font-semibold text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
        >
          {v === "funnel" ? "Funnel" : "Conversion"}
        </button>
      ))}
    </div>
  );
}

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: BrandConversion };

const pct1 = (v: number) => `${v.toFixed(1)}%`;
const n = (v: number | null) => (v === null ? "n/a" : v.toLocaleString());
const stageWord = (s: FunnelStage) => conversionStageName(s).toLowerCase();
const unknownN = (c: ConversionCell) => c.unknownAtTo.reduce((t, u) => t + u.n, 0);

/** What a bar says on hover or focus: the base and the counts behind it. */
function cellDetail(c: ConversionCell, label: string): string {
  const parts = [
    c.conversion !== null ? `${label}: ${pct1(c.conversion)}` : `${label}: no figure${c.reason ? `, ${c.reason.replace(/\.$/, "")}` : ""}`,
    `base n=${n(c.base)} (at the earlier stage with a known answer at the later one)`,
    c.converted !== null ? `${n(c.converted)} at both stages` : "",
    unknownN(c) > 0 ? `${unknownN(c)} unknown at the later stage, outside the base` : "",
    c.noAnswerAtTo ? `${c.noAnswerAtTo} with no answer at the later stage, outside the base` : "",
    c.nonNested ? `${c.nonNested} at the later stage without the earlier one` : "",
  ];
  return parts.filter(Boolean).join("; ");
}

function StepChart({ step, brandLabel, focalCode, focal }: { step: ConversionStep; brandLabel: Map<string, string>; focalCode: string | null; focal: { code: string; label: string } | null }) {
  const ranking = rankConversion(step.cells);
  const byCode = new Map(step.cells.map((c) => [c.code, c]));
  // Ranked brands first, then those without a figure in the brand list's order (never drawn as 0).
  const order = [...ranking.ranked.map((r) => r.code), ...step.cells.filter((c) => c.conversion === null).map((c) => c.code)];
  const nonNested = step.cells.filter((c) => (c.nonNested ?? 0) > 0);
  const unknown = step.cells.filter((c) => unknownN(c) > 0 || (c.noAnswerAtTo ?? 0) > 0);
  const label = (code: string) => brandLabel.get(code) ?? code;
  return (
    <div className="min-w-0" data-testid="tracker-conversion-step" data-step={`${step.from}:${step.to}`}>
      <p className="text-sm font-semibold text-slate-900">{step.label}</p>
      <p className="mt-0.5 min-h-[2.5em] text-xs text-slate-600" data-testid="tracker-conversion-headline">
        {conversionHeadline(step, step.cells, focal)}
      </p>
      <ol className="mt-2 flex flex-col gap-1">
        {order.map((code) => {
          const c = byCode.get(code)!;
          const isFocal = code === focalCode;
          const detail = cellDetail(c, label(code));
          return (
            <li
              key={code}
              tabIndex={0}
              title={detail}
              aria-label={detail}
              className={`grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_3.2rem] items-center gap-2 rounded text-xs outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${isFocal ? "font-semibold" : ""}`}
              data-testid="tracker-conversion-bar"
              data-code={code}
              data-focal={isFocal ? "true" : undefined}
            >
              <span className={`truncate text-right ${isFocal ? "text-blue-700" : "text-slate-600"}`}>{label(code)}</span>
              <span className="h-3 rounded bg-slate-100">
                {c.conversion !== null && <span className="block h-full rounded" style={{ width: `${Math.max(0, Math.min(100, c.conversion))}%`, background: isFocal ? FOCAL_COLOUR : OTHER_COLOUR }} />}
              </span>
              <span className="text-right tabular-nums text-slate-900" data-testid="tracker-conversion-value">
                {c.conversion !== null ? pct1(c.conversion) : c.suppressed ? `n=${c.base}` : "n/a"}
              </span>
            </li>
          );
        })}
      </ol>
      {nonNested.length > 0 && (
        <p className="mt-2 text-[11px] text-amber-800" data-testid="tracker-conversion-nonnested">
          Not nested: {nonNested.map((c) => `${label(c.code)} ${c.nonNested}`).join(", ")} at {stageWord(step.to)} without {stageWord(step.from)}. The figure is among those at {stageWord(step.from)}, not a ratio of the two shares.
        </p>
      )}
      {unknown.length > 0 && (
        <p className="mt-1 text-[11px] text-slate-500" data-testid="tracker-conversion-unknown">
          Outside the base (unknown or no answer at {stageWord(step.to)}): {unknown.map((c) => `${label(c.code)} ${unknownN(c) + (c.noAnswerAtTo ?? 0)}`).join(", ")}.
        </p>
      )}
    </div>
  );
}

/**
 * The conversion charts for one data file. `refreshKey` changes whenever the dashboard reloads (a saved choice, a
 * reset), which asks again; the brands and the client's brand come with the answer, so they always match its figures.
 */
export function ConversionView({ runId, documentId, refreshKey }: { runId: string; documentId: string; refreshKey: unknown }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const latest = useRef(0);
  const ask = useCallback(async () => {
    const id = ++latest.current;
    setLoad({ state: "loading" });
    const r = await loadBrandConversionAction(runId, documentId);
    if (id !== latest.current) return;
    setLoad(r.ok ? { state: "ready", data: r.conversion } : { state: "failed", error: r.error });
  }, [runId, documentId]);

  useEffect(() => {
    // Asked when shown and again after each reload of the dashboard; the answer sets state only when it is the latest.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void ask();
    return () => {
      latest.current += 1;
    };
  }, [ask, refreshKey]);

  if (load.state === "loading")
    return (
      <p className="text-sm text-slate-500" role="status" data-testid="tracker-conversion-loading">
        Calculating conversion between stages from this file...
      </p>
    );
  if (load.state === "failed")
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="tracker-conversion-failed">
        <p>Conversion could not be calculated: {load.error}</p>
        <button type="button" onClick={() => void ask()} className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs">
          Try again
        </button>
      </div>
    );
  const d = load.data;
  if (d.conversion.status !== "ok")
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4" data-testid="tracker-conversion-unavailable" data-status={d.conversion.status}>
        <p className="text-sm font-semibold text-slate-700">{d.conversion.status === "not_measured" ? "Not measured" : "Mapping needed"}</p>
        <p className="mt-1 text-xs text-slate-500">{d.conversion.reason}</p>
      </div>
    );
  const { steps, skipped } = d.conversion;
  const brandLabel = new Map(d.dashboard.brands.map((b) => [b.code, b.label]));
  const focal = d.dashboard.focalBrand ? { code: d.dashboard.focalBrand.code, label: d.dashboard.focalBrand.label } : null;
  return (
    <div data-testid="tracker-conversion">
      <p className="text-xs text-slate-500" data-testid="tracker-conversion-basis">
        {d.weighted ? `Weighted by ${d.weightVar}` : "Unweighted"}. Of the respondents at a stage for a brand, the share also at the next stage; each brand on its own base (those
        at the earlier stage with a known answer at the later one). Ranked by the unrounded figure; no significance tests. Bases under {d.minBase ?? "the minimum"} are not shown or ranked.
      </p>
      {steps.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600" data-testid="tracker-conversion-none">
          No two stages of the funnel are mapped to a question each, so there is no conversion to show.
        </p>
      ) : (
        <div className={`mt-3 grid grid-cols-1 gap-x-6 gap-y-5 ${steps.length >= 3 ? "lg:grid-cols-3" : steps.length === 2 ? "lg:grid-cols-2" : ""}`}>
          {steps.map((s) => (
            <StepChart key={`${s.from}:${s.to}`} step={s} brandLabel={brandLabel} focalCode={focal?.code ?? null} focal={focal} />
          ))}
        </div>
      )}
      {skipped.length > 0 && (
        <ul className="mt-3 list-disc pl-4 text-[11px] text-slate-500" data-testid="tracker-conversion-skipped">
          {skipped.map((s) => (
            <li key={`${s.from}:${s.to}`} data-status={s.status}>
              {s.reason}
            </li>
          ))}
        </ul>
      )}
      {steps.length > 0 && (
        <details className="mt-3 text-xs" data-testid="tracker-conversion-table">
          <summary className="cursor-pointer text-slate-600">Table of figures and bases</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Conversion between stages by brand, with bases and counts</caption>
              <thead>
                <tr className="text-slate-500">
                  {["Step", "Brand", "Conversion", "Base (n)", "At earlier stage", "At both", "Unknown at later", "No answer at later", "At later only"].map((h) => (
                    <th key={h} scope="col" className="px-1.5 py-1 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {steps.flatMap((s) =>
                  s.cells.map((c) => (
                    <tr key={`${s.from}:${c.code}`} className="border-t border-slate-100">
                      <th scope="row" className="px-1.5 py-1 font-normal text-slate-600">
                        {s.label}
                      </th>
                      <td className="px-1.5 py-1">{brandLabel.get(c.code) ?? c.code}</td>
                      <td className="px-1.5 py-1 tabular-nums" title={c.reason}>
                        {c.conversion !== null ? pct1(c.conversion) : c.suppressed ? "small base" : "n/a"}
                      </td>
                      <td className="px-1.5 py-1 tabular-nums">{n(c.base)}</td>
                      <td className="px-1.5 py-1 tabular-nums">{n(c.atFrom)}</td>
                      <td className="px-1.5 py-1 tabular-nums">{n(c.converted)}</td>
                      <td className="px-1.5 py-1 tabular-nums">{c.unknownAtTo.length === 0 ? "0" : c.unknownAtTo.map((u) => `${u.n} ${u.label ?? `code ${u.code}`}`).join(", ")}</td>
                      <td className="px-1.5 py-1 tabular-nums">{n(c.noAnswerAtTo)}</td>
                      <td className="px-1.5 py-1 tabular-nums">{n(c.nonNested)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
