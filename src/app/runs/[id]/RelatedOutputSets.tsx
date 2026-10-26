"use client";

import { useState } from "react";
import { compareWavesAction, mergeOutputSetsAction } from "@/lib/outputSetActions";
import { suggestRelated } from "@/lib/outputWaves";
import type { OutputSet } from "@/lib/outputSets";
import { actionFailureMessage } from "./actionFailure";

const select = "rounded-lg border border-border bg-white px-2 py-1 text-xs text-foreground";
const labelOf = (s: OutputSet) => (s.waveLabel ? `${s.name} (${s.waveLabel})` : s.name);

/**
 * Shown when a run holds two or more output sets: suggests which look like the
 * same analysis on another wave (compare them) or two parts of one output
 * (merge them), and lets the person compare any two.
 */
export default function RelatedOutputSets({ runId, sets }: { runId: string; sets: OutputSet[] }) {
  const suggestions = suggestRelated(sets.map((s) => ({ id: s.id, name: s.name, waveLabel: s.waveLabel, files: s.files.map((f) => ({ name: f.name })) })));
  const [earlier, setEarlier] = useState(sets[0].id);
  const [later, setLater] = useState(sets[1].id);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(sets.map((s) => [s.id, s]));

  function compare(a: string, b: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    compareWavesAction(runId, a, b)
      .then((r) => {
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setMessage(`${r.findings} change finding${r.findings === 1 ? "" : "s"} made.${r.notes.length ? ` ${r.notes.join(" ")}` : ""}`);
      })
      .catch((e) => setError(actionFailureMessage(e)))
      .finally(() => setBusy(false));
  }

  function merge(from: string, into: string) {
    if (!confirm(`Move every file of "${byId.get(from)?.name}" into "${byId.get(into)?.name}"? The emptied set is removed.`)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    mergeOutputSetsAction(runId, from, into)
      .then((r) => {
        if (!r.ok) setError(r.error);
        else setMessage(`${r.moved} files moved into one set.`);
      })
      .catch((e) => setError(actionFailureMessage(e)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border border-l-4 border-l-violet-400 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-foreground">Related sets and waves</p>
      {suggestions.length > 0 && (
        <ul className="space-y-2">
          {suggestions.map((s) => (
            <li key={`${s.aId}-${s.bId}`} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <span className="min-w-0 max-w-xl text-muted">
                <span className="font-medium text-foreground">
                  {byId.get(s.aId)?.name} and {byId.get(s.bId)?.name}.
                </span>{" "}
                {s.reason}
              </span>
              <button
                type="button"
                disabled={busy}
                className="shrink-0 rounded-lg border border-border bg-white px-2.5 py-1 font-medium text-foreground hover:border-primary disabled:opacity-50"
                onClick={() => (s.kind === "same_output_again" ? compare(s.aId, s.bId) : merge(s.bId, s.aId))}
              >
                {s.kind === "same_output_again" ? "Compare as waves" : "Merge into one set"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>Compare</span>
        <select aria-label="Later set" className={select} value={later} onChange={(e) => setLater(e.target.value)}>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {labelOf(s)}
            </option>
          ))}
        </select>
        <span>against the earlier</span>
        <select aria-label="Earlier set" className={select} value={earlier} onChange={(e) => setEarlier(e.target.value)}>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {labelOf(s)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || earlier === later}
          className="rounded-lg bg-primary px-2.5 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-50"
          onClick={() => compare(earlier, later)}
        >
          {busy ? "Working..." : "Compare"}
        </button>
      </div>
      <p className="text-[11px] text-muted">
        A comparison matches the same model terms and segments in both sets and tests each change against sampling error, assuming independent samples. It
        makes one finding per matched file, with the caveats attached.
      </p>
      {message && <p className="text-xs text-emerald-700">{message}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
