"use client";

import SourceRemovedTag from "./SourceRemovedTag";
import { type ReactNode } from "react";
import {
  COLUMNS,
  miniBtn,
  scoreCellClass,
  tagFor,
  textareaClass,
  tierClass,
  tierLabel,
  type ObjectiveRow,
} from "./ObjectiveReviewTable";
import { sameObjective, useObjectiveSelection } from "./ObjectiveSelection";
import { objectiveAccent, orderedObjectives } from "./objectiveAccents";
import { useObjectiveRowActions } from "./useObjectiveRowActions";
import ObjectiveEditConflict from "./ObjectiveEditConflict";
import { isRereadSuggestion } from "@/lib/briefFillText";

/** `candidateId` (CE-1) matches the verdict to its objective by id; `stale` marks coverage not known to be current. */
type Verdict = { item_text: string; status: "resolved" | "partial" | "gap"; inferred: boolean; candidateId?: string | null; stale?: boolean };

const verdictLabel = { resolved: "Answered", partial: "Partly answered", gap: "Gap" } as const;
const verdictStyle = {
  resolved: "bg-green-50 text-green-800",
  partial: "bg-amber-50 text-amber-800",
  gap: "bg-red-50 text-red-800",
} as const;

/** An objective's review chips: its label, quality tier and score, and whether the evidence answers it. */
export function ObjectiveBadges({ row, verdicts, withTag = true }: { row: ObjectiveRow; verdicts: Verdict[]; withTag?: boolean }) {
  const tag = tagFor(row);
  const v =
    verdicts.find((x) => !x.inferred && sameObjective({ id: row.id, text: row.text }, { id: x.candidateId ?? null, text: x.item_text })) ??
    verdicts.find((x) => sameObjective({ id: row.id, text: row.text }, { id: x.candidateId ?? null, text: x.item_text }));
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1" data-testid="objective-badges">
      {withTag && <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${tag.cls}`}>{tag.label}</span>}
      {row.scores && (
        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tierClass[row.scores.tier]}`}>
          {tierLabel[row.scores.tier]} {row.scores.total}/20
        </span>
      )}
      {v && !v.inferred && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${verdictStyle[v.status]}${v.stale ? " opacity-70 ring-1 ring-dashed ring-amber-400" : ""}`}
          title={v.stale ? "Not current: the evidence check is out of date, or what it cites is no longer supported (B37-F01). See the coverage note; update coverage." : undefined}
          data-stale={v.stale ? "true" : undefined}
        >
          {verdictLabel[v.status]}
          {v.stale ? " (not current)" : ""}
        </span>
      )}
    </span>
  );
}

/**
 * Left pane: every objective, with its quality tier and whether the evidence answers it. `startAt`
 * continues the numbering and colours after the stated objectives listed above it on the one-page
 * Objectives prototype; `empty` is what to say when there is nothing to list (null: say nothing).
 */
export function ObjectiveList({
  rows,
  verdicts,
  startAt = 0,
  empty = "No objectives yet. Add them under Objective and context.",
}: {
  rows: ObjectiveRow[];
  verdicts: Verdict[];
  startAt?: number;
  empty?: string | null;
}) {
  const { selected, select } = useObjectiveSelection();
  const list = orderedObjectives(rows);
  if (list.length === 0) {
    return empty ? <p className="text-xs text-muted">{empty}</p> : null;
  }
  return (
    <ul className="space-y-1.5">
      {list.map((r, i) => {
        const n = i + startAt;
        const tag = tagFor(r);
        const v =
          verdicts.find((x) => !x.inferred && sameObjective({ id: r.id, text: r.text }, { text: x.item_text })) ??
          verdicts.find((x) => sameObjective({ id: r.id, text: r.text }, { text: x.item_text }));
        const isSel = sameObjective(selected, { id: r.id, text: r.text });
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => select({ id: r.id, text: r.text })}
              className={`w-full rounded-lg border border-l-4 px-2.5 py-2 text-left transition ${objectiveAccent(n).bar} ${objectiveAccent(n).tint} ${
                isSel ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-slate-400"
              }`}
            >
              <span className="flex items-start gap-2">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${objectiveAccent(n).chip}`}>{n + 1}</span>
                <span className="line-clamp-4 block text-xs text-foreground">{r.text}</span>
              </span>
              <span className="mt-1.5 flex flex-wrap items-center gap-1 pl-7">
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${tag.cls}`}>{tag.label}</span>
                {r.scores && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tierClass[r.scores.tier]}`}>
                    {tierLabel[r.scores.tier]} {r.scores.total}/20
                  </span>
                )}
                {v && !v.inferred && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${verdictStyle[v.status]}`}>{verdictLabel[v.status]}</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Detail({ runId, row, index }: { runId: string; row: ObjectiveRow; index: number }) {
  const accent = objectiveAccent(index);
  const { clear } = useObjectiveSelection();
  const a = useObjectiveRowActions(runId, row, clear);
  const tag = tagFor(row);
  return (
    <div className={`space-y-4 rounded-xl border border-l-4 border-border p-4 ${accent.bar} ${accent.tint}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${accent.chip}`}>{index + 1}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tag.cls}`}>{tag.label}</span>
          {row.edited && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Edited</span>}
          <SourceRemovedTag removedAt={row.sourceRemovedAt} />
          {row.scores && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tierClass[row.scores.tier]}`}>
              {tierLabel[row.scores.tier]} {row.scores.total}/20
            </span>
          )}
        </div>
        <button className="text-xs text-muted underline" onClick={clear}>
          All objectives
        </button>
      </div>

      {a.editing ? (
        <textarea autoFocus rows={3} value={a.draft} onChange={(e) => a.setDraft(e.target.value)} className={textareaClass} />
      ) : (
        <p className="text-sm font-medium text-foreground">{row.text}</p>
      )}
      {(row.source === "ai_suggested" || isRereadSuggestion(row.rationale)) && row.rationale && !a.editing && <p className="text-xs text-muted">{row.rationale}</p>}
      {(row.passages ?? []).map((p, i) => (
        <figure key={i} data-testid="objective-passage" data-verified={p.verified ? "true" : "false"} className={`rounded-lg border-l-2 bg-white/70 px-3 py-2 ${p.verified ? "border-fuchsia-400" : "border-amber-400"}`}>
          <blockquote className="text-xs italic text-foreground">&ldquo;{p.quote}&rdquo;</blockquote>
          <figcaption className={`mt-1 text-[11px] ${p.verified ? "text-muted" : "text-amber-800"}`}>{p.source}</figcaption>
        </figure>
      ))}
      {row.similarTo && !a.editing && (
        <p className="text-xs text-amber-800" data-testid="objective-similar-to">
          Looks like an objective you already have: <span className="font-medium">{row.similarTo}</span>. Accept this one, or reject it to keep yours.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
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
          <button className={miniBtn} disabled={a.isPending} onClick={a.restore}>Restore</button>
        ) : (
          <>
            {!a.accepted && <button className={miniBtn} disabled={a.isPending} onClick={a.accept}>Accept</button>}
            <button className={miniBtn} disabled={a.isPending} onClick={a.beginEdit}>Edit</button>
            {a.accepted ? (
              <button className={miniBtn} disabled={a.isPending} onClick={a.unaccept}>Unaccept</button>
            ) : (
              <button className={miniBtn} disabled={a.isPending} onClick={a.reject}>Reject</button>
            )}
            <button className={miniBtn} disabled={a.isPending} onClick={a.remove}>
              Delete
            </button>
          </>
        )}
      </div>
      {a.error && (
        <p role="alert" className="text-xs text-red-700">
          {a.error}
        </p>
      )}
        {a.editing && a.conflict && (
          <ObjectiveEditConflict currentText={a.currentText} pending={a.isPending} onUseCurrent={a.useCurrentWording} onReplace={a.replaceCurrentWording} buttonClass={miniBtn} />
        )}

      {row.scores ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {COLUMNS.map(([key, label, definition]) => {
              const v = row.scores![key];
              return (
                <div key={key} title={definition} className="rounded-lg border border-border p-2 text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
                  <span className={`mt-1 inline-block min-w-6 rounded px-1.5 py-0.5 text-xs font-semibold ${scoreCellClass[v] ?? scoreCellClass[1]}`}>{v}</span>
                </div>
              );
            })}
          </div>
          {row.scores.rationale && <p className="text-xs text-muted">{row.scores.rationale}</p>}
          {row.scores.suggestion && (
            <p className="text-xs text-muted">
              <span className="font-medium text-foreground">To sharpen it:</span> {row.scores.suggestion}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted" data-testid="objective-unscored-reason">
          {a.accepted ? (row.unscoredReason ?? "Not scored yet: it will be scored after your next change, or use Rescore.") : "Accept this objective to have it scored."}
        </p>
      )}
    </div>
  );
}

/** Middle pane: the selected objective in full, or the overview table when nothing is selected. */
export function ObjectiveMiddle({
  runId,
  rows,
  overview,
  positions,
}: {
  runId: string;
  rows: ObjectiveRow[];
  overview: ReactNode;
  /** Each objective's place in the left list (objectiveListPositions), so the detail keeps its colour and number. */
  positions?: Record<string, number>;
}) {
  const { selected } = useObjectiveSelection();
  const list = orderedObjectives(rows);
  const index = selected ? list.findIndex((r) => sameObjective(selected, { id: r.id, text: r.text })) : -1;
  const row = index >= 0 ? list[index] : undefined;
  if (row) return <Detail key={row.id} runId={runId} row={row} index={positions?.[row.id] ?? index} />;
  return <div className="min-w-0 shrink-0 overflow-x-auto">{overview}</div>;
}
