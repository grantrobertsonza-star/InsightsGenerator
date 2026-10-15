"use client";

import { useState } from "react";
import { loadCrosstabAction } from "@/lib/crosstabActions";
import { promoteEvidenceTableAction } from "@/lib/objectiveEvidenceActions";
import type { CrosstabResult } from "@/lib/parseStatsFile";

const fmtInt = (v: number) => Math.round(v).toLocaleString("en-ZA");
const fmtPct = (v: number) => (v === 0 ? "0" : v.toFixed(1));

/** The table behind one evidence answer, read-only, with a way to keep it in Cross tabs. */
export default function EvidenceTable({ runId, tableId }: { runId: string; tableId: string }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState<string>("");
  const [result, setResult] = useState<CrosstabResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (result) return;
    setBusy(true);
    const r = await loadCrosstabAction(runId, tableId);
    if (r.ok) {
      setLabel(r.label);
      setResult(r.result);
      if (!r.result) setError("The table could not be read back.");
    } else setError(r.error);
    setBusy(false);
  }

  async function promote() {
    setBusy(true);
    const r = await promoteEvidenceTableAction(runId, tableId);
    setNote(r.ok ? "Added to Cross tabs as a draft." : r.error);
    setBusy(false);
  }

  const cols = result?.columns ?? [];
  return (
    <span className="mt-1 block">
      <span className="flex flex-wrap items-center gap-3 text-xs">
        <button className="text-muted underline" onClick={() => void toggle()}>
          {open ? "Hide table" : "Show table"}
        </button>
        <button className="text-muted underline disabled:opacity-50" disabled={busy} onClick={() => void promote()}>
          Add to Cross tabs
        </button>
        {note && <span className="text-muted">{note}</span>}
      </span>
      {open && (
        <span className="mt-1.5 block overflow-x-auto rounded-lg border border-border bg-white">
          {busy && !result ? (
            <span className="block p-2 text-xs text-muted">Loading...</span>
          ) : error ? (
            <span className="block p-2 text-xs text-red-700">{error}</span>
          ) : result ? (
            <table className="w-full text-left text-[11px]">
              <caption className="px-2 py-1 text-left text-[10px] text-muted">{label}</caption>
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  <th className="px-2 py-1"> </th>
                  <th className="px-2 py-1 text-right">Total</th>
                  {cols.map((c, i) => (
                    <th key={i} className="px-2 py-1 text-right">
                      {c.blockLabel ? `${c.blockLabel}: ` : ""}
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.questions.map((q) => {
                  const mean = q.kind === "numeric" || q.kind === "grid";
                  return [
                    <tr key={`${q.key}-h`} className="bg-slate-50">
                      <td colSpan={cols.length + 2} className="px-2 py-1 font-medium text-foreground">
                        {q.label}
                      </td>
                    </tr>,
                    ...q.rows.map((r, ri) => {
                      const show = (v: number | null | undefined) => {
                        if (r.isBase) return v === null || v === undefined ? "" : fmtInt(v);
                        if (v === null || v === undefined) return "-";
                        if (r.isScore) return r.isMean ? v.toFixed(2) : `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
                        return mean ? String(v) : `${fmtPct(v)}%`;
                                      };
                      return (
                        <tr key={`${q.key}-${ri}`} className="border-b border-border/60 last:border-0">
                          <td className={`px-2 py-1 ${r.isBase ? "text-muted" : "text-foreground"}`}>{r.label}</td>
                          <td className="px-2 py-1 text-right">{show(r.isBase ? r.total.count : r.total.pct)}</td>
                          {cols.map((_, ci) => (
                            <td key={ci} className="px-2 py-1 text-right">
                              {show(r.isBase ? r.count[ci] : r.pct[ci])}
                            </td>
                          ))}
                        </tr>
                      );
                    }),
                  ];
                })}
              </tbody>
            </table>
          ) : null}
        </span>
      )}
    </span>
  );
}
