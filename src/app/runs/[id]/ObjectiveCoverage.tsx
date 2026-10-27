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
  /** OBJ-REV-012: the conclusion was generated while direct data-evidence retrieval was failing. */
  evidence_digest_degraded: boolean;
  /** CE-1: the accepted candidate this row judged (null for an item from the project's own text, or before migration 0119). */
  objective_candidate_id?: string | null;
  decision_candidate_id?: string | null;
  /** B37-F01: why the insights this conclusion cites do not support it as current (objectiveCoverage.ts coverageSupportNote); null when they do. */
  support_note?: string | null;
  /** The cited support's status label, beside the verdict (same label as the insight cards). */
  support_label?: string | null;
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

/** The coverage check, shared by the right pane and the selected objective's Coverage tile. It always re-checks every stated objective and decision and refreshes "Evidence without an objective". */
function useCoverageCheck(runId: string) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(fn: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    start(async () => {
      const r = await fn(runId);
      if (!r.ok) setError(r.error);
    });
  }
  return { pending, error, run };
}

export default function ObjectiveCoverage({
  runId,
  validations,
  insights,
  hasObjectiveOrDecision,
  staleNote = null,
}: {
  runId: string;
  validations: Validation[];
  insights: InsightLite[];
  hasObjectiveOrDecision: boolean;
  /** CE-1: why these verdicts are not known to be current (objectiveCoverage.ts), or null. */
  staleNote?: string | null;
}) {
  const { selected } = useObjectiveSelection();
  const { pending, error, run } = useCoverageCheck(runId);
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

  // With an objective selected its coverage, and the button that updates coverage, sit under its
  // detail in the middle pane (SelectedObjectiveCoverage); this card would only repeat that button
  // (Grant, 2026-10-26), so it steps aside until "All objectives" clears the selection.
  if (selected) return null;

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
            Each stated objective and decision is checked against the accepted insights. It updates after
            each analysis run and when objectives change; after you accept or reject insights, update it.
          </p>
        </div>
        <StaleNote note={validations.length > 0 ? staleNote : null} />
        {hasObjectiveOrDecision && (
          <button className={btn} disabled={pending} onClick={() => run(checkObjectiveCoverage)}>
            {pending ? "Working..." : validations.length > 0 ? "Check again" : "Check now"}
          </button>
        )}
      </div>

      {validations.length > 0 ? (
        <ul className="space-y-3">
          {ordered.map((v) => (
            <CoverageCard key={`${v.item_kind}-${v.item_order}`} v={v} byId={byId} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">
          {hasObjectiveOrDecision
            ? "Not checked yet."
            : "No objective set, so there is nothing to check against. Every accepted insight is listed below."}
        </p>
      )}

      {statedExists || (validations.length === 0 && !hasObjectiveOrDecision) ? (
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

/** One objective's or decision's coverage verdict, with the insights it rests on. */
function CoverageCard({ v, byId }: { v: Validation; byId: Map<string, string> }) {
  return (
    <li className="rounded-lg border border-border bg-white p-3" data-testid="coverage-item">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
            v.inferred ? "bg-slate-100 text-slate-600 ring-slate-200" : statusStyle[v.status]
          }`}
        >
          {v.inferred ? "Inferred" : statusLabel[v.status]}
        </span>
        {v.support_note && v.support_label && (
          <span data-testid="coverage-support-chip" className="whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
            {v.support_label}
          </span>
        )}
        {v.evidence_digest_degraded && (
          <span className="whitespace-nowrap rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-800 ring-1 ring-inset ring-orange-200">
            Evidence check degraded
          </span>
        )}
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
      {/* B37-F01: the saved conclusion is kept as written; whether what it cites still supports it is said here. */}
      {v.support_note && (
        <p data-testid="coverage-support" className="mt-1 text-xs text-amber-800">
          {v.support_note}
        </p>
      )}
      {/* Same qualification the report section and both story exports carry. Shown as text,
          not only a tooltip, so it is readable on touch screens; the conclusion and status
          above are unchanged. "Check again" re-runs the check and clears it once retrieval
          works. */}
      {v.evidence_digest_degraded && (
        <p data-testid="coverage-evidence-degraded" className="mt-1 text-xs text-orange-800">
          Generated while data-evidence retrieval was failing, so it may be missing evidence a working
          check would have cited. Check again once the data evidence loads.
        </p>
      )}
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
  );
}

/**
 * The selected objective's coverage, shown under its detail on the one-page Objectives prototype
 * (Grant, 2026-10-22), with the button that updates coverage (2026-10-26; the right pane's card steps
 * aside while an objective is selected, so the button is not shown twice). The update re-checks every
 * objective and decision, as the right pane's does. Matched by the same objective identity as the
 * rest of the page (sameObjective). With nothing selected it renders nothing: the right pane lists
 * every verdict.
 */
export function SelectedObjectiveCoverage({
  runId,
  validations,
  insights,
  hasObjectiveOrDecision,
  staleNote = null,
}: {
  runId: string;
  validations: Validation[];
  insights: InsightLite[];
  hasObjectiveOrDecision: boolean;
  staleNote?: string | null;
}) {
  const { selected } = useObjectiveSelection();
  const { pending, error, run } = useCoverageCheck(runId);
  if (!selected) return null;
  const byId = new Map(insights.map((i) => [i.id, i.headline]));
  // By the candidate's id where the row records it (CE-1), by its wording otherwise.
  const matching = validations.filter((v) => sameObjective(selected, { id: v.objective_candidate_id ?? v.decision_candidate_id ?? null, text: v.item_text }));
  // The same condition as the right pane's button: there is something to check against.
  const canCheck = hasObjectiveOrDecision && (validations.length > 0 || insights.some((i) => i.review_status === "accepted"));
  return (
    <section className="mt-4" data-testid="selected-objective-coverage">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Coverage</h3>
        {canCheck && (
          <button
            className={btn}
            disabled={pending}
            onClick={() => run(checkObjectiveCoverage)}
            title="Checks every stated objective and decision against the accepted insights, not only this one"
          >
            {pending ? "Working..." : "Update coverage"}
          </button>
        )}
      </div>
      <StaleNote note={matching.length > 0 ? staleNote : null} />
      {matching.length > 0 ? (
        <ul className="space-y-3">
          {matching.map((v) => (
            <CoverageCard key={`${v.item_kind}-${v.item_order}`} v={v} byId={byId} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">
          {validations.length > 0
            ? "This objective was not in the last coverage check. Update coverage to include it."
            : canCheck
              ? "Not checked against the insights yet. Update coverage to check it."
              : "Coverage is checked once there are accepted insights."}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}

/** CE-1: coverage that is not known to be current says so beside its verdicts, never silently. */
function StaleNote({ note }: { note: string | null }) {
  if (!note) return null;
  return (
    <p role="status" data-testid="coverage-stale" className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      {note}
    </p>
  );
}
