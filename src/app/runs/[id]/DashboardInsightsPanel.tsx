"use client";

// R5story: "AI insights" for one brand tracking dashboard page (Grant, 30 October 2026). The button opens a side
// panel listing up to five short insights the model drafted from ONLY this page's computed figures; the app checked
// every number against the page's figures and refused causal and significance claims before any is shown
// (src/lib/dashboardInsights.ts). Each insight is "AI draft" until the researcher accepts, edits or discards it; an
// accepted one can be posted as a finding.
//
// Screen rules: loading, failure and retry are shown; a late answer (an earlier request, or another page after the
// researcher moved on) never replaces a newer one, here and on the server; "Saved" appears only after the server
// saved; a conflicting save shows the current version and keeps the researcher's wording in the box.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { decideDraftAction, editDraftAction, generatePageInsightsAction, loadPageInsightsAction, postInsightAsFindingAction } from "@/lib/trackerDashboardStoryActions";
import type { AiDraft } from "@/lib/dashboardInsights";
import { useDashboardStory } from "./DashboardFindingButton";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; drafts: AiDraft[] };

const STATUS_BADGE: Record<AiDraft["status"], { text: string; cls: string }> = {
  draft: { text: "AI draft", cls: "border-amber-300 bg-amber-50 text-amber-900" },
  accepted: { text: "Accepted", cls: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  discarded: { text: "Discarded", cls: "border-slate-300 bg-slate-50 text-slate-600" },
  refused: { text: "Refused by the figure check", cls: "border-red-300 bg-red-50 text-red-800" },
};

/** One drafted text with its decisions: shared by page insights and the export's summary and conclusions. */
export function AiDraftItem({ draft, onChanged, canPost }: { draft: AiDraft; onChanged: (d: AiDraft | null) => void; canPost?: boolean }) {
  const story = useDashboardStory();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(draft.text);
  const [busy, setBusy] = useState<null | "accept" | "discard" | "reopen" | "save" | "post">(null);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const badge = STATUS_BADGE[draft.status];

  async function decide(action: "accept" | "discard" | "reopen") {
    setBusy(action);
    setMessage(null);
    const r = await decideDraftAction(story.runId, story.documentId, draft.id, action, draft.revision);
    setBusy(null);
    if (!r.ok) {
      setMessage({ tone: "error", text: r.error });
      if (r.conflict) onChanged(null);
      return;
    }
    onChanged(r.draft);
  }
  async function save() {
    setBusy("save");
    setMessage(null);
    const r = await editDraftAction(story.runId, story.documentId, draft.id, text, draft.revision);
    setBusy(null);
    if (!r.ok) {
      setMessage({ tone: "error", text: r.error });
      if (r.conflict) onChanged(null);
      return;
    }
    setEditing(false);
    setMessage({ tone: "ok", text: "Saved" });
    onChanged(r.draft);
  }
  async function postAsFinding() {
    setBusy("post");
    setMessage(null);
    const r = await postInsightAsFindingAction(story.runId, story.documentId, draft.id);
    setBusy(null);
    if (!r.ok) return setMessage({ tone: "error", text: r.error });
    setMessage({ tone: "ok", text: r.added ? "Posted as a finding" : "Already posted as a finding" });
    void story.refresh();
    onChanged(null);
  }

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid="ai-insight" data-status={draft.status} data-stale={draft.stale ? "true" : "false"}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.cls}`} data-testid="ai-insight-status">
          {badge.text}
        </span>
        {draft.humanEdited && <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600">Edited</span>}
        {draft.stale && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-900" data-testid="ai-insight-stale">
            Figures changed since drafted
          </span>
        )}
        {draft.findingId && <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] text-blue-800">Posted as finding</span>}
      </div>
      {editing ? (
        <div className="mt-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} aria-label="Insight wording" className="w-full rounded-lg border border-slate-300 p-2 text-sm" />
          <div className="mt-1.5 flex gap-1.5">
            <button type="button" onClick={() => void save()} disabled={busy !== null} className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60">
              {busy === "save" ? "Saving..." : "Save"}
            </button>
            <button type="button" onClick={() => { setEditing(false); setText(draft.text); }} disabled={busy !== null} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className={`mt-2 text-sm leading-relaxed ${draft.status === "discarded" || draft.status === "refused" ? "text-slate-500" : "text-slate-900"}`} data-testid="ai-insight-text">
          {draft.text}
        </p>
      )}
      {draft.checkNote && (
        <p className={`mt-1.5 text-[11px] ${draft.status === "refused" ? "text-red-700" : "text-amber-800"}`} data-testid="ai-insight-check">
          {draft.checkNote}
        </p>
      )}
      {!editing && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {(draft.status === "draft" || draft.status === "refused") && (
            <>
              {draft.status === "draft" && (
                <button type="button" onClick={() => void decide("accept")} disabled={busy !== null || draft.stale} className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50" data-testid="ai-insight-accept">
                  {busy === "accept" ? "Accepting..." : "Accept"}
                </button>
              )}
              <button type="button" onClick={() => { setText(draft.text); setMessage(null); setEditing(true); }} disabled={busy !== null} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs" data-testid="ai-insight-edit">
                Edit
              </button>
              <button type="button" onClick={() => void decide("discard")} disabled={busy !== null} className="rounded-md px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100" data-testid="ai-insight-discard">
                {busy === "discard" ? "Discarding..." : "Discard"}
              </button>
            </>
          )}
          {draft.status === "accepted" && (
            <>
              {canPost && !draft.findingId && (
                <button type="button" onClick={() => void postAsFinding()} disabled={busy !== null || draft.stale} className="rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 disabled:opacity-50" data-testid="ai-insight-post">
                  {busy === "post" ? "Posting..." : "Post as finding"}
                </button>
              )}
              <button type="button" onClick={() => { setText(draft.text); setMessage(null); setEditing(true); }} disabled={busy !== null} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs">
                Edit
              </button>
              <button type="button" onClick={() => void decide("reopen")} disabled={busy !== null} className="rounded-md px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100">
                Undo accept
              </button>
            </>
          )}
          {draft.status === "discarded" && (
            <button type="button" onClick={() => void decide("reopen")} disabled={busy !== null} className="rounded-md px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100">
              Restore
            </button>
          )}
        </div>
      )}
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-1.5 text-[11px] ${message.tone === "error" ? "text-red-700" : "text-emerald-700"}`} data-testid="ai-insight-message">
          {message.text}
        </p>
      )}
    </li>
  );
}

/** The "AI insights" button for the page shown, and its side panel. */
export function DashboardInsightsButton({ page, title }: { page: string; title: string }) {
  const story = useDashboardStory();
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [drafting, setDrafting] = useState<null | { error?: string }>(null);
  const [showDiscarded, setShowDiscarded] = useState(false);
  // Only the latest request for the page shown may change the panel (a page switch counts as newer).
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const id = ++latest.current;
    setLoad({ state: "loading" });
    const r = await loadPageInsightsAction(story.runId, story.documentId, page);
    if (id !== latest.current) return;
    setLoad(r.ok ? { state: "ready", drafts: r.drafts } : { state: "failed", error: r.error });
  }, [story.runId, story.documentId, page]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    setDrafting(null);
    return () => {
      latest.current += 1;
    };
  }, [open, reload]);

  async function draft() {
    const id = ++latest.current;
    setDrafting({});
    const r = await generatePageInsightsAction(story.runId, story.documentId, page);
    if (id !== latest.current) return;
    if (!r.ok) return setDrafting({ error: r.error });
    setDrafting(null);
    if (r.superseded) return void reload();
    setLoad({ state: "ready", drafts: r.drafts });
  }

  const drafts = load.state === "ready" ? load.drafts : [];
  const visible = drafts.filter((d) => d.status !== "discarded");
  const discarded = drafts.filter((d) => d.status === "discarded");
  const count = visible.filter((d) => d.status !== "refused").length;
  const replace = (d: AiDraft | null) => {
    if (d === null) return void reload();
    setLoad((cur) => (cur.state === "ready" ? { state: "ready", drafts: cur.drafts.map((x) => (x.id === d.id ? d : x)) } : cur));
  };

  const panel = open && (
    <aside className="fixed inset-y-0 right-0 z-[60] flex w-full max-w-[27rem] flex-col border-l border-slate-200 bg-[#f8fafc] shadow-2xl" role="dialog" aria-label={`AI insights: ${title}`} data-testid="ai-insights-panel">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">AI insights</p>
          <p className="text-base font-semibold text-slate-900">{title}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">Drafted from this page&apos;s figures only. Every number is checked against them; nothing is used until you accept it.</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100" aria-label="Close AI insights">
          Close
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-3 flex items-center gap-2">
          <button type="button" onClick={() => void draft()} disabled={drafting !== null && !drafting.error} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60" data-testid="ai-insights-draft">
            {drafting && !drafting.error ? "Drafting..." : visible.length ? "Draft again" : "Draft insights"}
          </button>
          {visible.length > 0 && <p className="text-[11px] text-slate-500">Drafting again replaces untouched drafts; accepted, edited and discarded ones are kept.</p>}
        </div>
        {drafting && !drafting.error && (
          <p role="status" className="mb-3 text-sm text-slate-500">
            Drafting insights from this page&apos;s figures...
          </p>
        )}
        {drafting?.error && (
          <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" data-testid="ai-insights-error">
            <p>{drafting.error}</p>
            <button type="button" onClick={() => void draft()} className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs">
              Try again
            </button>
          </div>
        )}
        {load.state === "loading" && (
          <p role="status" className="text-sm text-slate-500">
            Reading this page&apos;s insights...
          </p>
        )}
        {load.state === "failed" && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p>The insights could not be read: {load.error}</p>
            <button type="button" onClick={() => void reload()} className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs">
              Try again
            </button>
          </div>
        )}
        {load.state === "ready" && visible.length === 0 && !drafting && <p className="text-sm text-slate-500">No insights drafted for this page yet.</p>}
        <ol className="flex flex-col gap-2.5" data-testid="ai-insights-list">
          {visible.map((d) => (
            <AiDraftItem key={d.id} draft={d} onChanged={replace} canPost />
          ))}
        </ol>
        {discarded.length > 0 && (
          <div className="mt-3">
            <button type="button" onClick={() => setShowDiscarded((v) => !v)} className="text-xs text-slate-500 underline">
              {showDiscarded ? "Hide" : "Show"} {discarded.length} discarded
            </button>
            {showDiscarded && (
              <ol className="mt-2 flex flex-col gap-2.5">
                {discarded.map((d) => (
                  <AiDraftItem key={d.id} draft={d} onChanged={replace} />
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
        data-testid="ai-insights-button"
      >
        <span aria-hidden>✦</span> AI insights
        {open && load.state === "ready" && count > 0 && <span className="rounded-full bg-blue-600 px-1.5 text-[11px] text-white">{count}</span>}
      </button>
      {panel && typeof document !== "undefined" ? createPortal(panel, document.body) : null}
    </>
  );
}
