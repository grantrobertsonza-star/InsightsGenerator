"use client";

import { useState, useTransition } from "react";
import { editStatedObjective } from "@/lib/runContextActions";

const miniBtn =
  "rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted transition hover:border-slate-400 hover:text-foreground disabled:opacity-50";

function Item({ runId, text }: { runId: string; text: string }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  return (
    <li className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border bg-white px-3 py-2">
      {editing ? (
        <textarea
          autoFocus
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-w-0 flex-1 resize-none rounded-lg border border-border px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      ) : (
        <span className="min-w-0 flex-1 text-sm text-foreground">{text}</span>
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
        {lines.map((l) => (
          <Item key={l} runId={runId} text={l} />
        ))}
      </ul>
    </div>
  );
}
