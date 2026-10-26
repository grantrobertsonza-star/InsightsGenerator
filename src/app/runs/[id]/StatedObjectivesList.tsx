"use client";

import { useState, useTransition, type ReactNode } from "react";
import { saveStatedObjectiveEdit } from "@/lib/runContextActions";
import { sameObjective, useObjectiveSelection } from "./ObjectiveSelection";
import { objectiveAccent, splitObjectiveLabel } from "./objectiveAccents";

const miniBtn =
  "rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted transition hover:border-slate-400 hover:text-foreground disabled:opacity-50";

function Item({ runId, text, index, source, candidateId, badges }: { runId: string; text: string; index: number; source: string | null; candidateId: string | null; badges: ReactNode }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  // A failed save keeps the editor (and the draft) open and says why; nothing is shown as saved
  // until the server confirms it.
  const [error, setError] = useState<string | null>(null);
  const accent = objectiveAccent(index);
  const { label, body } = splitObjectiveLabel(text);
  const { selected, select } = useObjectiveSelection();
  const isHeading = text.trim().endsWith(":");
  const isSel = sameObjective(selected, { text });

  return (
    <li
      className={`flex flex-wrap items-start justify-between gap-2 rounded-lg border border-l-4 border-border px-3 py-2.5 shadow-sm ${isSel ? "ring-2 ring-primary/60" : ""} ${accent.softTint} ${accent.bar}`}
    >
      {editing ? (
        <textarea
          autoFocus
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-w-0 flex-1 resize-none rounded-lg border border-border px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      ) : (
        // The objective's text is the button that opens it in the detail pane, so it can be chosen
        // from the keyboard as well as with a click; a heading line is not an objective.
        <button
          type="button"
          disabled={isHeading}
          aria-pressed={isSel}
          onClick={() => select({ id: null, text })}
          className="min-w-0 flex-1 text-left disabled:cursor-default"
        >
          {label && (
            <span className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${accent.chip}`}>
              {label}
            </span>
          )}
          {/* Spans, not paragraphs: a button may hold only phrasing content. */}
          <span className="block text-sm text-foreground">{body}</span>
          {source && (
            <span className="mt-0.5 block text-[11px] text-slate-500" data-testid="objective-source">
              {`From ${source}`}
            </span>
          )}
          {badges}
        </button>
      )}
      <div className="flex shrink-0 gap-1.5">
        {editing ? (
          <>
            <button
              className={miniBtn}
              disabled={pending || !draft.trim()}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const result = await saveStatedObjectiveEdit(runId, text, draft, { candidateId });
                  if (result.ok) setEditing(false);
                  else setError(`Not saved: ${result.error}`);
                })
              }
            >
              Save
            </button>
            <button
              className={miniBtn}
              onClick={() => {
                setDraft(text);
                setError(null);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className={miniBtn} disabled={pending} onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              className={miniBtn}
              disabled={pending}
              onClick={() => {
                if (!confirm("Delete this objective?")) return;
                start(async () => {
                  setError(null);
                  const result = await saveStatedObjectiveEdit(runId, text, null, { candidateId });
                  if (!result.ok) setError(`Not deleted: ${result.error}`);
                });
              }}
            >
              Delete
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="w-full text-xs text-red-700">
          {error}
        </p>
      )}
    </li>
  );
}

export default function StatedObjectivesList({
  runId,
  lines,
  candidateIds,
  sources,
  badges,
}: {
  runId: string;
  lines: string[];
  /**
   * Per line, the candidate it stands for (setupLineCandidateIds), or null for a Setup-only line.
   * An edit or delete is bound to it, so a stale editor never changes a record it was not opened
   * on (R500-02).
   */
  candidateIds: (string | null)[];
  /** Per line, the brief or proposal it was added from ("the proposal X.docx"), or null (briefFillRecord). */
  sources?: (string | null)[];
  /** Per line, its review badges (tier, score, evidence verdict) on the one-page Objectives prototype. */
  badges?: ReactNode[];
}) {
  if (lines.length === 0) return null;
  return (
    <div>
      <ul className="space-y-2" data-testid="stated-objectives">
        {lines.map((l, i) => (
          <Item key={`${candidateIds[i] ?? "line"}:${l}`} runId={runId} text={l} index={i} source={sources?.[i] ?? null} candidateId={candidateIds[i] ?? null} badges={badges?.[i] ?? null} />
        ))}
      </ul>
    </div>
  );
}
