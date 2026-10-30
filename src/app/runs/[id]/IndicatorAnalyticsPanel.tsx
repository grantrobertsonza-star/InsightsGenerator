"use client";

// Indicator Analytics (D6): the single-indicator dashboard for this project's Indicator data files, laid out after
// Grant's visual plan (docs/design/Unified_Indicators_Visual_Plan-2026-10-29.pdf: Overview, Trends, Compare, Data &
// sources). One workspace across providers: the file is a filter, not a separate app. Every figure and line comes
// from the loader (src/lib/indicatorAnalytics.ts through indicatorAnalyticsActions.ts); this screen lays them out and
// computes no figure. Choices are kept for this page load (useKeptOpen), not saved to the project.
//
// Requests: only the answer to the latest request is shown (createRequestOrder), so a late answer for an earlier
// choice or another file never replaces a newer one. A reread of the file since the view was loaded answers stale:
// the view reloads from the new read with the same choices and says so.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { indicatorAnalyticsAction, indicatorWorkspaceAction } from "@/lib/indicatorAnalyticsActions";
import type { IndicatorAnalyticsReady, IndicatorAnalyticsView, IndicatorWorkspace } from "@/lib/indicatorAnalytics";
import { MAX_TREND_PANELS, axisFraction, seriesKeyFor, type ObservedPoint } from "@/lib/indicatorAnalyticsFigures";
import { createRequestOrder } from "@/lib/indicatorDisplay";
import { useKeptOpen } from "./useKeptOpen";

type Tab = "overview" | "trends" | "compare" | "sources";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "trends", label: "Trends" },
  { id: "compare", label: "Compare" },
  { id: "sources", label: "Data & sources" },
];

/** The researcher's choices; null is "not chosen", which the loader suggests and explains. */
type Choice = {
  documentId: string | null;
  seriesKey: string | null;
  area: { code: string | null } | null;
  from: string | null;
  to: string | null;
  comparePeriod: string | null;
  trendAreas: (string | null)[] | null;
  tab: Tab;
  selectorOpen: boolean;
  panels: { headline: boolean; trend: boolean; summary: boolean; definition: boolean };
};
const SUGGESTED: Omit<Choice, "documentId" | "tab" | "selectorOpen" | "panels"> = { seriesKey: null, area: null, from: null, to: null, comparePeriod: null, trendAreas: null };
const FIRST: Choice = { documentId: null, ...SUGGESTED, tab: "overview", selectorOpen: true, panels: { headline: true, trend: true, summary: true, definition: true } };

type Answer = { view: IndicatorAnalyticsView | { state: "error"; message: string }; note: string | null };
/** While a new answer is calculated the previous one stays on screen (with its filters), marked as updating. */
type ViewLoad = { state: "idle" } | { state: "loading"; previous: Answer | null } | ({ state: "answer" } & Answer);

/** An area code as an option value: a file may leave an area unstated (null). */
const NULL_AREA = "\u0000";
const areaValue = (code: string | null) => code ?? NULL_AREA;
const areaOf = (value: string) => (value === NULL_AREA ? null : value);

export function IndicatorAnalyticsLauncher({ runId, fileCount }: { runId: string; fileCount: number }) {
  // Kept outside the component: a refresh that unmounts Analytics does not close the workspace (useKeptOpen).
  const [open, setOpen] = useKeptOpen(`${runId}:indicatorAnalytics:open`, false);
  return (
    <section aria-label="Indicator dashboards" data-testid="indicator-dashboards" className="mb-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Indicator dashboards</h3>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <li>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex h-full w-full flex-col items-start gap-1.5 rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5 text-left shadow-sm transition hover:border-blue-400 focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="text-base font-semibold text-foreground">Indicator Analytics</span>
            <span className="text-xs leading-relaxed text-slate-600">
              Built from your indicator data ({fileCount} file{fileCount === 1 ? "" : "s"}): the latest observed value, the change since the previous observation, each
              country&apos;s observed history, a same-year comparison and the source details. Observed values only.
            </span>
          </button>
        </li>
      </ul>
      {open && <IndicatorAnalyticsPanel runId={runId} onClose={() => setOpen(false)} />}
    </section>
  );
}

function IndicatorAnalyticsPanel({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [choice, setChoiceKept] = useKeptOpen<Choice>(`${runId}:indicatorAnalytics:choice`, FIRST);
  const [workspace, setWorkspace] = useState<{ state: "loading" } | { state: "failed"; error: string } | { state: "ready"; workspace: IndicatorWorkspace }>({ state: "loading" });
  const [load, setLoad] = useState<ViewLoad>({ state: "idle" });
  const order = useRef(createRequestOrder());
  const workspaceOrder = useRef(createRequestOrder());
  // The read the current view came from, so a reread since then is detected (stale) rather than mixed in.
  const shownRead = useRef<{ documentId: string; readId: string } | null>(null);

  const setChoice = useCallback((next: Partial<Choice>) => setChoiceKept({ ...choice, ...next }), [choice, setChoiceKept]);

  const loadWorkspace = useCallback(async () => {
    const n = workspaceOrder.current.next();
    setWorkspace({ state: "loading" });
    const r = await indicatorWorkspaceAction(runId);
    if (!workspaceOrder.current.isLatest(n)) return;
    setWorkspace(r.ok ? { state: "ready", workspace: r.workspace } : { state: "failed", error: r.error });
  }, [runId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadWorkspace();
    const o = order.current;
    const w = workspaceOrder.current;
    return () => {
      // Answers still on their way after closing are dropped.
      o.next();
      w.next();
    };
  }, [loadWorkspace]);

  const files = workspace.state === "ready" && workspace.workspace.state === "ready" ? workspace.workspace.files : [];
  // The file shown: the one chosen if it is still in the project, else the first with observations, else the first.
  const documentId = files.some((f) => f.documentId === choice.documentId) ? choice.documentId : (files.find((f) => f.state === "observations_ready") ?? files[0])?.documentId ?? null;

  const requestView = useCallback(
    async (c: Choice, docId: string) => {
      const n = order.current.next();
      setLoad((l) => ({ state: "loading", previous: l.state === "answer" ? { view: l.view, note: l.note } : l.state === "loading" ? l.previous : null }));
      const ask = (readId: string | null) => indicatorAnalyticsAction(runId, { documentId: docId, readId, seriesKey: c.seriesKey, area: c.area, from: c.from, to: c.to, comparePeriod: c.comparePeriod, trendAreas: c.trendAreas });
      let view = await ask(shownRead.current?.documentId === docId ? shownRead.current.readId : null);
      let note: string | null = null;
      if (view.state === "stale" && order.current.isLatest(n)) {
        // The file was read again: ask once more from the new read with the same choices, and say why the view changed.
        note = view.message;
        shownRead.current = null;
        void loadWorkspace();
        view = await ask(null);
      }
      if (!order.current.isLatest(n)) return;
      if (view.state === "ready" || view.state === "definitions_only" || view.state === "needs_review") shownRead.current = { documentId: docId, readId: view.readId };
      setLoad({ state: "answer", view, note });
    },
    [runId, loadWorkspace],
  );

  const viewKey = JSON.stringify([documentId, choice.seriesKey, choice.area, choice.from, choice.to, choice.comparePeriod, choice.trendAreas]);
  useEffect(() => {
    // A new request whenever the file or a figure-changing choice changes; tab and panel choices do not ask again.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (documentId) void requestView(choice, documentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, requestView]);

  const shown = load.state === "answer" ? load : load.state === "loading" ? load.previous : null;
  const view = shown?.view ?? null;
  const ready = view?.state === "ready" ? view : null;
  const resetToSuggested = () => setChoice({ ...SUGGESTED });
  const chooseFile = (id: string) => setChoice({ documentId: id, ...SUGGESTED });

  const body = (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#f5f7fb]" role="dialog" aria-label="Indicator Analytics" data-testid="indicator-analytics">
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-900">Indicator Analytics</p>
          <p className="truncate text-[11px] text-slate-500">{ready ? ready.fileName : "Indicator data in this project"}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled title="Exporting this dashboard is not available yet" className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-400">
            Export report: not available yet
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
            ← All analytics
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <Selector
          open={choice.selectorOpen}
          onToggle={() => setChoice({ selectorOpen: !choice.selectorOpen })}
          ready={ready}
          workspace={workspace.state === "ready" && workspace.workspace.state === "ready" ? workspace.workspace : null}
          panels={choice.panels}
          onPanels={(panels) => setChoice({ panels })}
          onReset={resetToSuggested}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[84rem] flex-col gap-5 px-4 py-6 sm:px-6">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Indicators dashboard</h2>
              <p className="text-sm text-slate-500">One reporting workspace across providers. The source file is a filter, not a separate app.</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
                <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">Auto-generated</span>
                <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">Observed data only</span>
              </div>
            </div>
            <div className="flex gap-1 border-b border-slate-200" role="tablist" aria-label="Indicator dashboard views">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={choice.tab === t.id}
                  onClick={() => setChoice({ tab: t.id })}
                  className={`-mb-px border-b-2 px-4 py-2 text-sm ${choice.tab === t.id ? "border-blue-600 font-semibold text-blue-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {workspace.state === "loading" && <p className="text-sm text-slate-500" role="status">Reading the project&apos;s indicator files...</p>}
            {workspace.state === "failed" && <Problem text={`The indicator files could not be listed: ${workspace.error}`} action={{ label: "Try again", run: () => void loadWorkspace() }} />}
            {workspace.state === "ready" && workspace.workspace.state === "unavailable" && <Problem text={workspace.workspace.message} />}
            {workspace.state === "ready" && files.length === 0 && workspace.workspace.state === "ready" && <p className="text-sm text-slate-600">No Indicator data files in this project yet. Add one in Sources as Indicator data.</p>}
            {documentId && (
              <Filters
                files={files}
                documentId={documentId}
                onFile={chooseFile}
                ready={ready}
                tab={choice.tab}
                choice={choice}
                setChoice={setChoice}
              />
            )}
            {load.state === "loading" && <p className="text-sm text-slate-500" role="status">Calculating from the stored observations...</p>}
            {shown?.note && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">{shown.note}</p>}
            {view && view.state !== "ready" && <ViewProblem view={view} onReset={resetToSuggested} />}
            {ready && ready.lastFailure && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">The last attempt to read this file again failed ({ready.lastFailure.failure}); the earlier read is shown.</p>
            )}
            {choice.tab === "sources" ? (
              <SourcesView workspace={workspace.state === "ready" && workspace.workspace.state === "ready" ? workspace.workspace : null} ready={ready} />
            ) : ready ? (
              choice.tab === "overview" ? <OverviewView v={ready} panels={choice.panels} /> : choice.tab === "trends" ? <TrendsView v={ready} /> : <CompareView v={ready} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(body, document.body);
}

function Problem({ text, action }: { text: string; action?: { label: string; run: () => void } }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
      <p>{text}</p>
      {action && (
        <button type="button" onClick={action.run} className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs">
          {action.label}
        </button>
      )}
    </div>
  );
}

function ViewProblem({ view, onReset }: { view: Exclude<IndicatorAnalyticsView, IndicatorAnalyticsReady> | { state: "error"; message: string }; onReset: () => void }) {
  switch (view.state) {
    case "definitions_only":
      return <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">{view.fileName} holds reference information (metadata) only, no observations, so no chart is drawn. Its notes are shown with the data file of the same dataflow. See Data &amp; sources.</p>;
    case "not_read":
      return <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">This file has not been read yet. Open its Indicator data tab in Sources.</p>;
    case "failed":
      return <Problem text={`This file could not be read: ${view.failure}`} />;
    case "needs_review":
      return <Problem text={view.message} action={{ label: "Show the suggested series", run: onReset }} />;
    case "series_not_found":
    case "invalid":
      return <Problem text={view.message} action={{ label: "Reset to suggested", run: onReset }} />;
    default:
      return <Problem text={view.message} />;
  }
}

function Selector({
  open,
  onToggle,
  ready,
  workspace,
  panels,
  onPanels,
  onReset,
}: {
  open: boolean;
  onToggle: () => void;
  ready: IndicatorAnalyticsReady | null;
  workspace: Extract<IndicatorWorkspace, { state: "ready" }> | null;
  panels: Choice["panels"];
  onPanels: (p: Choice["panels"]) => void;
  onReset: () => void;
}) {
  if (!open) {
    return (
      <div className="flex shrink-0 border-b border-slate-200 bg-white px-3 py-2 lg:w-12 lg:flex-col lg:border-b-0 lg:border-r lg:py-5">
        <button type="button" onClick={onToggle} aria-expanded={false} aria-label="Show the dashboard selector" className="rounded px-2 py-1 text-sm text-blue-700 hover:bg-blue-50">
          ›
        </button>
      </div>
    );
  }
  return (
    <aside aria-label="Customise dashboard" className="flex shrink-0 flex-col gap-4 overflow-y-auto border-b border-slate-200 bg-white px-4 py-5 lg:w-72 lg:border-b-0 lg:border-r" data-testid="indicator-selector">
      <div className="flex items-center justify-between">
        <p className="text-base font-semibold text-slate-900">Customise dashboard</p>
        <button type="button" onClick={onToggle} aria-expanded aria-label="Hide the dashboard selector" className="rounded px-2 py-1 text-sm text-blue-700 hover:bg-blue-50">
          ‹
        </button>
      </div>
      <p className="text-xs text-slate-500">The dashboard is generated automatically from the file. Refine it here.</p>
      {ready && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Selected indicator</p>
          <div className="mt-1 rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-semibold text-slate-900">{ready.series.name}</p>
            <p className="mt-1 text-xs text-slate-500">{ready.series.chosenText || ready.series.fixedText}</p>
          </div>
        </div>
      )}
      <fieldset>
        <legend className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Visible panels (Overview)</legend>
        {(
          [
            ["headline", "Headline figures"],
            ["trend", "Observed trend"],
            ["summary", "What this view says"],
            ["definition", "Definition and provenance"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="mt-1.5 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={panels[k]} onChange={(e) => onPanels({ ...panels, [k]: e.target.checked })} />
            {label}
          </label>
        ))}
      </fieldset>
      {workspace && (
        <div className="rounded-lg border border-slate-200 p-3 text-xs text-slate-600" data-testid="indicator-providers">
          <p className="font-semibold text-emerald-700">
            {workspace.withObservations} file{workspace.withObservations === 1 ? "" : "s"} with observations
          </p>
          {workspace.providers.map((p) => (
            <p key={p.text}>{p.text}</p>
          ))}
        </div>
      )}
      <div className="text-xs text-slate-500">
        <p>Add or remove series: not available yet (one indicator at a time).</p>
        <p className="mt-1">Advanced mapping: not available yet.</p>
      </div>
      <button type="button" onClick={onReset} className="self-start text-xs text-blue-700 hover:underline">
        Reset to suggested
      </button>
    </aside>
  );
}

function Select({ label, value, onChange, children, testId }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode; testId?: string }) {
  return (
    <label className="flex min-w-[9rem] flex-col gap-1 text-[11px] font-medium text-slate-500">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900">
        {children}
      </select>
    </label>
  );
}

function Filters({
  files,
  documentId,
  onFile,
  ready,
  tab,
  choice,
  setChoice,
}: {
  files: Extract<IndicatorWorkspace, { state: "ready" }>["files"];
  documentId: string;
  onFile: (id: string) => void;
  ready: IndicatorAnalyticsReady | null;
  tab: Tab;
  choice: Choice;
  setChoice: (c: Partial<Choice>) => void;
}) {
  const f = ready?.filters;
  // A change of indicator or breakdown asks for that series by key; with no series for the combination nothing is
  // put in its place and the choice is refused here with the reason.
  const [missing, setMissing] = useState<string | null>(null);
  const chooseSeries = (indicatorKey: string, picks: Record<string, string>) => {
    if (!f) return;
    const key = seriesKeyFor(f.seriesChoices, indicatorKey, picks);
    if (!key) return setMissing("No series in this file has that combination of breakdowns. Nothing else was put in its place.");
    setMissing(null);
    // The area and periods stay; the loader says when the area has no observation in the new series.
    setChoice({ seriesKey: key, comparePeriod: null, trendAreas: null });
  };
  const picks = useMemo(() => Object.fromEntries((f?.breakdowns ?? []).map((b) => [b.dimension, b.code])), [f]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2" data-testid="indicator-filters">
        <Select label="Source file" value={documentId} onChange={onFile} testId="indicator-file">
          {files.map((x) => (
            <option key={x.documentId} value={x.documentId}>
              {x.fileName}
            </option>
          ))}
        </Select>
        {f && (
          <>
            {tab !== "compare" && (
              <Select label="Country or area" value={areaValue(f.area.code)} onChange={(v) => setChoice({ area: { code: areaOf(v) }, trendAreas: null })} testId="indicator-area">
                {f.areas.map((a) => (
                  <option key={areaValue(a.code)} value={areaValue(a.code)}>
                    {a.name}
                    {a.withheldOnly ? " (every value withheld)" : ""}
                  </option>
                ))}
              </Select>
            )}
            <Select label="Indicator" value={f.indicatorKey} onChange={(v) => chooseSeries(v, picks)} testId="indicator-indicator">
              {f.indicators.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.name}
                </option>
              ))}
            </Select>
            {f.breakdowns.map((b) => (
              <Select key={b.dimension} label={b.name} value={b.code} onChange={(v) => chooseSeries(f.indicatorKey, { ...picks, [b.dimension]: v })} testId={`indicator-breakdown-${b.dimension}`}>
                {b.values.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.label}
                  </option>
                ))}
              </Select>
            ))}
            {tab === "compare" ? (
              <Select label="Reference period" value={f.comparePeriod ?? ""} onChange={(v) => setChoice({ comparePeriod: v })} testId="indicator-compare-period">
                {f.periods.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            ) : (
              <>
                <Select label="From" value={f.from ?? ""} onChange={(v) => setChoice({ from: v || null })} testId="indicator-from">
                  <option value="">First observed</option>
                  {f.periods.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
                <Select label="To" value={f.to ?? ""} onChange={(v) => setChoice({ to: v || null })} testId="indicator-to">
                  <option value="">Latest observed</option>
                  {f.periods.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </>
            )}
            {tab === "trends" && <TrendAreasPicker f={f} choice={choice} panels={ready!.trends.panels.map((p) => p.areaCode)} setChoice={setChoice} />}
          </>
        )}
      </div>
      {f?.areaRule && tab !== "compare" && <p className="text-[11px] text-slate-500">{f.areaRule}</p>}
      {missing && <p className="text-xs text-red-700" role="alert">{missing}</p>}
    </div>
  );
}

function TrendAreasPicker({ f, panels, setChoice }: { f: IndicatorAnalyticsReady["filters"]; choice: Choice; panels: (string | null)[]; setChoice: (c: Partial<Choice>) => void }) {
  const toggle = (code: string | null, on: boolean) => {
    const next = on ? [...panels, code] : panels.filter((p) => p !== code);
    if (next.length > MAX_TREND_PANELS) return;
    setChoice({ trendAreas: next });
  };
  return (
    <details className="relative">
      <summary className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900">Countries shown ({panels.length})</summary>
      <div className="absolute z-10 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
        <p className="mb-1 text-[11px] text-slate-500">Up to {MAX_TREND_PANELS}.</p>
        {f.areas.map((a) => (
          <label key={areaValue(a.code)} className="flex items-center gap-2 py-0.5 text-sm text-slate-700">
            <input type="checkbox" checked={panels.includes(a.code)} disabled={!panels.includes(a.code) && panels.length >= MAX_TREND_PANELS} onChange={(e) => toggle(a.code, e.target.checked)} />
            {a.name}
          </label>
        ))}
      </div>
    </details>
  );
}

function Card({ title, subtitle, children, testId }: { title: string; subtitle?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" data-testid={testId}>
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * A dot per observed value on the view's one time axis; no line, so nothing is drawn between observations. Every
 * chart places a period by its share of that axis (axisFraction), never by its index in this chart, so one date is
 * at one position in every panel (Codex D6-F02). When the axis is withheld, or a point is not on it, the chart is
 * not drawn: the reason is shown and the observed values are listed in period order.
 */
function DotChart({ points, axis, valueAxis, percent, height = 220, label }: { points: ObservedPoint[]; axis: IndicatorAnalyticsReady["axis"]; valueAxis: IndicatorAnalyticsReady["valueAxis"]; percent: boolean; height?: number; label: string }) {
  const width = 640;
  const pad = { l: 40, r: 24, t: 24, b: 28 };
  const fractions = points.map((p) => axisFraction(p.position, axis));
  const unplaced = points.findIndex((_, i) => fractions[i] === null);
  if (unplaced >= 0) {
    const reason = axis.state === "withheld" ? axis.reason : `Not placed on a time axis: ${points[unplaced].period} is outside this view's time axis.`;
    return (
      <div className="text-sm text-slate-700" data-testid="indicator-axis-withheld">
        <p className="text-xs text-amber-800">{reason}</p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-label={label}>
          {points.map((p) => (
            <li key={p.period}>{`${p.period}: ${p.shown}${p.statusLabel ? ` (${p.statusLabel})` : ""}`}</li>
          ))}
        </ul>
      </div>
    );
  }
  const xOf = (i: number) => pad.l + fractions[i]! * (width - pad.l - pad.r);
  const yOf = (v: number) => pad.t + (1 - (v - valueAxis.min) / (valueAxis.max - valueAxis.min || 1)) * (height - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => valueAxis.min + t * (valueAxis.max - valueAxis.min));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={label}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={width - pad.r} y1={yOf(t)} y2={yOf(t)} stroke="#e2e8f0" />
          <text x={pad.l - 6} y={yOf(t) + 3} textAnchor="end" fontSize="10" fill="#64748b">
            {t.toLocaleString("en-GB", { maximumFractionDigits: 2 })}
          </text>
        </g>
      ))}
      {percent && (
        <text x={pad.l - 6} y={pad.t - 10} textAnchor="end" fontSize="10" fill="#64748b">
          %
        </text>
      )}
      {points.map((p, i) => (
        <g key={p.period}>
          <circle cx={xOf(i)} cy={yOf(p.value)} r={5} fill={p.status && p.status !== "A" ? "white" : "#2563eb"} stroke="#2563eb" strokeWidth={2}>
            <title>{`${p.period}${p.note ? `, ${p.note}` : ""}: ${p.shown}${p.statusLabel ? `, ${p.statusLabel}` : ""}`}</title>
          </circle>
          <text x={xOf(i)} y={yOf(p.value) - 10} textAnchor="middle" fontSize="11" fontWeight="600" fill="#1d4ed8">
            {p.shown.replace(/%$/, "")}
          </text>
          <text x={xOf(i)} y={height - 8} textAnchor="middle" fontSize="10" fill="#64748b">
            {p.period}
          </text>
        </g>
      ))}
    </svg>
  );
}

function OverviewView({ v, panels }: { v: IndicatorAnalyticsReady; panels: Choice["panels"] }) {
  const h = v.overview.headline;
  const area = v.filters.area.name;
  return (
    <div className="flex flex-col gap-5" data-testid="indicator-overview">
      {panels.headline && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <section className="rounded-xl border border-slate-200 bg-white p-5" data-testid="indicator-latest">
            <p className="text-xs text-slate-500">Latest observed: {area}</p>
            <p className="mt-1 text-4xl font-bold text-slate-900">{h.latest ? h.latest.shown : "No observation"}</p>
            <p className="mt-1 text-xs text-blue-700">{h.latest ? `${h.latest.period}${h.latest.note ? `, ${h.latest.note}` : ""}` : "in this range"}</p>
            <p className="text-[11px] text-slate-500">{v.series.unit}</p>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5" data-testid="indicator-change">
            <p className="text-xs text-slate-500">Change since the previous observation</p>
            <p className="mt-1 text-4xl font-bold text-slate-900">{h.change ? h.change.text : "Not stated"}</p>
            <p className="mt-1 text-xs text-blue-700">{h.change ? h.change.periodsText : "Needs two observations in this range"}</p>
            {h.change && <p className="text-[11px] text-slate-500">{`${h.change.arithmetic}; in ${h.change.unitWords}`}</p>}
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5" data-testid="indicator-count">
            <p className="text-xs text-slate-500">Observations in this trend</p>
            <p className="mt-1 text-4xl font-bold text-slate-900">{h.observationCount}</p>
            <p className="mt-1 text-xs text-blue-700">{h.observed.map((o) => o.period).join(" / ") || "none"}</p>
            <p className="text-[11px] text-slate-500">Missing years remain missing</p>
          </section>
        </div>
      )}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {panels.trend && (
          <Card title={v.series.name} subtitle={`${area}; ${v.series.chosenText || v.series.fixedText}; observed values`} testId="indicator-trend">
            {v.overview.trend.length > 0 ? (
              <DotChart points={v.overview.trend} axis={v.axis} valueAxis={v.valueAxis} percent={v.series.percent} label={`Observed values of ${v.series.name} for ${area}`} />
            ) : (
              <p className="text-sm text-slate-600">No observed value for {area} in this range.</p>
            )}
            {v.overview.withheld.length > 0 && <p className="mt-2 text-xs text-amber-800">Withheld by the publisher as confidential (no value, never zero): {v.overview.withheld.join(", ")}</p>}
            <p className="mt-2 text-[11px] text-slate-500">{v.sourceLine}</p>
          </Card>
        )}
        {panels.summary && (
          <Card title="What this view says" subtitle="Descriptive summary, not a causal explanation" testId="indicator-summary">
            <p className="text-xl font-semibold leading-snug text-slate-900">{v.overview.summary.statement}</p>
            <p className="mt-4 text-sm text-slate-600">{v.overview.summary.detail}</p>
          </Card>
        )}
      </div>
      {panels.definition && (
        <Card title="Definition and provenance" testId="indicator-definition">
          <DefinitionList lines={v.definition} />
        </Card>
      )}
    </div>
  );
}

function DefinitionList({ lines }: { lines: IndicatorAnalyticsReady["definition"] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-[12rem_minmax(0,1fr)]">
      {lines.map((d) => (
        <div key={d.label} className="contents">
          <dt className="font-medium text-slate-500">{d.label}</dt>
          <dd className="text-slate-800">{d.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TrendsView({ v }: { v: IndicatorAnalyticsReady }) {
  return (
    <div className="flex flex-col gap-4" data-testid="indicator-trends">
      <p className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-slate-700">
        <span className="font-semibold text-blue-700">Small multiples. </span>
        One indicator and one series ({v.series.chosenText || v.series.fixedText}) across areas, {v.axis.state === "calendar" ? "each on the same time axis and value axis." : `each on the same value axis. ${v.axis.reason}`} {v.trends.rule ?? ""}
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {v.trends.panels.map((p) => (
          <Card key={areaValue(p.areaCode)} title={p.name} subtitle={`${v.series.name}; ${v.series.percent ? "%" : v.series.unit}`} testId="indicator-trend-panel">
            {p.points.length > 0 ? <DotChart points={p.points} axis={v.axis} valueAxis={v.valueAxis} percent={v.series.percent} height={180} label={`Observed values for ${p.name}`} /> : <p className="text-sm text-slate-600">No observed value in this range.</p>}
            {p.withheld.length > 0 && <p className="mt-1 text-xs text-amber-800">Withheld as confidential: {p.withheld.join(", ")}</p>}
            <p className="mt-1 text-[11px] text-slate-500">Points show observed periods only.</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CompareView({ v }: { v: IndicatorAnalyticsReady }) {
  const c = v.compare;
  if (!c) return <p className="text-sm text-slate-600">No period has observations to compare.</p>;
  const max = Math.max(v.valueAxis.max, ...c.rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-4" data-testid="indicator-compare">
      <p className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-slate-700">
        <span className="font-semibold text-blue-700">Matched comparison. </span>
        Reference period {c.period}; the same indicator and series ({v.series.chosenText || v.series.fixedText}); not a league table of every country.
      </p>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title="Country comparison" subtitle={`${v.series.unit}; source reference period ${c.period}; areas observed in that period`}>
          <ol className="flex flex-col gap-2.5">
            {c.rows.map((r) => (
              <li key={areaValue(r.areaCode)} className="grid grid-cols-[minmax(6rem,10rem)_minmax(0,1fr)_5rem] items-center gap-3 text-sm">
                <span className={r.selected ? "font-semibold text-slate-900" : "text-slate-700"} title={r.note ?? undefined}>
                  {r.name}
                </span>
                <span className="h-2.5 rounded bg-slate-100">
                  <span className={`block h-2.5 rounded ${r.selected ? "bg-blue-600" : "bg-blue-300"}`} style={{ width: `${Math.max(0, (r.value / (max || 1)) * 100)}%` }} />
                </span>
                <span className="text-right font-semibold tabular-nums text-slate-900">{r.shown}</span>
              </li>
            ))}
          </ol>
          {c.withheld.length > 0 && <p className="mt-3 text-xs text-amber-800">Withheld as confidential for {c.period} (no value, never zero): {c.withheld.map((w) => w.name).join(", ")}</p>}
          <p className="mt-3 text-[11px] text-slate-500">
            {c.notObserved} other area{c.notObserved === 1 ? " has" : "s have"} values in this series but none for {c.period}; no nearby period is used. Survey labels:{" "}
            {c.rows.map((r) => `${r.name}: ${r.note ?? "not stated"}`).join("; ")}.
          </p>
        </Card>
        <div className="flex flex-col gap-5">
          <Card title="Comparison rules" subtitle="Visible safeguards, not hidden assumptions">
            <ul className="flex flex-col gap-2 text-xs text-slate-600">
              <li><span className="font-semibold text-slate-900">Common period only. </span>A missing {c.period} is not replaced with a nearby period.</li>
              <li><span className="font-semibold text-slate-900">Definition locked. </span>One series: its breakdowns, such as the reference window, are never mixed or averaged.</li>
              <li><span className="font-semibold text-slate-900">Survey context kept. </span>The reference period and the file&apos;s survey label are both shown.</li>
            </ul>
          </Card>
          <Card title="Selected observation" subtitle={`${v.filters.area.name}, ${c.period}`}>
            {c.selected ? (
              <>
                <p className="text-4xl font-bold text-slate-900">{c.selected.shown}</p>
                <p className="mt-1 text-sm text-blue-700">{c.selected.note ?? "No survey label in the file"}</p>
                <p className="mt-2 text-xs text-slate-500">{c.selected.statusLabel ?? "Status not stated"}. No sample size or uncertainty interval is supplied in this file.</p>
              </>
            ) : (
              <p className="text-sm text-slate-600">{v.filters.area.name} has no observation for {c.period}; no nearby period is used.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function SourcesView({ workspace, ready }: { workspace: Extract<IndicatorWorkspace, { state: "ready" }> | null; ready: IndicatorAnalyticsReady | null }) {
  return (
    <div className="flex flex-col gap-5" data-testid="indicator-sources">
      <Card title="Source readiness" subtitle="Providers share one workspace; readiness belongs to each imported file.">
        {workspace ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-2 pr-4 font-semibold">File</th>
                  <th className="py-2 pr-4 font-semibold">Provider (from the layout)</th>
                  <th className="py-2 pr-4 font-semibold">Available content</th>
                  <th className="py-2 pr-4 font-semibold">Dashboard status</th>
                  <th className="py-2 font-semibold">Next step</th>
                </tr>
              </thead>
              <tbody>
                {workspace.files.map((f) => (
                  <tr key={f.documentId} className="border-t border-slate-100">
                    <td className="py-2 pr-4 font-semibold text-slate-900">{f.fileName}</td>
                    <td className="py-2 pr-4">{f.provider ? { world_bank: "World Bank", oecd: "OECD", imf: "IMF", other: "Other" }[f.provider] : "Not known until read"}</td>
                    <td className="py-2 pr-4">{f.content}</td>
                    <td className={`py-2 pr-4 ${f.state === "observations_ready" ? "text-emerald-700" : f.state === "import_error" ? "text-red-700" : "text-slate-700"}`}>{f.status}</td>
                    <td className="py-2">{f.nextStep}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-slate-600">{workspace.providers.map((p) => p.text).join(". ")}.</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Loading...</p>
        )}
      </Card>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="How this dashboard was generated">
          <ol className="flex flex-col gap-2 text-xs text-slate-600">
            <li><span className="font-semibold text-slate-900">1 Read the file and recognise its layout. </span>Year columns become observations; reference information is kept as notes, never as values.</li>
            <li><span className="font-semibold text-slate-900">2 Resolve codes and breakdowns. </span>A series is the indicator with one code per breakdown; labels are presentation.</li>
            <li><span className="font-semibold text-slate-900">3 Check and choose defaults. </span>One unit per series; the first series and the area with the most observations, each stated.</li>
            <li><span className="font-semibold text-slate-900">4 Show and keep your choices. </span>Headline, trend, comparison and source details; your choices stay for this session.</li>
          </ol>
        </Card>
        <Card title="Coverage and trust" subtitle={ready ? `${ready.fileName}: this file, not the provider's whole coverage` : undefined}>
          {ready ? (
            <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-2 text-sm" data-testid="indicator-coverage">
              <dt className="text-2xl font-bold text-slate-900">{ready.coverage.areas}</dt>
              <dd className="self-center text-xs text-slate-500">areas</dd>
              <dt className="text-2xl font-bold text-slate-900">{ready.coverage.areaSeries}</dt>
              <dd className="self-center text-xs text-slate-500">distinct series by area (indicator, breakdowns and area)</dd>
              <dt className="text-2xl font-bold text-slate-900">{ready.coverage.observations}</dt>
              <dd className="self-center text-xs text-slate-500">observations; no observation key is stored twice</dd>
              <dt className="text-2xl font-bold text-slate-900">{ready.coverage.firstPeriod && ready.coverage.lastPeriod ? `${ready.coverage.firstPeriod} to ${ready.coverage.lastPeriod}` : "Not stated"}</dt>
              <dd className="self-center text-xs text-slate-500">observed period span</dd>
              <dt className="text-sm font-semibold text-slate-900">{ready.coverage.valueRange ? `${ready.coverage.valueRange[0]} to ${ready.coverage.valueRange[1]}` : "Not shown"}</dt>
              <dd className="self-center text-xs text-slate-500">{ready.coverage.valueRange ? "lowest and highest value as written" : "series in this file have different units, so no range across them"}</dd>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">Choose a file with observations.</p>
          )}
          <p className="mt-3 text-xs text-slate-500">No release vintage is supplied. The source metadata date, the observation period and the date this app read the file are kept apart.</p>
        </Card>
      </div>
      {ready && (
        <Card title="Definition and provenance of the selected series">
          <DefinitionList lines={ready.definition} />
        </Card>
      )}
    </div>
  );
}
