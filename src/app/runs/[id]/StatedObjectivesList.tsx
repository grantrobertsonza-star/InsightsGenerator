"use client";

import { useState, useTransition } from "react";
import { editStatedObjective } from "@/lib/runContextActions";

const miniBtn =
  "rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted transition hover:border-slate-400 hover:text-foreground disabled:opacity-50";

const ACCENTS = [
  { border: "border-l-indigo-400", tint: "bg-indigo-50/40", chip: "bg-indigo-100 text-indigo-800" },
  { border: "border-l-emerald-400", tint: "bg-emerald-50/40", chip: "bg-emerald-100 text-emerald-800" },
  { border: "border-l-amber-400", tint: "bg-amber-50/40", chip: "bg-amber-100 text-amber-800" },
  { border: "border-l-sky-400", tint: "bg-sky-50/40", chip: "bg-sky-100 text-sky-800" },
  { border: "border-l-rose-400", tint: "bg-rose-50/40", chip: "bg-rose-100 text-rose-800" },
  { border: "border-l-violet-400", tint: "bg-violet-50/40", chip: "bg-violet-100 text-violet-800" },
];

/** Splits "Label: text" or "Label - text" into a short label and the rest. No label if the line has none. */
function splitLabel(text: string): { label: string | null; body: string } {
  const m = text.match(/^(.{3,48}?)\s*(?::|\s[-\u2013\u2014]\s)\s*([\s\S]+)$/);
  if (m && m[1].split(/\s+/).length <= 6) return { label: m[1].trim(), body: m[2].trim() };
  return { label: null, body: text };
}

function Item({ runId, text, index }: { runId: string; text: string; index: number }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const accent = ACCENTS[index % ACCENTS.length];
  const { label, body } = splitLabel(text);

  return (
    <li className={`flex flex-wrap items-start justify-between gap-2 rounded-lg border border-l-4 border-border px-3 py-2.5 shadow-sm ${accent.tint} ${accent.border}`}>
      {editing ? (
        <textarea
          autoFocus
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-w-0 flex-1 resize-none rounded-lg border border-border px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      ) : (
        <div className="min-w-0 flex-1">
          {label && (
            <span className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${accent.chip}`}>
              {label}
            </span>
          )}
          <p className="text-sm text-foreground">{body}</p>
        </div>
      )}
      <div className="flex shrink-0 gap-1.5">
        {editing ? (
          <>
            <button
              className={miniBtn}
              disabled={pending || !draft.trim()}
              onClick={() =>
                start(async () => {
                  await editStatedObjective(runId, text, draft);
                  setEditing(false);
                })
              }
            >
              Save
            </button>
            <button
              className={miniBtn}
              onClick={() => {
                setDraft(text);
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
                  await editStatedObjective(runId, text, null);
                });
              }}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export default function StatedObjectivesList({ runId, lines }: { runId: string; lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="max-w-3xl">
      <h3 className="mb-2 text-sm font-semibold text-foreground">Your objectives</h3>
      <ul className="space-y-2">
        {lines.map((l, i) => (
          <Item key={l} runId={runId} text={l} index={i} />
        ))}
      </ul>
    </div>
  );
}
