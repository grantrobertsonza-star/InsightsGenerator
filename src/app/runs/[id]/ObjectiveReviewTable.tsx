"use client";

import { useState, useTransition } from "react";
import {
  acceptObjectiveCandidate,
  rejectObjectiveCandidate,
  restoreObjectiveCandidate,
  deleteObjectiveCandidate,
  addOwnObjectiveCandidate,
  regenerateObjectiveCandidates,
  acceptAllObjectiveCandidates,
  deleteSuggestedObjectives,
} from "@/lib/objectiveCandidateActions";
import { scoreObjectivesAction } from "@/lib/qualityActions";
import { TrashIcon } from "@/components/icons";

export type ObjectiveScores = {
  specific: number;
  measurable: number;
  answerable: number;
  relevant: number;
  total: number;
  tier: "weak" | "workable" | "strong";
  rationale: string;
  suggestion: string;
};

export type ObjectiveRow = {
  id: string;
  text: string;
  rationale: string;
  source: "researcher_authored" | "ai_suggested";
  status: "pending" | "accepted" | "rejected";
  edited: boolean;
  scores: ObjectiveScores | null;
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
const tierLabel = { strong: "Strong", workable: "Workable", weak: "Needs work" } as const;

const COLUMNS: ["specific" | "measurable" | "answerable" | "relevant", string, string][] = [
  ["specific", "Specific", "Names who, which behaviour or attitude and in what context, so two researchers would read it the same way."],
  ["measurable", "Measurable", "Implies a clear measure or comparison, and what result would count as an answer."],
  ["answerable", "Answerable", "Judged against the documents, findings and variables uploaded when it was scored: does the data in hand speak to it?"],
  ["relevant", "Relevant", "Its answer would inform or change the decision (or the business problem, when there is no decision yet)."],
];

const btn =
  "whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:border-slate-400 hover:text-foreground disabled:opacity-60";
const miniBtn =
  "rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted transition hover:border-slate-400 hover:text-foreground disabled:opacity-50";
const textareaClass =
  "w-full resize-none rounded-lg border border-border px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

function tagFor(row: ObjectiveRow) {
  if (row.source === "researcher_authored") return { label: "Stated", cls: "bg-slate-100 text-slate-600" };
  if (row.status === "accepted") return { label: "Inferred", cls: "bg-primary-light text-primary" };
  return { label: "Suggested", cls: "bg-amber-50 text-amber-700" };
}

function Row({ runId, row }: { runId: string; row: ObjectiveRow }) {
  const [isPending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.text);
  const tag = tagFor(row);
  const accepted = row.status === "accepted";
  const rejected = row.status === "rejected";

  return (
    <tr className={`border-b border-border align-top last:border-0 ${rejected ? "opacity-50" : ""}`}>
      <td className="max-w-md px-3 py-2 text-foreground">
        <span className={`mb-1 mr-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tag.cls}`}>
          {tag.label}
        </span>
        {row.edited && (
          <span className="mb-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Edited
          </span>
        )}
        {editing ? (
          <textarea autoFocus rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} className={`${textareaClass} mt-1`} />
        ) : (
          <div>{row.text}</div>
        )}
        {row.scores?.suggestion && !editing && (
          <div className="mt-1 text-[11px] text-muted">
            <span className="font-medium">To sharpen it:</span> {row.scores.suggestion}
          </div>
        )}
        {row.source === "ai_suggested" && row.rationale && !editing && (
          <div className="mt-1 text-[11px] text-muted">{row.rationale}</div>
        )}
      </td>
      {COLUMNS.map(([key]) => {
        const v = row.scores ? row.scores[key] : null;
        return (
          <td key={key} className="px-2 py-2 text-center">
            {v === null ? (
              <span className="text-muted">-</span>
            ) : (
              <span className={`inline-block min-w-6 rounded px-1.5 py-0.5 font-semibold ${scoreCellClass[v] ?? scoreCellClass[1]}`}>{v}</span>
            )}
          </td>
        );
      })}
      <td className="px-2 py-2 text-center font-semibold text-foreground">{row.scores ? `${row.scores.total}/20` : "-"}</td>
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
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {editing ? (
            <>
              <button
                className={miniBtn}
                disabled={isPending || !draft.trim()}
                onClick={() =>
                  start(async () => {
                    await acceptObjectiveCandidate(runId, row.id, draft.trim());
                    setEditing(false);
                  })
                }
              >
                Save
              </button>
              <button
                className={miniBtn}
                onClick={() => {
                  setDraft(row.text);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </>
          ) : rejected ? (
            <button className={miniBtn} disabled={isPending} onClick={() => start(() => restoreObjectiveCandidate(runId, row.id))}>
              Restore
            </button>
          ) : (
            <>
              {!accepted && (
                <button className={miniBtn} disabled={isPending} onClick={() => start(() => acceptObjectiveCandidate(runId, row.id))}>
                  Accept
                </button>
              )}
              <button className={miniBtn} disabled={isPending} onClick={() => setEditing(true)}>
                Edit
              </button>
              {accepted ? (
                <button className={miniBtn} disabled={isPending} onClick={() => start(() => restoreObjectiveCandidate(runId, row.id))}>
                  Unaccept
                </button>
              ) : (
                <button className={miniBtn} disabled={isPending} onClick={() => start(() => rejectObjectiveCandidate(runId, row.id))}>
                  Reject
                </button>
              )}
            </>
          )}
          <button
            aria-label="Delete objective"
            title="Delete objective"
            disabled={isPending}
            onClick={() => {
              if (!confirm("Delete this objective? This can't be undone.")) return;
              start(() => deleteObjectiveCandidate(runId, row.id));
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition hover:bg-danger-light hover:text-danger"
          >
            <TrashIcon className="h-3 w-3" />
          </button>
        </div>
      </td>
    </tr>
  );
}

/**
 * One table for every objective: stated, inferred and suggested, each with
 * its quality score and row actions. Scoring lives here, not at set-up,
 * because "Answerable" is judged against the data that has been uploaded.
 */
export default function ObjectiveReviewTable({
  runId,
  rows,
  hasFindings,
  missingMigration,
}: {
  runId: string;
  rows: ObjectiveRow[];
  hasFindings: boolean;
  missingMigration: boolean;
}) {
  const [isPending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addText, setAddText] = useState("");
  const [rejectedOpen, setRejectedOpen] = useState(false);

  const order = (r: ObjectiveRow) => (r.status === "accepted" ? 0 : 1) * 2 + (r.source === "ai_suggested" ? 1 : 0);
  const active = rows.filter((r) => r.status !== "rejected").sort((a, b) => order(a) - order(b));
  const rejected = rows.filter((r) => r.status === "rejected");
  const pendingCount = rows.filter((r) => r.status === "pending").length;
  const hasAi = rows.some((r) => r.source === "ai_suggested");
  const accepted = rows.filter((r) => r.status === "accepted");
  const scored = accepted.filter((r) => r.scores).length;

  function score() {
    setMessage(null);
    setError(null);
    start(async () => {
      const r = await scoreObjectivesAction(runId, scored > 0);
      if (r.ok) setMessage(r.message);
      else setError(r.error);
    });
  }
  function regenerate() {
    setError(null);
    start(async () => {
      const r = await regenerateObjectiveCandidates(runId);
      if (!r.ok) setError(r.error);
    });
  }

  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-xs text-muted">
          Each accepted objective is scored 1, 3 or 5 on four dimensions, summed out of 20: 16 or more is strong,
          12 to 15 workable, below 12 needs work. &ldquo;Answerable&rdquo; is judged against the data uploaded when
          it was scored, so rescore after adding data. Stated objectives are yours or came from your brief.
          Inferred and suggested ones come from the evidence. Hover a column heading for its definition.
          {accepted.length > scored ? ` ${accepted.length - scored} not scored yet.` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {accepted.length > 0 && (
            <button className={btn} disabled={isPending || missingMigration} onClick={score}>
              {isPending ? "Working..." : scored > 0 ? "Rescore objectives" : "Score objectives"}
            </button>
          )}
          {hasFindings && (
            <button className={btn} disabled={isPending} onClick={regenerate}>
              {hasAi ? "Regenerate suggestions" : "Suggest objectives from these findings"}
            </button>
          )}
          {pendingCount > 0 && (
            <button className={btn} disabled={isPending} onClick={() => start(() => acceptAllObjectiveCandidates(runId))}>
              Accept all suggested
            </button>
          )}
          {hasAi && (
            <button
              className={btn}
              disabled={isPending}
              onClick={() => {
                if (!confirm("Remove all suggested objectives? Your own and edited ones are kept.")) return;
                start(async () => {
                  await deleteSuggestedObjectives(runId);
                });
              }}
            >
              Remove suggested
            </button>
          )}
        </div>
      </div>

      {missingMigration && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          Scoring needs database migration 0045.
        </div>
      )}
      {message && <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs text-foreground">{message}</div>}
      {error && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-danger bg-danger-light px-3 py-2 text-xs text-danger">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {active.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-slate-50 px-4 py-3 text-sm text-muted">
          No objectives yet. Add your own below, or ask for suggestions once there are findings.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full min-w-[860px] text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Objective</th>
                {COLUMNS.map(([key, label, definition]) => (
                  <th key={key} title={definition} className="px-2 py-2 text-center">
                    {label}
                  </th>
                ))}
                <th className="px-2 py-2 text-center">Total</th>
                <th className="px-3 py-2">Rating</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {active.map((row) => (
                <Row key={row.id} runId={runId} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = addText.trim();
          if (!text) return;
          start(async () => {
            await addOwnObjectiveCandidate(runId, text);
            setAddText("");
          });
        }}
        className="rounded-lg border border-dashed border-border p-4"
      >
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Add your own objective</label>
        <textarea
          rows={2}
          value={addText}
          onChange={(e) => setAddText(e.target.value)}
          placeholder="e.g. Does price or service quality drive lapsed-member churn more?"
          className={textareaClass}
        />
        <button
          type="submit"
          disabled={isPending || !addText.trim()}
          className="mt-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
        >
          Add objective
        </button>
      </form>

      {rejected.length > 0 && (
        <div className="rounded-lg border border-dashed border-border p-3">
          <button
            type="button"
            onClick={() => setRejectedOpen((o) => !o)}
            className="flex w-full items-center justify-between text-left text-sm font-medium text-muted hover:text-foreground"
          >
            <span>Rejected ({rejected.length})</span>
            <span className="text-xs">{rejectedOpen ? "Hide" : "Show"}</span>
          </button>
          {rejectedOpen && (
            <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-white">
              <table className="w-full min-w-[860px] text-left text-xs">
                <tbody>
                  {rejected.map((row) => (
                    <Row key={row.id} runId={runId} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
