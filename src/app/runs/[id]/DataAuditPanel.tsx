"use client";

import { useState } from "react";
import { loadVariablesAction } from "@/lib/crosstabActions";
import type { DataAudit, WeightAudit } from "@/lib/parseStatsFile";

// Conventional rules of thumb, not standards: a design effect from weights above 2,
// or a largest weight more than 10 times the median, is worth a second look.
const DEFF_WARN = 2;
const RATIO_WARN = 10;

const fmt = (n: number | undefined, d = 0) =>
  n === undefined ? "n/a" : n.toLocaleString("en-ZA", { maximumFractionDigits: d });

function weightNotes(w: WeightAudit): string[] {
  const notes: string[] = [];
  if (w.nInvalid > 0) notes.push(`${fmt(w.nInvalid)} case(s) have a missing, zero or negative weight and are left out of every table.`);
  if ((w.deff ?? 0) > DEFF_WARN) notes.push(`Weights alone inflate the variance ${fmt(w.deff, 2)} times, which is high.`);
  if ((w.maxOverMedian ?? 0) > RATIO_WARN) notes.push(`The largest weight is ${fmt(w.maxOverMedian, 1)} times the median, so a few cases carry a lot.`);
  return notes;
}

/**
 * Weights and missing codes for a case-level data file. Loaded when opened,
 * because it needs the whole file read once (afterwards it is cached).
 */
export default function DataAuditPanel({ runId, documentId }: { runId: string; documentId: string }) {
  const [audit, setAudit] = useState<DataAudit | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (audit !== undefined) return;
    setAudit(null);
    void loadVariablesAction(runId, documentId).then((r) => {
      if (r.ok) setAudit(r.dictionary.audit ?? null);
      else setError(r.error);
    });
  }

  return (
    <details
      className="mt-3 rounded-lg border border-border bg-white p-3"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) load();
      }}
    >
      <summary className="cursor-pointer select-none text-xs font-semibold text-foreground">Weights and missing codes</summary>
      <div className="mt-3 space-y-3 text-xs text-foreground">
        {error && <p className="text-danger">{error}</p>}
        {!error && audit === null && <p className="text-muted">Reading the file…</p>}
        {audit && (
          <>
            <div>
              <p className="font-semibold">Weights</p>
              {audit.weights.length === 0 ? (
                <p className="text-muted">No weight variable was recognised. Tables will be unweighted unless you pick one.</p>
              ) : (
                <ul className="mt-1 space-y-2">
                  {audit.weights.map((w) => (
                    <li key={w.name} className="rounded border border-border p-2">
                      <p className="font-medium">
                        {w.name} <span className="font-normal text-muted">{w.label}</span>
                      </p>
                      <p className="text-muted">
                        {fmt(w.nValid)} valid, {fmt(w.nInvalid)} invalid. Sum {fmt(w.sum)}. Effective n {fmt(w.nEff)}; design effect from weights {fmt(w.deff, 2)};
                        efficiency {fmt(w.efficiencyPct, 1)}%. Largest weight {fmt(w.maxOverMedian, 1)} times the median; top 1% of cases carry {fmt(w.topOnePctShare, 1)}% of the weight.
                      </p>
                      {weightNotes(w).map((t) => (
                        <p key={t} className="mt-1 text-amber-700">
                          {t}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-muted">
                This describes the weights only. The sampling design (strata and clusters) is not modelled, so standard errors can be too small.
              </p>
            </div>
            {audit.dk && (
              <div>
                <p className="font-semibold">Don&apos;t know and refused codes</p>
                <p className="text-muted">
                  {audit.dk.declaredMissing === 0
                    ? "The file declares no user-missing values. "
                    : `${fmt(audit.dk.declaredMissing)} variable(s) declare user-missing values. `}
                  {fmt(audit.dk.variables)} variable(s) carry don&apos;t know, refused or not applicable answers as ordinary codes ({fmt(audit.dk.cases)} answers in total).
                  Averages leave these out. In percentage tables they stay in as answer categories and in the base, so check any question where they are common.
                </p>
                {audit.dk.top.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
                    {audit.dk.top.slice(0, 8).map((r) => (
                      <li key={r.variable}>
                        {r.variable}: {r.codes} ({fmt(r.cases)} cases)
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}
