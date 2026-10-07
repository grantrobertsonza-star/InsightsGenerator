"use client";

import { useState, useTransition } from "react";
import { scoreObjectivesAction } from "@/lib/qualityActions";

export type ObjectiveQualityRow = {
  order: number;
  text: string;
  scores: {
    specific: number;
    measurable: number;
    answerable: number;
    relevant: number;
    total: number;
    tier: "weak" | "workable" | "strong";
    rationale: string;
    suggestion: string;
  } | null;
};

const scoreCellClass: Record<number, string> = {
  1: "bg-slate-100 text-slate-600",
  3: "bg-amber-50 text-amber-700",
  5: "bg-indigo-50 text-indigo-700",
};

const tierClass = {
  strong: "bg-indigo-50 text-indigo-700",
  workable: "bg-amber-50 text-amber-700",
  weak: "bg-slate-100 text-slate-600",
} as const;

const tierLabel = {
  strong: "Strong",
  workable: "Workable",
  weak: "Needs work",
} as const;

const COLUMNS: [
  keyof NonNullable<ObjectiveQualityRow["scores"]>,
  string,
  string,
][] = [
  [
    "specific",
    "Specific",
    "Names who, which behaviour or attitude and in what context, so two researchers would read it the same way.",
  ],
  [
    "measurable",
    "Measurable",
    "Implies a clear measure or comparison, and what result would count as an answer.",
  ],
  [
    "answerable",
    "Answerable",
    "Judged against the documents, findings and variables uploaded when it was scored: does the data in hand speak to it?",
  ],
  [
    "relevant",
    "Relevant",
    "Its answer would inform or change the decision (or the business problem, when there is no decision yet).",
  ],
];

/**
 * Quality scores for the research objectives, adapted from SMART: Specific,
 * Measurable, Answerable with the data supplied, Relevant to the decision.
 * Achievable and time-bound are left out because an objective is a question
 * to be answered, not a project target.
 */
export default function ObjectiveQualityPanel({
  runId,
  rows,
  missingMigration,
}: {
  runId: string;
  rows: ObjectiveQualityRow[];
  missingMigration: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scored = rows.filter((r) => r.scores).length;

  function run(force: boolean) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await scoreObjectivesAction(runId, force);
      if (result.ok) setMessage(result.message);
      else setError(result.error);
    });
  }

  if (rows.length === 0)
    return (
      <p className="text-sm text-muted">
        No research objective is set yet. Once one is accepted it is scored
        here.
      </p>
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-xs text-muted">
          Each objective is scored 1, 3 or 5 on four dimensions, summed out of
          20. 16 or more is strong, 12 to 15 workable, below 12 needs work.
          &ldquo;Answerable&rdquo; is judged against what had been uploaded when
          the objective was scored, so rescore after adding data. Hover a column
          heading for its definition, or a rating for the reason.
          {scored < rows.length
            ? ` ${rows.length - scored} objective${rows.length - scored === 1 ? " is" : "s are"} not scored yet.`
            : ""}
        </p>
        <button
          type="button"
          disabled={isPending || missingMigration}
          onClick={() => run(scored > 0)}
          className="whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:border-slate-400 hover:text-foreground disabled:opacity-60"
        >
          {isPending
            ? "Scoring..."
            : scored > 0
              ? "Rescore objectives"
              : "Score objectives"}
        </button>
      </div>

      {missingMigration && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          Scoring needs database migration 0045.
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs text-foreground">
          {message}
        </div>
      )}
      {error && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-danger bg-danger-light px-3 py-2 text-xs text-danger">
          <span>Couldn&apos;t score the objectives: {error}</span>
          <button
            onClick={() => setError(null)}
            className="shrink-0 font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-white">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-muted">
              <th className="px-3 py-2">Objective</th>
              {COLUMNS.map(([key, label, definition]) => (
                <th
                  key={key}
                  title={definition}
                  className="px-2 py-2 text-center"
                >
                  {label}
                </th>
              ))}
              <th className="px-2 py-2 text-center">Total</th>
              <th className="px-3 py-2">Rating</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.order}
                className="border-b border-border align-top last:border-0"
              >
                <td className="max-w-md px-3 py-2 text-foreground">
                  {row.text}
                  {row.scores?.suggestion && (
                    <div className="mt-1 text-[11px] text-muted">
                      <span className="font-medium">To sharpen it:</span>{" "}
                      {row.scores.suggestion}
                    </div>
                  )}
                </td>
                {COLUMNS.map(([key]) => {
                  const value = row.scores ? (row.scores[key] as number) : null;
                  return (
                    <td key={key} className="px-2 py-2 text-center">
                      {value === null ? (
                        <span className="text-muted">-</span>
                      ) : (
                        <span
                          className={`inline-block min-w-6 rounded px-1.5 py-0.5 font-semibold ${scoreCellClass[value] ?? scoreCellClass[1]}`}
                        >
                          {value}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-2 text-center font-semibold text-foreground">
                  {row.scores ? `${row.scores.total}/20` : "-"}
                </td>
                <td className="px-3 py-2">
                  {row.scores ? (
                    <span
                      title={row.scores.rationale}
                      className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${tierClass[row.scores.tier]}`}
                    >
                      {tierLabel[row.scores.tier]}
                    </span>
                  ) : (
                    <span className="text-muted">Not scored</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
