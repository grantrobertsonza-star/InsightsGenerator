"use client";

import { useState, useTransition } from "react";
import { askCrosstabAction } from "@/lib/crosstabActions";
import type { AskPlan } from "@/lib/crosstabAsk";
import { ASK_MEMORY_REQUESTS } from "@/lib/crosstabAskShared";
import type { VariableDictionary } from "@/lib/parseStatsFile";
import { filterText } from "./CrosstabFilters";

export type AskHistory = { documentId: string; items: { request: string; summary: string }[] };

/**
 * Ask for a table in plain English. The answer is a setup to read and confirm, never a table that
 * runs by itself: the researcher sees which variables, which filters and what was assumed first.
 */
export default function CrosstabAsk({
  runId,
  documentId,
  dict,
  busy,
  onUse,
  history,
  onHistory,
}: {
  runId: string;
  documentId: string;
  dict: VariableDictionary;
  busy: boolean;
  onUse: (plan: AskPlan, run: boolean) => void;
  /**
   * Memory (Grant, 2026-10-22): this panel's earlier requests on this data file, held by the
   * workspace so they survive switching between ways of making tables (Add table now leaves this
   * panel). Sent with the next request so "the table just produced" or "same but women only" can
   * be followed; the tables themselves are read on the server from what was built. A history kept
   * for another data file is not used.
   */
  history: AskHistory;
  onHistory: (next: AskHistory) => void;
}) {
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<AskPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const earlier = history.documentId === documentId ? history.items : [];

  function ask() {
    setError(null);
    setPlan(null);
    const request = text.trim();
    const sentFor = documentId;
    start(async () => {
      const r = await askCrosstabAction(runId, sentFor, request, earlier);
      if (r.ok) {
        setPlan(r.plan);
        onHistory({
          documentId: sentFor,
          items: [...(history.documentId === sentFor ? history.items : []), { request, summary: r.plan.summary }].slice(-ASK_MEMORY_REQUESTS),
        });
      } else setError(r.error);
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-slate-50 p-3 text-xs">
      <p className="text-base font-semibold text-foreground">Ask for a table in plain English</p>
      <div className="flex flex-col gap-2">
        <textarea
          value={text}
          rows={4}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && text.trim().length >= 5 && !pending) {
              e.preventDefault();
              ask();
            }
          }}
          placeholder={"What to measure, who to compare, and who to include. For example:\n\n  income by gender for people aged 24 to 36\n  main source of money by province, women only\n  how satisfied people are with their bank, by age group"}
          maxLength={600}
          className="min-h-[7rem] w-full resize-y rounded-lg border border-border bg-white px-3 py-2.5 text-base leading-relaxed"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={ask}
            disabled={pending || text.trim().length < 5}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Reading..." : "Set it up"}
          </button>
          <span className="text-muted">Enter sends, Shift+Enter adds a line.</span>
        </div>
        <p className="text-[11px] text-muted" data-testid="crosstab-ask-memory">
          {`Remembers the tables built from this file${earlier.length ? ` and your last ${earlier.length === 1 ? "request" : `${earlier.length} requests`} here` : ""}, so you can say "the table just produced".`}
          {earlier.length > 0 && (
            <button type="button" className="ml-1.5 underline" onClick={() => onHistory({ documentId, items: [] })}>
              Forget my earlier requests
            </button>
          )}
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-muted">
          <li>Name what to measure (the rows) and, after &quot;by&quot;, who to compare (the columns).</li>
          <li>Limit the people in plain terms: &quot;aged 24 to 36&quot;, &quot;women only&quot;, &quot;in Gauteng&quot;.</li>
          <li>Use the wording of the question or variable if you know it. Ask for one table at a time.</li>
          <li>You always get a setup to check first. Nothing runs until you press Add table.</li>
        </ul>
      </div>
      {error && <p className="text-danger">{error}</p>}
      {plan && (
        <div className="space-y-2 rounded border border-border bg-white p-2">
          <p className="text-foreground" data-testid="crosstab-ask-summary">{plan.summary}</p>
          <dl className="grid grid-cols-[5rem_1fr] gap-y-1">
            {plan.basedOn && (
              <>
                <dt className="text-muted">Starts from</dt>
                <dd data-testid="crosstab-ask-based-on">{plan.basedOn.label}</dd>
              </>
            )}
            <dt className="text-muted">Rows</dt>
            <dd data-testid="crosstab-ask-rows">
              {plan.rows.length
                ? plan.rows.map((r) => (plan.averageOnly.includes(r.key) ? `${r.label} (average)` : plan.means.includes(r.key) ? `${r.label} (mean, then answers)` : r.label)).join("; ")
                : "none (describing the columns on their own)"}
            </dd>
            <dt className="text-muted">Columns</dt>
            <dd data-testid="crosstab-ask-columns">{plan.columns.length ? plan.columns.map((c) => c.label).join("; ") : "everyone (no split)"}</dd>
            <dt className="text-muted">Filters</dt>
            <dd>{plan.filters.length ? plan.filters.map((f) => filterText(f, dict)).join("; ") : "none"}</dd>
          </dl>
          {plan.unclear.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-amber-700" data-testid="crosstab-ask-check">
              {plan.unclear.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => onUse(plan, false)} className="rounded border border-border px-3 py-1 font-medium disabled:opacity-50">
              Put this in the workspace
            </button>
            <button type="button" disabled={busy} onClick={() => onUse(plan, true)} className="rounded bg-primary px-3 py-1 font-medium text-white disabled:opacity-50">
              Add table now
            </button>
          </div>
          <p className="text-[11px] text-muted">Check the variables and filters before you rely on the table. Weight, tests and corrections are set below as usual.</p>
        </div>
      )}
    </div>
  );
}
