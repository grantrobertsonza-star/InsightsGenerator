"use client";

import SourceRemovedTag from "./SourceRemovedTag";
import { useState, useTransition } from "react";
import { attemptResult } from "./actionFailure";
import {
  addOwnObjectiveCandidate,
  regenerateObjectiveCandidates,
  acceptAllObjectiveCandidates,
  deleteSuggestedObjectives,
} from "@/lib/objectiveCandidateActions";
import { scoreObjectivesAction } from "@/lib/qualityActions";
import { TrashIcon } from "@/components/icons";
import { sameObjective, useObjectiveSelection } from "./ObjectiveSelection";
import { useObjectiveRowActions } from "./useObjectiveRowActions";
import ObjectiveEditConflict from "./ObjectiveEditConflict";
import { isRereadSuggestion } from "@/lib/briefFillText";
import { objectiveAccent, orderedObjectives, splitObjectiveLabel } from "./objectiveAccents";

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
  /** Why an objective has no score (objectiveQualityStatus.unscoredReasonText); absent where not loaded. */
  unscoredReason?: string | null;
  /**
   * For a suggestion from re-reading a document (Grant, 2026-10-22): the existing objective it most
   * likely restates (objectiveSimilarity.likelyRestates), shown beside it. Never merged.
   */
  similarTo?: string | null;
  /** When a file this objective was drawn from was removed to the bin (migration 0115). */
  sourceRemovedAt?: string | null;
};

export const scoreCellClass: Record<number, string> = {
  1: "bg-slate-100 text-slate-600",
  3: "bg-amber-50 text-amber-700",
  5: "bg-indigo-50 text-indigo-700",
};
export const tierClass = {
  strong: "bg-indigo-50 text-indigo-700",
  workable: "bg-amber-50 text-amber-700",
  weak: "bg-slate-100 text-slate-600",
} as const;
export const tierLabel = { strong: "Strong", workable: "Workable", weak: "Needs work" } as const;

export const COLUMNS: ["specific" | "measurable" | "answerable" | "relevant", string, string][] = [
  ["specific", "Specific", "Names who, which behaviour or attitude and in what context, so two researchers would read it the same way."],
  ["measurable", "Measurable", "Implies a clear measure or comparison, and what result would count as an answer."],
  ["answerable", "Answerable", "Judged against the documents, findings and variables uploaded when it was scored: does the data in hand speak to it?"],
  ["relevant", "Relevant", "Its answer would inform or change the decision (or the business problem, when there is no decision yet)."],
];

const btn =
  "whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:border-slate-400 hover:text-foreground disabled:opacity-60";
export const miniBtn =
  "rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted transition hover:border-slate-400 hover:text-foreground disabled:opacity-50";
export const textareaClass =
  "w-full resize-none rounded-lg border border-border px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

export function tagFor(row: ObjectiveRow) {
  // A researcher-authored objective that is pending (a re-read suggestion, or one unaccepted) is
  // not part of the agenda yet, so it is labelled as waiting rather than as stated.
  if (row.source === "researcher_authored" && row.status === "pending") return { label: "Waiting for review", cls: "bg-amber-50 text-amber-800" };
  if (row.source === "researcher_authored") return { label: "Stated", cls: "bg-slate-100 text-slate-600" };
  if (row.status === "accepted") return { label: "Inferred", cls: "bg-primary-light text-primary" };
  return { label: "Suggested", cls: "bg-amber-50 text-amber-700" };
}

function Row({ runId, row, position }: { runId: string; row: ObjectiveRow; position?: number }) {
  const a = useObjectiveRowActions(runId, row);
  const tag = tagFor(row);
  // Rolled up, the row shows only scores, so it carries the objective's colour from the left list and
  // its short name (the label before a colon, or the opening words) to say which objective it is.
  const accent = position === undefined ? null : objectiveAccent(position);
  const { label, body } = splitObjectiveLabel(row.text);
  const { selected, select } = useObjectiveSelection();
  // Rolled up by default (Grant, 2026-10-20): only the scores row shows; rolling down shows the full
  // wording, "To sharpen it" and any rationale across the row. Editing always shows it. The wording
  // stays in the page while rolled up (hidden), so search and assistive tools still find it.
  const [open, setOpen] = useState(false);
  const full = open || a.editing;

  return (
    // One objective is two rows in its own <tbody> (Grant, 2026-10-20): the tags, scores, rating and
    // actions on top, aligned with the headings, and the wording with "To sharpen it" across the full
    // width below, so long text is not squeezed into the first column.
    <tbody
      data-objective-row
      onClick={() => { if (!a.editing && a.accepted) select({ id: row.id, text: row.text }); }}
      className={`border-b border-border last:border-0 ${a.accepted ? "cursor-pointer" : ""} ${sameObjective(selected, { id: row.id, text: row.text }) ? "bg-primary-light/40" : ""} ${a.rejected ? "opacity-50" : ""}`}
    >
    <tr className="align-top">
      <td className={`whitespace-nowrap px-3 py-2 text-foreground ${accent ? `border-l-4 ${accent.bar}` : ""}`} data-objective-accent={position ?? undefined}>
        <button
          type="button"
          aria-expanded={full}
          aria-label={full ? "Roll up this objective" : "Roll down this objective"}
          title={full ? "Roll up" : "Roll down"}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((o) => !o);
          }}
          disabled={a.editing}
          className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-slate-100 hover:text-foreground"
          data-testid="objective-roll"
        >
          {full ? "▾" : "▸"}
        </button>
        <span className={`mr-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tag.cls}`}>
          {tag.label}
        </span>
        {row.edited && (
          <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Edited
          </span>
        )}
        <SourceRemovedTag removedAt={row.sourceRemovedAt} />
        {row.similarTo && (
          // Shown while rolled up too, so a likely repeat is seen without opening each suggestion;
          // rolling down names the objective it looks like.
          <span
            className="ml-1.5 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800"
            title={`Looks like: ${row.similarTo}`}
            data-testid="objective-similar-chip"
          >
            Looks like one you have
          </span>
        )}
        {!full && (
          <span
            className={`mt-1 block max-w-[15rem] truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${accent ? accent.chip : "bg-slate-100 text-slate-700"}`}
            title={row.text}
            data-testid="objective-row-name"
          >
            {label ?? body}
          </span>
        )}
      </td>
      {COLUMNS.map(([key]) => {
        const v = row.scores ? row.scores[key] : null;
        return (
          <td key={key} className="px-2 py-2 text-center">
            {v === null ? (
              <span className="text-muted">-</span>
            ) : (
              <span className={`inline-block min-w-6 rounded px-1.5 py-0.5 text-[10px] font-semibold ${scoreCellClass[v] ?? scoreCellClass[1]}`}>{v}</span>
            )}
          </td>
        );
      })}
      <td className="px-2 py-2 text-center font-semibold text-foreground">{row.scores ? `${row.scores.total}/20` : "-"}</td>
      <td className="px-3 py-2">
        {row.scores ? (
          <span
            title={row.scores.rationale}
            className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tierClass[row.scores.tier]}`}
          >
            {tierLabel[row.scores.tier]}
          </span>
        ) : (
          <span className="text-muted" title={row.unscoredReason ?? undefined} data-testid="objective-not-scored">Not scored</span>
        )}
      </td>
      <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
        {/* Row selection must not replace this editor while a status/edit action is clicked. One line,
            so the actions never stretch the scores row. */}
        <div className="flex flex-nowrap items-center gap-1 whitespace-nowrap">
          {a.editing ? (
            <>
              <button className={miniBtn} disabled={a.isPending || !a.draft.trim()} onClick={a.save}>
                Save
              </button>
              <button className={miniBtn} onClick={a.cancelEdit}>
                Cancel
              </button>
            </>
          ) : a.rejected ? (
            <button className={miniBtn} disabled={a.isPending} onClick={a.restore}>
              Restore
            </button>
          ) : (
            <>
              {!a.accepted && (
                <button className={miniBtn} disabled={a.isPending} onClick={a.accept}>
                  Accept
                </button>
              )}
              <button className={miniBtn} disabled={a.isPending} onClick={a.beginEdit}>
                Edit
              </button>
              {a.accepted ? (
                <button className={miniBtn} disabled={a.isPending} onClick={a.unaccept}>
                  Unaccept
                </button>
              ) : (
                <button className={miniBtn} disabled={a.isPending} onClick={a.reject}>
                  Reject
                </button>
              )}
            </>
          )}
          <button
            aria-label="Delete objective"
            title="Delete objective"
            disabled={a.isPending}
            onClick={a.remove}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition hover:bg-danger-light hover:text-danger"
          >
            <TrashIcon className="h-3 w-3" />
          </button>
        </div>
        {a.error && (
          <p role="alert" className="mt-1 max-w-xs text-[11px] text-red-700">
            {a.error}
          </p>
        )}
        {a.editing && a.conflict && (
          <ObjectiveEditConflict currentText={a.currentText} pending={a.isPending} onUseCurrent={a.useCurrentWording} onReplace={a.replaceCurrentWording} buttonClass={miniBtn} />
        )}
      </td>
    </tr>
    <tr className={full ? "" : "hidden"}>
      <td colSpan={COLUMNS.length + 4} className="px-3 pb-3 pt-1 text-foreground">
        {a.editing ? (
          <textarea autoFocus rows={2} value={a.draft} onChange={(e) => a.setDraft(e.target.value)} onClick={(event) => event.stopPropagation()} className={textareaClass} />
        ) : (
          <div className="text-xs leading-relaxed">{row.text}</div>
        )}
        {row.scores?.suggestion && !a.editing && (
          <div className="mt-1 text-[11px] leading-relaxed text-muted">
            <span className="font-medium">To sharpen it:</span> {row.scores.suggestion}
          </div>
        )}
        {(row.source === "ai_suggested" || isRereadSuggestion(row.rationale)) && row.rationale && !a.editing && (
          <div className="mt-1 text-[11px] text-muted">{row.rationale}</div>
        )}
        {row.similarTo && !a.editing && (
          <div className="mt-1 text-[11px] text-amber-800" data-testid="objective-similar-to">
            Looks like an objective you already have: <span className="font-medium">{row.similarTo}</span>. Accept this one, or reject it to keep yours.
          </div>
        )}
      </td>
    </tr>
    </tbody>
  );
}

/**
 * One table for every objective: stated, inferred and suggested, each with
 * its quality score and row actions. Scores are shown here; they are worked out automatically
 * whenever objectives are saved, on Set objectives or here (objectiveQualityScorer.ts), and
 * "Answerable" is judged against the data uploaded at that time, so Rescore refreshes it.
 */
export default function ObjectiveReviewTable({
  runId,
  rows,
  hasFindings,
  missingMigration,
  positions,
}: {
  runId: string;
  rows: ObjectiveRow[];
  hasFindings: boolean;
  missingMigration: boolean;
  /** Each objective's place in the left list (objectiveListPositions), for its colour. */
  positions?: Record<string, number>;
}) {
  const [isPending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addText, setAddText] = useState("");
  const [rejectedOpen, setRejectedOpen] = useState(false);

  const active = orderedObjectives(rows);
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
  // Table-level actions report failure in `error`; adding your own objective keeps the typed
  // text when the add fails (actionFailure.ts).
  function runAction(action: () => Promise<unknown>, after?: () => void) {
    setError(null);
    start(async () => {
      const failure = await attemptResult(action);
      if (failure) setError(failure);
      else after?.();
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
            <button className={btn} disabled={isPending} onClick={() => runAction(() => acceptAllObjectiveCandidates(runId))}>
              Accept all suggested
            </button>
          )}
          {hasAi && (
            <button
              className={btn}
              disabled={isPending}
              onClick={() => {
                if (!confirm("Remove all suggested objectives? Your own and edited ones are kept.")) return;
                runAction(() => deleteSuggestedObjectives(runId));
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
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-danger bg-danger-light px-3 py-2 text-xs text-danger">
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
          <table className="w-full min-w-[640px] text-left text-[11px]">
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
            {active.map((row) => (
              <Row key={row.id} runId={runId} row={row} position={positions?.[row.id]} />
            ))}
          </table>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = addText.trim();
          if (!text) return;
          runAction(() => addOwnObjectiveCandidate(runId, text), () => setAddText(""));
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
              <table className="w-full min-w-[640px] text-left text-[11px]">
                {rejected.map((row) => (
                  <Row key={row.id} runId={runId} row={row} position={positions?.[row.id]} />
                ))}
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
