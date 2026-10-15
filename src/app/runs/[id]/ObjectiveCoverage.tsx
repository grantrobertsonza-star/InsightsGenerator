"use client";

import { useState, useTransition } from "react";
import { sameObjective, useObjectiveSelection } from "./ObjectiveSelection";
import { checkObjectiveCoverage, suggestObjectivesFromUnmatched } from "@/lib/objectiveCoverageActions";

type Validation = {
  item_kind: "objective" | "decision";
  item_order: number;
  item_text: string;
  status: "resolved" | "partial" | "gap";
  conclusion: string;
  synthesized_insight_ids: string[];
  inferred: boolean;
};
type InsightLite = { id: string; headline: string; review_status: string };

const statusLabel = { resolved: "Answered", partial: "Partly answered", gap: "Gap" } as const;
const statusStyle = {
  resolved: "bg-green-50 text-green-800 ring-green-200",
  partial: "bg-amber-50 text-amber-800 ring-amber-200",
  gap: "bg-red-50 text-red-800 ring-red-200",
} as const;

const btn =
  "whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:border-slate-400 hover:text-foreground disabled:opacity-60";

export default function ObjectiveCoverage({
  runId,
  validations,
  insights,
  hasObjectiveOrDecision,
}: {
  runId: string;
  validations: Validation[];
  insights: InsightLite[];
  hasObjectiveOrDecision: boolean;
}) {
  const { selected, select } = useObjectiveSelection();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const accepted = insights.filter((i) => i.review_status === "accepted");
  const byId = new Map(insights.map((i) => [i.id, i.headline]));
  const statedExists = validations.some((v) => !v.inferred);
  // Stated items first (objectives, then decisions), inferred ones after.
  const ordered = [...validations].sort(
    (x, y) =>
      Number(x.inferred) - Number(y.inferred) ||
      (x.item_kind === y.item_kind ? x.item_order - y.item_order : x.item_kind === "objective" ? -1 : 1),
  );
  const covered = new Set(validations.filter((v) => !v.inferred).flatMap((v) => v.synthesized_insight_ids));
  const unmatched = accepted.filter((i) => !covered.has(i.id));

  function run(fn: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    start(async () => {
      const r = await fn(runId);
      if (!r.ok) setError(r.error);
    });
  }

  if (accepted.length === 0 && validations.length === 0) {
    return (
      <p className="text-sm text-muted">
        Coverage appears here once there are accepted insights: each objective is checked against them,
        and evidence that no objective asks about is listed.
      </p>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-white p-4">
      <div className="flex flex-col items-start gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Coverage of your objectives</h3>
          <p className="mt-1 text-xs text-muted">
            Each stated objective and decision is checked against the accepted insights. This updates
            after each analysis run.
          </p>
        </div>
        {hasObjectiveOrDecision && (
          <button className={btn} disabled={pending} onClick={() => run(checkObjectiveCoverage)}>
            {pending ? "Working..." : validations.length > 0 ? "Check again" : "Check now"}
          </button>
        )}
      </div>

      {selected && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
          Showing the selected objective only.
          <button className="underline" onClick={() => select(selected)}>Show all</button>
        </p>
      )}
      {validations.length > 0 ? (
        <ul className="space-y-3">
          {ordered.filter((v) => !selected || sameObjective(selected, { text: v.item_text })).map((v) => (
            <li key={`${v.item_kind}-${v.item_order}`} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                    v.inferred ? "bg-slate-100 text-slate-600 ring-slate-200" : statusStyle[v.status]
                  }`}
                >
                  {v.inferred ? "Inferred" : statusLabel[v.status]}
                </span>
                <span className="text-xs uppercase tracking-wide text-muted">{v.item_kind}</span>
              </div>
              <p className="mt-1.5 text-sm font-medium text-foreground">{v.item_text}</p>
              {v.inferred && (
                <p className="mt-1 text-xs text-muted">
                  Generated from this project&apos;s own evidence, so it is not an independent test and gets
                  no verdict. Add your own objective if you want a real check.
                </p>
              )}
              <p className="mt-1 text-sm text-muted">{v.conclusion}</p>
              {v.synthesized_insight_ids.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted">
                  {v.synthesized_insight_ids
                    .map((id) => byId.get(id))
                    .filter((h): h is string => Boolean(h))
                    .map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">
          {hasObjectiveOrDecision
            ? "Not checked yet."
            : "No objective set, so there is nothing to check against. Every accepted insight is listed below."}
        </p>
      )}

      {selected ? null : statedExists || (validations.length === 0 && !hasObjectiveOrDecision) ? (
      <div className="border-t border-border pt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Evidence without an objective ({unmatched.length})
            </h3>
            <p className="mt-1 text-xs text-muted">
              Accepted insights that no stated objective or decision points at. They are real findings the
              project did not ask about.
            </p>
          </div>
          {unmatched.length > 0 && (
            <button className={btn} disabled={pending} onClick={() => run(suggestObjectivesFromUnmatched)}>
              {pending ? "Working..." : "Suggest objectives for these"}
            </button>
          )}
        </div>
        {unmatched.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-foreground">
            {unmatched.map((i) => (
              <li key={i.id}>{i.headline}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">None. Every accepted insight bears on an objective.</p>
        )}
      </div>
      ) : validations.length === 0 ? (
        <p className="border-t border-border pt-4 text-xs text-muted">
          Evidence without an objective is listed once the check has run.
        </p>
      ) : (
        <p className="border-t border-border pt-4 text-xs text-muted">
          No objective was stated, so the objectives above were inferred from the evidence and no insight is
          reported as falling outside them.
        </p>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
