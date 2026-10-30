"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CodingAnalysisView } from "@/lib/codingAnalysis";
import { SET_ASIDE_REASON } from "@/lib/setAsideNotes";
import {
  addResearcherCodeAction,
  attachOrphanTurnNoteAction,
  changeTurnCodeAction,
  clearOrphanTurnNoteAction,
  saveTurnNoteAction,
  type ActionResult,
} from "@/lib/codingAnalysisActions";

const select =
  "rounded-md border border-border bg-white px-2 py-1 text-xs text-foreground";

type Verbatim = CodingAnalysisView["verbatims"][number];

/**
 * The trail from a theme to what people said: every participant turn with the
 * themes it carries, ready to copy as a quote. Themes are applied to whole
 * turns, so a quote may need trimming to the sentence that makes the point.
 * A researcher can overrule the model here: remove a theme, add another, or
 * create a new one. Those changes are marked as yours and survive a re-apply.
 */
export default function QuotesTab({
  runId,
  view,
  run,
  busy,
}: {
  runId: string;
  view: CodingAnalysisView;
  run: (fn: () => Promise<ActionResult>) => void;
  busy: boolean;
}) {
  const [codeId, setCodeId] = useState<string>("__all");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDef, setNewDef] = useState("");
  // Note drafts by turn. A turn not in here shows the saved note.
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const nameOf = useMemo(
    () => new Map(view.codes.map((c) => [c.id, c.name])),
    [view.codes],
  );
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return view.verbatims
      .filter((v) =>
        codeId === "__all"
          ? true
          : codeId === "__none"
            ? v.codeIds.length === 0
            : v.codeIds.includes(codeId),
      )
      .filter(
        (v) =>
          !q ||
          v.text.toLowerCase().includes(q) ||
          (v.speaker ?? "").toLowerCase().includes(q),
      );
  }, [view.verbatims, codeId, query]);

  function citation(v: Verbatim) {
    const who = v.speaker ?? "Unlabelled";
    const where = [v.page ? `p. ${v.page}` : null, `turn ${v.index + 1}`]
      .filter(Boolean)
      .join(", ");
    return `"${v.text.trim()}" (${who}, ${where})`;
  }

  async function copy(v: Verbatim) {
    try {
      await navigator.clipboard.writeText(citation(v));
      setCopied(v.segmentId);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard blocked: the text is still on screen to select
    }
  }

  const change = (v: Verbatim, id: string, action: "add" | "remove") =>
    run(() =>
      changeTurnCodeAction(runId, view.documentId, v.segmentId, id, action),
    );

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted">
        Every participant turn, word for word, with the themes it carries. A
        theme is applied to the whole turn, so trim to the sentence that makes
        your point before using it as an example. Use Change themes to overrule
        the model. Your changes are marked as yours, appear in the export, and
        stay when you re-apply the codebook.
      </p>
      <p className="text-[11px] text-muted">
        {view.verbatims.length} participant turn
        {view.verbatims.length === 1 ? "" : "s"} loaded,{" "}
        {view.verbatims.filter((v) => v.codeIds.length > 0).length} with at
        least one theme.
        {view.verbatims.length === 0 &&
          " Nothing was loaded for this transcript. Reload the page, and if it stays empty tell me what the Counts tab shows."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={select}
          value={codeId}
          onChange={(e) => setCodeId(e.target.value)}
          aria-label="Theme"
        >
          <option value="__all">All turns</option>
          <option value="__none">Turns with no theme</option>
          {view.codes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.number}. {c.theme ? `${c.theme} > ` : ""}
              {c.name}
            </option>
          ))}
        </select>
        <input
          className={`${select} w-56`}
          placeholder="Search words or speaker"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-[11px] text-muted">
          {rows.length} turn{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      {view.turnNotesError && <NotesUnreadAlert message={view.turnNotesError} />}
      <OrphanTurnNotes runId={runId} view={view} run={run} busy={busy} />
      <ul className="max-h-[32rem] space-y-2 overflow-y-auto">
        {rows.slice(0, 200).map((v) => {
          const open = editing === v.segmentId;
          const addable = view.codes.filter((c) => !v.codeIds.includes(c.id));
          return (
            <li
              key={v.segmentId}
              className="rounded-lg border border-border bg-white p-2"
            >
              <p className="text-xs text-foreground">
                &ldquo;{v.text.trim()}&rdquo;
              </p>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                <span>
                  {v.speaker ?? "Unlabelled"}
                  {v.page ? `, p. ${v.page}` : ""}, turn {v.index + 1}
                </span>
                <span className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setEditing(open ? null : v.segmentId)}
                    className="font-medium text-primary underline"
                  >
                    {open ? "Done" : "Change themes"}
                  </button>
                  <button
                    type="button"
                    onClick={() => copy(v)}
                    className="font-medium text-primary underline"
                  >
                    {copied === v.segmentId ? "Copied" : "Copy with source"}
                  </button>
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {v.codeIds.length === 0 && (
                  <span className="text-[11px] text-muted">No theme</span>
                )}
                {v.codeIds.map((id) => {
                  const mine = v.researcherCodeIds.includes(id);
                  const themeOf = view.codes.find((c) => c.id === id)?.theme;
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-slate-50 px-2 py-0.5 text-[11px] text-foreground"
                    >
                      {themeOf ? `${themeOf} > ` : ""}
                      {nameOf.get(id) ?? ""}
                      {mine && <span className="text-purple-700">(you)</span>}
                      {open && (
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`Remove ${nameOf.get(id) ?? "theme"}`}
                          onClick={() => change(v, id, "remove")}
                          className="font-bold text-danger"
                        >
                          x
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
              {v.note && !open && (
                <p className="mt-1 text-[11px] italic text-muted">
                  Your note: {v.note}
                </p>
              )}
              {open && (
                <div className="mt-2 space-y-2 rounded-md bg-slate-50 p-2">
                  {view.turnNotesError ? (
                    <p className="text-[11px] text-muted">
                      Notes cannot be edited until they can be read again, so a note you cannot see is never replaced.
                    </p>
                  ) : (
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-foreground">
                      Your note on this turn
                    </p>
                    <textarea
                      className={`${select} w-full`}
                      rows={2}
                      placeholder="An analytical note, kept with the quote and included in the exports"
                      value={noteDrafts[v.segmentId] ?? v.note}
                      onChange={(e) =>
                        setNoteDrafts((d) => ({
                          ...d,
                          [v.segmentId]: e.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      disabled={
                        busy ||
                        (noteDrafts[v.segmentId] ?? v.note) === v.note
                      }
                      onClick={() =>
                        run(() =>
                          saveTurnNoteAction(
                            runId,
                            view.documentId,
                            v.index,
                            noteDrafts[v.segmentId] ?? "",
                            // Saved only while the turn still says what is shown here (COD5K-F02).
                            v.text,
                          ),
                        )
                      }
                      className="rounded-lg border border-border bg-white px-2.5 py-1 text-xs font-medium text-foreground disabled:opacity-50"
                    >
                      Save note
                    </button>
                  </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className={select}
                      defaultValue=""
                      disabled={busy || addable.length === 0}
                      onChange={(e) => {
                        if (e.target.value) change(v, e.target.value, "add");
                        e.target.value = "";
                      }}
                      aria-label="Add a theme to this turn"
                    >
                      <option value="">Add an existing theme...</option>
                      {addable.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.number}. {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-foreground">
                      Or create a new theme and put it on this turn
                    </p>
                    <input
                      className={`${select} w-full`}
                      placeholder="Theme name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                    <textarea
                      className={`${select} w-full`}
                      rows={2}
                      placeholder="Definition: what counts as this theme"
                      value={newDef}
                      onChange={(e) => setNewDef(e.target.value)}
                    />
                    <button
                      type="button"
                      disabled={busy || !newName.trim() || !newDef.trim()}
                      onClick={() => {
                        run(() =>
                          addResearcherCodeAction(
                            runId,
                            view.documentId,
                            view.codebookId,
                            newName,
                            newDef,
                            v.segmentId,
                          ),
                        );
                        setNewName("");
                        setNewDef("");
                      }}
                      className="rounded-lg bg-purple-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                    >
                      Create theme and apply to this turn
                    </button>
                    <p className="text-[11px] text-muted">
                      A new theme sits on this turn only until you re-apply the
                      codebook, which lets the model look for it in the rest of
                      the transcript.
                    </p>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="text-[11px] text-muted">No turns match.</li>
        )}
        {rows.length > 200 && (
          <li className="text-[11px] text-muted">
            Showing the first 200. Search or pick a theme to narrow the list.
          </li>
        )}
      </ul>
    </div>
  );
}


/**
 * COD5K-F02: notes whose turn is gone or changed since they were written (the transcript was read
 * again). The wording is shown verbatim and is never attached to the turn now at the old number by
 * itself; the researcher attaches it to a turn they choose, or removes it.
 */
export function OrphanTurnNotes({
  runId,
  view,
  run,
  busy,
}: {
  runId: string;
  view: CodingAnalysisView;
  run: (fn: () => Promise<ActionResult>) => void;
  busy: boolean;
}) {
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  if (view.orphanNotes === null)
    return <NotesUnreadAlert message="Notes set aside from changed turns could not be read. None has been removed; try again." />;
  if (view.orphanNotes.length === 0) return null;
  return (
    <section aria-label="Notes from changed turns" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-2">
      <p className="text-[11px] text-amber-900">
        {view.orphanNotes.length} of your notes no longer match their turn, because the transcript was
        read again. They are kept word for word and are not shown on any turn until you attach them.
      </p>
      <ul className="space-y-2">
        {view.orphanNotes.map((o) => {
          const typed = targets[o.ref] ?? String(o.formerIndex + 1);
          const number = Number(typed);
          const target = Number.isInteger(number)
            ? view.verbatims.find((v) => v.index === number - 1)
            : undefined;
          return (
            <li key={o.ref} className="rounded-md border border-border bg-white p-2 text-[11px]">
              <p className="italic text-foreground">&ldquo;{o.note}&rdquo;</p>
              <p className="mt-1 text-muted">
                Written on turn {o.formerIndex + 1}; {SET_ASIDE_REASON[o.reason]}.
              </p>
              <p className="mt-1 text-muted">
                {o.turnText !== null
                  ? <>That turn said: &ldquo;{o.turnText.trim()}&rdquo;</>
                  : "The words of that turn were not kept."}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1">
                  Attach to turn
                  <input
                    className={`${select} w-16`}
                    inputMode="numeric"
                    value={typed}
                    onChange={(e) => setTargets((t) => ({ ...t, [o.ref]: e.target.value }))}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !target}
                  onClick={() =>
                    target &&
                    run(() =>
                      attachOrphanTurnNoteAction(runId, view.documentId, o.ref, target.index, target.text),
                    )
                  }
                  className="rounded-lg border border-border bg-white px-2 py-0.5 font-medium text-foreground disabled:opacity-50"
                >
                  Attach
                </button>
                {confirming === o.ref ? (
                  <>
                    <span className="text-foreground">Remove this note for good?</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setConfirming(null);
                        run(() => clearOrphanTurnNoteAction(runId, view.documentId, o.ref));
                      }}
                      className="font-medium text-danger"
                    >
                      Remove
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className="text-muted">
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirming(o.ref)}
                    className="text-danger"
                  >
                    Remove...
                  </button>
                )}
              </div>
              {target ? (
                <p className="mt-1 text-muted">
                  Turn {target.index + 1} now says: &ldquo;{target.text.trim().slice(0, 160)}
                  {target.text.trim().length > 160 ? "..." : ""}&rdquo;
                </p>
              ) : (
                <p className="mt-1 text-muted">There is no participant turn {typed} to attach it to.</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A failed read of the researcher's notes, said plainly with a way to read them again (a refresh of
 * the server view), so it is never mistaken for a transcript without notes. */
function NotesUnreadAlert({ message }: { message: string }) {
  const router = useRouter();
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
      <span>{message}</span>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="rounded-lg border border-amber-400 bg-white px-2 py-0.5 font-medium"
      >
        Try again
      </button>
    </div>
  );
}
