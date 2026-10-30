"use client";

import { useState } from "react";
import { deleteProgramAction, renameProgramAction } from "@/lib/programActions";

const btn = "rounded-md border border-border px-2 py-1 text-xs font-medium text-muted transition hover:border-slate-400 hover:text-foreground disabled:opacity-50";

/**
 * Rename and delete for one program (Grant, 27 October 2026). Delete asks once, in place, and says what
 * it does: the projects are unlinked and kept. Nothing reads as done before the server says so.
 */
export default function ProgramControls({ programId, name, projects }: { programId: string; name: string; projects: number }) {
  const [mode, setMode] = useState<"idle" | "rename" | "delete">("idle");
  const [draft, setDraft] = useState(name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setPending(true);
    setError(null);
    try {
      const r = await action();
      if (r.ok) setMode("idle");
      else setError(r.error ?? "Not saved. Try again.");
    } catch {
      setError("The connection to the server was interrupted. Nothing may have changed; reload to see.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="ml-auto flex flex-col items-end gap-1" data-testid="program-controls">
      {mode === "idle" && (
        <div className="flex gap-2">
          <button type="button" className={btn} onClick={() => { setDraft(name); setMode("rename"); }}>Rename</button>
          <button type="button" className={btn} onClick={() => setMode("delete")}>Delete</button>
        </div>
      )}
      {mode === "rename" && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => renameProgramAction(programId, draft)); }}>
          <input aria-label="Program name" value={draft} onChange={(e) => setDraft(e.target.value)} className="rounded-md border border-border px-2 py-1 text-xs" autoFocus />
          <button type="submit" disabled={pending || !draft.trim()} className={btn}>{pending ? "Saving..." : "Save"}</button>
          <button type="button" disabled={pending} className={btn} onClick={() => setMode("idle")}>Cancel</button>
        </form>
      )}
      {mode === "delete" && (
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs" role="group" aria-label="Confirm delete">
          <span className="text-foreground">
            Delete this program?{" "}
            {projects > 0 ? `Its ${projects} ${projects === 1 ? "project is" : "projects are"} unlinked and kept, with all their data.` : "It has no projects."}
          </span>
          <button type="button" disabled={pending} className={`${btn} border-red-300 text-red-700`} onClick={() => void run(() => deleteProgramAction(programId))}>{pending ? "Deleting..." : "Delete program"}</button>
          <button type="button" disabled={pending} className={btn} onClick={() => setMode("idle")}>Cancel</button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
