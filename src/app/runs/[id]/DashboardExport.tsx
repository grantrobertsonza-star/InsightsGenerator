"use client";

// R5story: "Export slides" for the brand tracking dashboard (Grant, 30 October 2026: "the entire module can be put
// straight into slides"). The dialog drafts and settles the executive summary and the conclusions and
// recommendations (drafted by the model from the accepted insights and findings only, figure-checked, "AI draft"
// until accepted, editable), and downloads the deck (src/app/api/runs/[id]/tracker-dashboard/export/route.ts). When
// nothing is accepted the drafts cannot be made and the deck says so. "Include AI drafts" adds unaccepted drafts,
// labelled as drafts on the slides.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { draftModuleStoryAction, loadModuleStoryAction } from "@/lib/trackerDashboardStoryActions";
import type { AiDraft, StoryInput } from "@/lib/dashboardInsights";
import { useDashboardStory } from "./DashboardFindingButton";
import { AiDraftItem } from "./DashboardInsightsPanel";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; drafts: AiDraft[]; inputs: StoryInput[] };
type Download = { state: "idle" } | { state: "building" } | { state: "done"; name: string } | { state: "failed"; error: string };

function StorySection({ kind, title, load, onReload }: { kind: "summary" | "conclusions"; title: string; load: Extract<Load, { state: "ready" }>; onReload: () => void }) {
  const story = useDashboardStory();
  const [busy, setBusy] = useState<null | { error?: string }>(null);
  const latest = useRef(0);
  const drafts = load.drafts.filter((d) => d.kind === kind && d.status !== "discarded");
  async function draft() {
    const id = ++latest.current;
    setBusy({});
    const r = await draftModuleStoryAction(story.runId, story.documentId, kind);
    if (id !== latest.current) return;
    if (!r.ok) return setBusy({ error: r.error });
    setBusy(null);
    onReload();
  }
  const nothing = load.inputs.length === 0;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label={title} data-testid={`export-${kind}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <button type="button" onClick={() => void draft()} disabled={nothing || (busy !== null && !busy.error)} className="rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 disabled:opacity-50" data-testid={`export-${kind}-draft`}>
          {busy && !busy.error ? "Drafting..." : drafts.length ? "Draft again" : "Draft with AI"}
        </button>
      </div>
      {nothing ? (
        <p className="mt-2 text-xs text-slate-500" data-testid={`export-${kind}-nothing`}>
          Nothing is accepted yet, so this cannot be drafted; the deck will say so. Accept AI insights on the pages, or post cards as findings, first.
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-slate-500">Drafted from {load.inputs.length} accepted insight{load.inputs.length === 1 ? "" : "s"} and finding{load.inputs.length === 1 ? "" : "s"} only.</p>
      )}
      {busy?.error && (
        <p role="alert" className="mt-2 text-xs text-red-700" data-testid={`export-${kind}-error`}>
          {busy.error}
        </p>
      )}
      {drafts.length > 0 && (
        <ol className="mt-3 flex flex-col gap-2">
          {drafts.map((d) => (
            <AiDraftItem key={d.id} draft={d} onChanged={() => onReload()} />
          ))}
        </ol>
      )}
    </section>
  );
}

export function DashboardExportButton() {
  const story = useDashboardStory();
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [download, setDownload] = useState<Download>({ state: "idle" });
  const latest = useRef(0);
  const latestDownload = useRef(0);

  const reload = useCallback(async () => {
    const id = ++latest.current;
    setLoad((cur) => (cur.state === "ready" ? cur : { state: "loading" }));
    const r = await loadModuleStoryAction(story.runId, story.documentId);
    if (id !== latest.current) return;
    setLoad(r.ok ? { state: "ready", drafts: r.drafts, inputs: r.inputs } : { state: "failed", error: r.error });
  }, [story.runId, story.documentId]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    return () => {
      latest.current += 1;
      latestDownload.current += 1;
    };
  }, [open, reload]);

  async function downloadDeck() {
    const id = ++latestDownload.current;
    setDownload({ state: "building" });
    try {
      const res = await fetch(`/api/runs/${story.runId}/tracker-dashboard/export?documentId=${encodeURIComponent(story.documentId)}${includeDrafts ? "&includeDrafts=1" : ""}`);
      if (id !== latestDownload.current) return;
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        return setDownload({ state: "failed", error: body?.error ?? `The deck could not be built (${res.status}).` });
      }
      const blob = await res.blob();
      if (id !== latestDownload.current) return;
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "brand-tracking.pptx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setDownload({ state: "done", name });
    } catch (e) {
      if (id !== latestDownload.current) return;
      setDownload({ state: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  }

  const dialog = open && (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6" role="dialog" aria-label="Export slides" data-testid="export-dialog">
      <div className="w-full max-w-2xl rounded-2xl bg-[#f8fafc] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <p className="text-lg font-semibold text-slate-900">Export slides</p>
            <p className="mt-0.5 text-xs text-slate-500">A PowerPoint deck of the whole dashboard: title, executive summary, one slide per page with its charts, bases and caveats and its accepted AI insights, then conclusions and recommendations.</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">
            Close
          </button>
        </div>
        <div className="flex flex-col gap-3 px-6 py-5">
          {load.state === "loading" && (
            <p role="status" className="text-sm text-slate-500">
              Reading the dashboard&apos;s accepted insights...
            </p>
          )}
          {load.state === "failed" && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p>{load.error}</p>
              <button type="button" onClick={() => void reload()} className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs">
                Try again
              </button>
            </div>
          )}
          {load.state === "ready" && (
            <>
              <StorySection kind="summary" title="Executive summary" load={load} onReload={() => void reload()} />
              <StorySection kind="conclusions" title="Conclusions and recommendations" load={load} onReload={() => void reload()} />
            </>
          )}
          <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
            <input type="checkbox" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} className="mt-0.5" data-testid="export-include-drafts" />
            <span>
              Include AI drafts
              <span className="block text-[11px] text-slate-500">Unaccepted AI insights and drafts are added and labelled &quot;AI draft, not accepted&quot; on the slides. Refused and discarded drafts are never included.</span>
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void downloadDeck()} disabled={download.state === "building"} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" data-testid="export-download">
              {download.state === "building" ? "Building the deck..." : "Download PowerPoint"}
            </button>
            {download.state === "done" && (
              <p role="status" className="text-xs text-emerald-700" data-testid="export-done">
                Downloaded {download.name}
              </p>
            )}
            {download.state === "failed" && (
              <p role="alert" className="text-xs text-red-700" data-testid="export-failed">
                {download.error}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50" data-testid="export-slides-button">
        Export slides
      </button>
      {dialog && typeof document !== "undefined" ? createPortal(dialog, document.body) : null}
    </>
  );
}
