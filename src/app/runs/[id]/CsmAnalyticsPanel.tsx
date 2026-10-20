"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { loadVariablesAction } from "@/lib/crosstabActions";
import type { VariableInfo } from "@/lib/parseStatsFile";
import type { WaveFile } from "@/lib/waveTrackingActions";
import {
  buildCsmDashboardAction,
  buildCsmWaveDashboardsAction,
  loadCsmModuleAction,
  saveCsmModuleAction,
  addCsmFindingAction,
  removeCsmFindingAction,
  csmFindingStatusAction,
  type CsmDashboard,
  type CsmMapping,
  type CsmMetric,
  type CsmFindingSection,
} from "@/lib/csmActions";
import { defaultMetricForScale, metricLabel, csmFindingKey } from "@/lib/csmMetrics";

const METRICS: CsmMetric[] = ["mean", "top1", "top2", "top3"];

function usableFor(v: VariableInfo): boolean {
  return !v.weightLike && !v.text && v.nDistinct >= 2;
}

function segmentCandidate(v: VariableInfo): boolean {
  return usableFor(v) && v.nDistinct <= 12;
}

/**
 * The CSM Analytics module: pull overall satisfaction, attributes, an optional loyalty/NPS
 * question and an optional segmentation variable into one mapping, then get a dashboard
 * computed from that mapping, on this file or across every wave of it. The mapping is saved
 * per file so reopening the module doesn't mean re-dragging variables.
 */
export default function CsmAnalyticsPanel({
  runId,
  documentId,
  filename,
  waveFiles,
  onClose,
  closeLabel = "Close",
}: {
  runId: string;
  documentId: string;
  filename: string;
  waveFiles?: WaveFile[];
  onClose: () => void;
  /** "All analytics" when opened from the Analytics tool grid, which it returns to. */
  closeLabel?: string;
}) {
  const [variables, setVariables] = useState<VariableInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [overallVar, setOverallVar] = useState<string>("");
  const [overallMetric, setOverallMetric] = useState<CsmMetric | "">("");
  const [attributes, setAttributes] = useState<Map<string, CsmMetric | "">>(new Map());
  const [loyaltyVar, setLoyaltyVar] = useState<string>("");
  const [segmentVar, setSegmentVar] = useState<string>("");

  const [filter, setFilter] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const [acrossWaves, setAcrossWaves] = useState(false);
  const [busy, setBusy] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [dashboards, setDashboards] = useState<CsmDashboard[] | null>(null);
  const [activeWave, setActiveWave] = useState<number | "all">(0);

  useEffect(() => {
    let active = true;
    (async () => {
      const [vars, saved] = await Promise.all([loadVariablesAction(runId, documentId), loadCsmModuleAction(runId, documentId)]);
      if (!active) return;
      if (!vars.ok) {
        setLoadError(vars.error);
        return;
      }
      setVariables(vars.dictionary.variables);
      if (saved.ok && saved.mapping) {
        const m = saved.mapping;
        setOverallVar(m.overallVar ?? "");
        setOverallMetric(m.overallMetric ?? "");
        setAttributes(new Map(m.attributes.map((a) => [a.variable, a.metric ?? ""])));
        setLoyaltyVar(m.loyaltyVar ?? "");
        setSegmentVar(m.segmentVar ?? "");
      }
    })();
    return () => {
      active = false;
    };
  }, [runId, documentId]);

  const byName = useMemo(() => new Map(variables.map((v) => [v.name, v])), [variables]);
  const candidates = useMemo(
    () => variables.filter((v) => usableFor(v) && (!filter || `${v.name} ${v.label}`.toLowerCase().includes(filter.toLowerCase()))),
    [variables, filter],
  );
  const segmentCandidates = useMemo(() => variables.filter(segmentCandidate), [variables]);

  function toggleAttribute(name: string) {
    setAttributes((prev) => {
      const next = new Map(prev);
      if (next.has(name)) next.delete(name);
      else next.set(name, "");
      return next;
    });
  }

  function mapping(): CsmMapping {
    return {
      overallVar: overallVar || null,
      overallMetric: overallMetric || undefined,
      attributes: [...attributes.entries()].map(([variable, metric]) => ({ variable, metric: metric || undefined })),
      loyaltyVar: loyaltyVar || null,
      segmentVar: segmentVar || null,
    };
  }

  async function save() {
    setSaveStatus("saving");
    const res = await saveCsmModuleAction(runId, documentId, mapping());
    setSaveStatus(res.ok ? "saved" : "idle");
    if (res.ok) setTimeout(() => setSaveStatus("idle"), 1800);
  }

  async function build() {
    setBusy(true);
    setBuildError(null);
    setDashboards(null);
    const m = mapping();
    if (!m.overallVar && m.attributes.length === 0) {
      setBuildError("Map at least an overall satisfaction question or an attribute first.");
      setBusy(false);
      return;
    }
    const res =
      acrossWaves && (waveFiles?.length ?? 0) >= 2
        ? await buildCsmWaveDashboardsAction(runId, waveFiles!.map((w) => ({ documentId: w.documentId, label: w.wave })), m)
        : await buildCsmDashboardAction(runId, documentId, m);
    if (!res.ok) {
      setBuildError(res.error);
      setBusy(false);
      return;
    }
    setDashboards("dashboard" in res ? [res.dashboard] : res.dashboards);
    setActiveWave(0);
    setBusy(false);
    void save();
  }

  const active = dashboards && typeof activeWave === "number" ? dashboards[activeWave] ?? null : null;

  const body = (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-label="CSM Analytics">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-2.5">
        <div>
          <p className="text-sm font-semibold text-foreground">CSM Analytics</p>
          <p className="text-[11px] text-muted">{filename}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-slate-50">
          {closeLabel === "Close" ? "Close" : `← ${closeLabel}`}
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-r-2 border-sky-200 bg-sky-50 p-4 text-xs">
          {loadError && <p className="text-red-600">{loadError}</p>}
          {!variables.length && !loadError && <p className="text-muted">Loading the variable list...</p>}

          <section className="space-y-1.5">
            <p className="font-medium text-foreground">Overall satisfaction</p>
            <p className="text-[11px] text-muted">The single question the whole module reads as &ldquo;overall&rdquo;.</p>
            <select
              value={overallVar}
              onChange={(e) => setOverallVar(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs"
            >
              <option value="">None</option>
              {candidates.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.label || v.name}
                </option>
              ))}
            </select>
            {overallVar && (
              <select
                value={overallMetric}
                onChange={(e) => setOverallMetric(e.target.value as CsmMetric | "")}
                className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs"
              >
                <option value="">
                  Default ({metricLabel(defaultMetricForScale(byName.get(overallVar)?.nDistinct ?? 10))} for a{" "}
                  {byName.get(overallVar)?.nDistinct ?? "?"}-point scale)
                </option>
                {METRICS.map((m) => (
                  <option key={m} value={m}>
                    {metricLabel(m)}
                  </option>
                ))}
              </select>
            )}
          </section>

          <section className="flex min-h-0 flex-1 flex-col space-y-1.5">
            <p className="font-medium text-foreground">Attributes ({attributes.size})</p>
            <p className="text-[11px] text-muted">Pick the questions driver analysis and the scorecard read against overall satisfaction.</p>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search variables"
              className="w-full rounded-lg border border-border px-2 py-1.5 text-xs"
            />
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-lg border border-border bg-white p-1.5">
              {candidates.map((v) => {
                const checked = attributes.has(v.name);
                const metric = attributes.get(v.name) ?? "";
                return (
                  <div key={v.name} className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-50">
                    <input type="checkbox" checked={checked} onChange={() => toggleAttribute(v.name)} />
                    <span className="flex-1 truncate" title={v.label || v.name}>
                      {v.label || v.name}
                    </span>
                    {checked && (
                      <select
                        value={metric}
                        onChange={(e) =>
                          setAttributes((prev) => {
                            const next = new Map(prev);
                            next.set(v.name, e.target.value as CsmMetric | "");
                            return next;
                          })
                        }
                        className="rounded border border-border bg-white px-1 py-0.5 text-[11px]"
                        title={`Default: ${metricLabel(overallMetric || defaultMetricForScale(v.nDistinct))}${overallMetric ? " (matches overall satisfaction)" : ` for a ${v.nDistinct}-point scale`}`}
                      >
                        <option value="">Default ({metricLabel(overallMetric || defaultMetricForScale(v.nDistinct))})</option>
                        {METRICS.map((m) => (
                          <option key={m} value={m}>
                            {metricLabel(m)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-1.5">
            <p className="font-medium text-foreground">Loyalty / NPS (optional)</p>
            <select
              value={loyaltyVar}
              onChange={(e) => setLoyaltyVar(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs"
            >
              <option value="">None</option>
              {candidates.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.label || v.name}
                </option>
              ))}
            </select>
          </section>

          <section className="space-y-1.5">
            <p className="font-medium text-foreground">Segment by (optional)</p>
            <select
              value={segmentVar}
              onChange={(e) => setSegmentVar(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs"
            >
              <option value="">None</option>
              {segmentCandidates.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.label || v.name}
                </option>
              ))}
            </select>
          </section>

          {(waveFiles?.length ?? 0) >= 2 && (
            <section className="space-y-1.5">
              <label className="flex items-center gap-1.5 font-medium text-foreground">
                <input type="checkbox" checked={acrossWaves} onChange={(e) => setAcrossWaves(e.target.checked)} />
                Run across all {waveFiles!.length} waves
              </label>
              <p className="text-[11px] text-muted">Off: just this file ({filename}). On: every file labelled as a wave of this tracking study.</p>
            </section>
          )}

          <div className="mt-auto flex gap-2 pt-2">
            <button
              type="button"
              onClick={build}
              disabled={busy}
              className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-hover disabled:opacity-60"
            >
              {busy ? "Building..." : "Build dashboard"}
            </button>
            <button type="button" onClick={save} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-slate-50">
              {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save mapping"}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {buildError && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{buildError}</p>}
          {!dashboards && !buildError && (
            <p className="text-sm text-muted">Map the questions on the left, then build the dashboard.</p>
          )}
          {dashboards && dashboards.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setActiveWave("all")}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                  activeWave === "all" ? "border-primary bg-primary text-white" : "border-border text-muted hover:bg-slate-50"
                }`}
              >
                All waves
              </button>
              {dashboards.map((d, i) => (
                <button
                  key={d.documentId}
                  type="button"
                  onClick={() => setActiveWave(i)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                    i === activeWave ? "border-primary bg-primary text-white" : "border-border text-muted hover:bg-slate-50"
                  }`}
                >
                  {d.waveLabel || `Wave ${i + 1}`}
                </button>
              ))}
            </div>
          )}
          {dashboards && activeWave === "all" && <CsmWaveTrends dashboards={dashboards} />}
          {active && <CsmScorecard runId={runId} documentId={active.documentId} dashboard={active} />}
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

/** A small commit toggle for one section of the dashboard, mirroring the "Post to findings" pattern the chart/NPS/wave tools already use. */
function CsmFindingButton({ runId, documentId, dashboard, section }: { runId: string; documentId: string; dashboard: CsmDashboard; section: CsmFindingSection }) {
  const [committed, setCommitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = csmFindingKey(dashboard, section);

  useEffect(() => {
    let active = true;
    if (!key) return;
    (async () => {
      const res = await csmFindingStatusAction(runId, documentId, section, key, dashboard.segmentVar);
      if (active && res.ok) setCommitted(res.committed);
    })();
    return () => {
      active = false;
    };
  }, [runId, documentId, section, key, dashboard.segmentVar]);

  if (!key) return null;

  async function toggle() {
    setBusy(true);
    const res = committed
      ? await removeCsmFindingAction(runId, documentId, section, key!, dashboard.segmentVar)
      : await addCsmFindingAction(runId, documentId, dashboard, section);
    if (res.ok) setCommitted(!committed);
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60 ${
        committed ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-border text-muted hover:bg-slate-50"
      }`}
    >
      {committed ? "In findings" : "Post to findings"}
    </button>
  );
}

function CsmScorecard({ runId, documentId, dashboard }: { runId: string; documentId: string; dashboard: CsmDashboard }) {
  const maxAttr = Math.max(1, ...dashboard.attributes.map((a) => a.overall ?? 0));
  const driverShareByVar = new Map((dashboard.driver?.result.rows ?? []).map((r) => [r.name, r.share * 100] as const));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {dashboard.overall && (
          <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Overall satisfaction</div>
              <CsmFindingButton runId={runId} documentId={documentId} dashboard={dashboard} section="overall" />
            </div>
            <div className="mt-1 text-3xl font-bold text-foreground">
              {dashboard.overall.overall === null ? "-" : dashboard.overall.overall}
              {dashboard.overall.metric !== "mean" && dashboard.overall.overall !== null ? "%" : ""}
            </div>
            <div className="text-[11px] text-muted">
              {metricLabel(dashboard.overall.metric)} &middot; n={dashboard.overall.n.toLocaleString()} &middot;{" "}
              {dashboard.weighted ? "weighted" : "unweighted"}
            </div>
          </div>
        )}
        {dashboard.loyalty && (
          <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Net Promoter Score</div>
              <CsmFindingButton runId={runId} documentId={documentId} dashboard={dashboard} section="loyalty" />
            </div>
            <div className="mt-1 text-3xl font-bold text-foreground">{Math.round(dashboard.loyalty.nps)}</div>
            <div className="text-[11px] text-muted">
              {Math.round(dashboard.loyalty.promoters)}% promoters, {Math.round(dashboard.loyalty.detractors)}% detractors &middot; n=
              {dashboard.loyalty.n.toLocaleString()}
            </div>
          </div>
        )}
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Attributes mapped</div>
          <div className="mt-1 text-3xl font-bold text-foreground">{dashboard.attributes.length}</div>
          <div className="text-[11px] text-muted">{dashboard.driver ? "Ranked by driver analysis below" : "Add 2 or more to see a driver ranking"}</div>
        </div>
      </div>

      {dashboard.failedAttributes.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-medium">
            {dashboard.failedAttributes.length} mapped attribute{dashboard.failedAttributes.length === 1 ? "" : "s"} could not be tabulated and {dashboard.failedAttributes.length === 1 ? "is" : "are"} missing from this dashboard (including any driver analysis below):
          </p>
          <ul className="mt-1 list-disc pl-4">
            {dashboard.failedAttributes.map((a) => (
              <li key={a.variable}>
                {a.label}: {a.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {dashboard.attributes.length > 0 && (
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">Attributes</p>
            <div className="flex items-center gap-2">
              {dashboard.driver && <CsmFindingButton runId={runId} documentId={documentId} dashboard={dashboard} section="driver" />}
              <CsmFindingButton runId={runId} documentId={documentId} dashboard={dashboard} section="attributes" />
            </div>
          </div>
          <div className="space-y-1.5">
            {[...dashboard.attributes]
              .sort((a, b) => (driverShareByVar.get(b.label) ?? 0) - (driverShareByVar.get(a.label) ?? 0))
              .map((a) => {
                const share = driverShareByVar.get(a.label);
                const widthPct = a.overall === null ? 0 : a.metric === "mean" ? Math.min(100, (a.overall / maxAttr) * 100) : a.overall;
                return (
                  <div key={a.variable} className="flex items-center gap-2 text-xs">
                    <span className="w-48 truncate text-foreground" title={a.label}>
                      {a.label}
                    </span>
                    <div className="relative h-5 flex-1 overflow-hidden rounded bg-slate-100">
                      <div className="absolute inset-y-0 left-0 rounded bg-primary/70" style={{ width: `${widthPct}%` }} />
                    </div>
                    <span className="w-20 text-right font-medium text-foreground">
                      {a.overall === null ? "-" : a.overall}
                      {a.metric !== "mean" ? "%" : ""}
                    </span>
                    <span className="w-16 text-right text-[11px] text-muted">{metricLabel(a.metric)}</span>
                    {share !== undefined && <span className="w-16 text-right text-[11px] text-muted">{Math.round(share)}% driver</span>}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {dashboard.driver && dashboard.driver.result.rows.length >= 3 && (
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <p className="mb-2 text-sm font-semibold text-foreground">Importance against performance</p>
          <QuadrantLegend />
          <MiniQuadrant driver={dashboard.driver} size="lg" />
        </div>
      )}

      {dashboard.segmentLabel && dashboard.segments.length > 0 && (
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <p className="mb-2 text-sm font-semibold text-foreground">By {dashboard.segmentLabel}</p>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 text-xs">
              <thead>
                <tr>
                  <th className="text-left text-[11px] font-medium uppercase text-muted">&nbsp;</th>
                  {dashboard.segments.map((s) => (
                    <th key={s} className="px-2 text-center text-[11px] font-medium uppercase text-muted">
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dashboard.overall && (
                  <tr>
                    <td className="font-medium text-foreground">Overall satisfaction</td>
                    {dashboard.overall.bySegment.map((s) => (
                      <td key={s.name} className="rounded bg-slate-50 px-2 py-1.5 text-center font-semibold text-foreground">
                        {s.value === null ? "-" : s.value}
                        {dashboard.overall!.metric !== "mean" ? "%" : ""}
                      </td>
                    ))}
                  </tr>
                )}
                {dashboard.attributes.map((a) => (
                  <tr key={a.variable}>
                    <td className="truncate text-foreground" title={a.label}>
                      {a.label}
                    </td>
                    {a.bySegment.map((s) => (
                      <td key={s.name} className="rounded bg-slate-50 px-2 py-1.5 text-center text-foreground">
                        {s.value === null ? "-" : s.value}
                        {a.metric !== "mean" ? "%" : ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** One line per wave for a single metric, e.g. overall satisfaction or NPS: thin line, 8px markers, direct value
 * labels, a single y-axis, matching the dataviz rule against ever running two scales on one chart. */
function TrendLine({ title, points, suffix }: { title: string; points: { label: string; value: number | null }[]; suffix?: string }) {
  const have = points.filter((p): p is { label: string; value: number } => p.value !== null);
  if (have.length < 2) return null;
  const W = 560;
  const H = 150;
  const pad = { l: 36, r: 20, t: 16, b: 26 };
  const vMin = Math.min(...have.map((p) => p.value));
  const vMax = Math.max(...have.map((p) => p.value));
  const vSpan = vMax - vMin || 1;
  const yLo = vMin - vSpan * 0.15;
  const yHi = vMax + vSpan * 0.15;
  const sx = (i: number) => pad.l + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - pad.l - pad.r));
  const sy = (v: number) => H - pad.b - ((v - yLo) / (yHi - yLo || 1)) * (H - pad.t - pad.b);
  const linePts = points
    .map((p, i) => ({ ...p, x: sx(i) }))
    .filter((p): p is { label: string; value: number; x: number } => p.value !== null);
  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <p className="mb-2 text-sm font-semibold text-foreground">{title}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
        <polyline
          points={linePts.map((p) => `${p.x},${sy(p.value)}`).join(" ")}
          fill="none"
          stroke="#2563eb"
          strokeWidth={2}
          strokeLinecap="round"
        />
        {linePts.map((p) => (
          <g key={p.label}>
            <circle cx={p.x} cy={sy(p.value)} r={4} fill="#2563eb" />
            <text x={p.x} y={sy(p.value) - 9} fontSize={11} fontWeight={700} textAnchor="middle" fill="#0f172a">
              {Math.round(p.value * 10) / 10}
              {suffix ?? ""}
            </text>
            <text x={p.x} y={H - 8} fontSize={10} textAnchor="middle" fill="#64748b">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Predictor rows against wave columns, mirroring WaveTrackingPanel's DriverWaveTable so the same share-with-a-
 * data-bar reading applies here, built straight from each wave's own driver report rather than a shared type. */
function CsmDriverWaveTable({ dashboards }: { dashboards: CsmDashboard[] }) {
  const withDriver = dashboards.filter((d) => d.driver);
  if (withDriver.length === 0) return null;
  const names = Array.from(new Set(withDriver.flatMap((d) => d.driver!.result.rows.map((r) => r.name))));
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border bg-slate-50">
            <th className="px-2.5 py-2 text-left font-medium text-muted">Predictor</th>
            {dashboards.map((d, i) => (
              <th key={d.documentId} className="px-2.5 py-2 text-right font-medium text-muted">
                {d.waveLabel || `Wave ${i + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {names.map((name, i) => {
            const shares = dashboards.map((d) => {
              const row = d.driver?.result.rows.find((r) => r.name === name);
              return row ? Math.round(row.share * 100) : null;
            });
            const present = shares.filter((v): v is number => v !== null);
            const rowMax = Math.max(1, ...present);
            return (
              <tr key={name} className={i % 2 === 1 ? "bg-slate-50/60" : undefined}>
                <td className="max-w-[18rem] truncate px-2.5 py-1.5 font-medium text-foreground" title={name}>
                  {name}
                </td>
                {shares.map((share, j) => (
                  <td key={j} className="relative px-2.5 py-1.5 text-right">
                    {share !== null && (
                      <div
                        className="absolute inset-y-1.5 left-1 rounded bg-primary/10"
                        style={{ width: `${Math.max(3, (share / rowMax) * 100)}%` }}
                      />
                    )}
                    <span className="relative font-medium text-foreground">{share !== null ? `${share}%` : "–"}</span>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Shared legend for the MiniQuadrant grid below: one legend for the whole small-multiples set rather than
 * one per chart, since every wave's quadrant uses the same four colors for the same meaning. Keeps identity
 * off color alone, per the dataviz rule, without repeating the same four labels three or four times over. */
const QUADRANT_LEGEND_ITEMS: { color: string; label: string }[] = [
  { color: "#dc2626", label: "Important weakness" },
  { color: "#16a34a", label: "Important strength" },
  { color: "#ca8a04", label: "Unimportant weakness" },
  { color: "#2563eb", label: "Unimportant strength" },
];

function QuadrantLegend() {
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {QUADRANT_LEGEND_ITEMS.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** A compact, read-only importance-against-performance quadrant, the same split Quadrant in AnalyticsBuilder
 * draws for the single-file driver tool, without its editing chrome. `size="sm"` is for the small-multiples
 * wave grid; `size="lg"` is for showing a single wave's quadrant on its own, with room for point labels. */
function MiniQuadrant({
  label,
  driver,
  size = "sm",
}: {
  label?: string;
  driver: NonNullable<CsmDashboard["driver"]>;
  size?: "sm" | "lg";
}) {
  const rows = driver.result.rows.map((r) => {
    const p = driver.performance.find((x) => x.name === r.name);
    return { name: r.name, importance: r.share, perf: p?.topTwo ?? null, mean: p?.mean ?? null };
  });
  const useTop = rows.filter((r) => r.perf !== null).length >= Math.ceil(rows.length / 2);
  const pts = rows
    .map((r) => ({ name: r.name, x: useTop ? r.perf : r.mean, y: r.importance }))
    .filter((p): p is { name: string; x: number; y: number } => p.x !== null);
  if (pts.length < 3) return null;
  const big = size === "lg";
  // "sm" still gets its own label column, just a narrower one with shorter, smaller text: without this a
  // small-multiples quadrant is unreadable (every dot looks the same), which is the gap this fixes.
  const W = big ? 560 : 260;
  const H = big ? 320 : 200;
  const pad = big ? { l: 16, r: 110, t: 16, b: 16 } : { l: 6, r: 72, t: 6, b: 6 };
  const xsRaw = pts.map((p) => p.x);
  const xMinRaw = Math.min(...xsRaw);
  const xMaxRaw = Math.max(...xsRaw);
  const xPad = (xMaxRaw - xMinRaw || 1) * 0.12;
  const xMin = xMinRaw - xPad;
  const xMax = xMaxRaw + xPad;
  const xSpan = xMax - xMin || 1;
  const yMaxRaw = Math.max(...pts.map((p) => p.y)) || 1;
  const yMax = yMaxRaw * 1.15;
  const sx = (v: number) => pad.l + ((v - xMin) / xSpan) * (W - pad.l - pad.r);
  const sy = (v: number) => H - pad.b - (v / yMax) * (H - pad.t - pad.b);
  const medX = [...xsRaw].sort((a, b) => a - b)[Math.floor(xsRaw.length / 2)];
  const medY = 1 / pts.length;
  const colorOf = (p: { x: number; y: number }) =>
    p.y >= medY ? (p.x < medX ? "#dc2626" : "#16a34a") : p.x < medX ? "#ca8a04" : "#2563eb";
  // Labels sit to the right of their point, stacked top to bottom in y order and nudged apart on a close
  // clash. The row gap and the truncation length just shrink for the small-multiples size.
  const rowGap = big ? 13 : 10;
  const labelRows = [...pts]
    .sort((a, b) => sy(a.y) - sy(b.y))
    .reduce<{ p: (typeof pts)[number]; y: number }[]>((acc, p) => {
      let y = sy(p.y);
      const prev = acc[acc.length - 1];
      if (prev && y - prev.y < rowGap) y = prev.y + rowGap;
      acc.push({ p, y });
      return acc;
    }, []);
  const maxNameLen = big ? 22 : 13;
  const fontSize = big ? 10.5 : 8.5;
  return (
    <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
      {label && <p className="mb-1.5 text-[11px] font-semibold text-foreground">{label}</p>}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
        <line x1={pad.l} y1={sy(medY)} x2={W - pad.r} y2={sy(medY)} stroke="#e2e8f0" strokeWidth={1} />
        <line x1={sx(medX)} y1={pad.t} x2={sx(medX)} y2={H - pad.b} stroke="#e2e8f0" strokeWidth={1} />
        {pts.map((p) => (
          <circle key={p.name} cx={sx(p.x)} cy={sy(p.y)} r={big ? 5 : 4} fill={colorOf(p)} />
        ))}
        {labelRows.map(({ p, y }) => (
          <g key={p.name}>
            <line x1={sx(p.x) + 6} y1={sy(p.y)} x2={W - pad.r + 4} y2={y} stroke="#cbd5e1" strokeWidth={1} />
            <text x={W - pad.r + 6} y={y + 3} fontSize={fontSize} fill="#334155">
              {p.name.length > maxNameLen ? `${p.name.slice(0, maxNameLen - 1)}…` : p.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/**
 * The "All waves" view: everything CsmScorecard shows per wave, laid side by side instead, so a trend across
 * baseline/wave 2/wave 3/... reads at a glance rather than tab by tab. Pulls straight from the same
 * CsmDashboard[] the per-wave tabs already have, no new data fetch.
 */
function CsmWaveTrends({ dashboards }: { dashboards: CsmDashboard[] }) {
  const labels = dashboards.map((d, i) => d.waveLabel || `Wave ${i + 1}`);
  const overallMetric = dashboards.find((d) => d.overall)?.overall?.metric;
  const overallPoints = dashboards.map((d, i) => ({ label: labels[i], value: d.overall?.overall ?? null }));
  const npsPoints = dashboards.map((d, i) => ({ label: labels[i], value: d.loyalty?.nps ?? null }));
  const attrNames = Array.from(new Set(dashboards.flatMap((d) => d.attributes.map((a) => a.variable))));
  const withDriver = dashboards.filter((d) => d.driver && d.driver.result.rows.length >= 3);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TrendLine
          title={`Overall satisfaction across waves${overallMetric ? ` (${metricLabel(overallMetric)})` : ""}`}
          points={overallPoints}
          suffix={overallMetric && overallMetric !== "mean" ? "%" : ""}
        />
        <TrendLine title="Net Promoter Score across waves" points={npsPoints} />
      </div>

      {attrNames.length > 0 && (
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <p className="mb-2 text-sm font-semibold text-foreground">Attributes across waves</p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-slate-50">
                  <th className="px-2.5 py-2 text-left font-medium text-muted">Attribute</th>
                  {dashboards.map((d, i) => (
                    <th key={d.documentId} className="px-2.5 py-2 text-right font-medium text-muted">
                      {labels[i]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attrNames.map((variable, i) => {
                  const match = dashboards
                    .map((d) => d.attributes.find((a) => a.variable === variable))
                    .find((a): a is NonNullable<typeof a> => !!a);
                  const label = match?.label ?? variable;
                  return (
                    <tr key={variable} className={i % 2 === 1 ? "bg-slate-50/60" : undefined}>
                      <td className="max-w-[18rem] truncate px-2.5 py-1.5 font-medium text-foreground" title={label}>
                        {label}
                        {match && <span className="ml-1.5 font-normal text-muted">({metricLabel(match.metric)})</span>}
                      </td>
                      {dashboards.map((d) => {
                        const a = d.attributes.find((x) => x.variable === variable);
                        return (
                          <td key={d.documentId} className="px-2.5 py-1.5 text-right font-medium text-foreground">
                            {a && a.overall !== null ? `${a.overall}${a.metric !== "mean" ? "%" : ""}` : "–"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {withDriver.length > 0 && (
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <p className="mb-2 text-sm font-semibold text-foreground">Driver performance across waves</p>
          <CsmDriverWaveTable dashboards={dashboards} />
        </div>
      )}

      {withDriver.length > 0 && (
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <p className="mb-2 text-sm font-semibold text-foreground">Importance against performance, by wave</p>
          <QuadrantLegend />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {withDriver.map((d) => (
              <MiniQuadrant key={d.documentId} label={d.waveLabel || `Wave ${dashboards.indexOf(d) + 1}`} driver={d.driver!} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
