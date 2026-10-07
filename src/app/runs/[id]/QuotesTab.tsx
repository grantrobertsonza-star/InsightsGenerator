"use client";

import { useMemo, useState } from "react";
import type { CodingAnalysisView } from "@/lib/codingAnalysis";
import {
  addResearcherCodeAction,
  changeTurnCodeAction,
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
              {c.number}. {c.name}
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
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-slate-50 px-2 py-0.5 text-[11px] text-foreground"
                    >
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
              {open && (
                <div className="mt-2 space-y-2 rounded-md bg-slate-50 p-2">
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
