"use client";

import { useEffect, useState } from "react";
import {
  listWaveFilesAction,
  sharedWaveVariablesAction,
  runWaveChartAction,
  runWaveNpsAction,
  runWaveDriverAction,
  addWaveChartFindingAction,
  removeWaveChartFindingAction,
  waveChartFindingStatusAction,
  addWaveNpsFindingAction,
  removeWaveNpsFindingAction,
  waveNpsFindingStatusAction,
  addWaveDriverFindingAction,
  removeWaveDriverFindingAction,
  waveDriverFindingStatusAction,
  type WaveFile,
  type WaveDriverTable,
} from "@/lib/waveTrackingActions";
import type { ChartResult } from "@/lib/chartActions";
import type { NpsResult } from "@/lib/npsActions";
import type { DriverReport } from "@/lib/drivers";
import ChartVisual, { SERIES_COLORS } from "./ChartVisual";
import { NpsWaveCards } from "./NpsVisual";
import { ChartCustomizePanel, type LegendPos } from "./ChartCustomize";
import { ReportView, SegmentTabs, driverReportForSegment } from "./AnalyticsBuilder";

type ChartCard = {
  id: string;
  result: ChartResult;
  committed: boolean;
  commitBusy: boolean;
  title: string;
  colors: string[];
  legendPos: LegendPos;
};

type NpsCard = { id: string; result: NpsResult; committed: boolean; commitBusy: boolean };
type DriverCard = { id: string; table: WaveDriverTable; committed: boolean; commitBusy: boolean };

/**
 * One row per predictor, one column per wave: the share each predictor carries of the explained outcome,
 * read as a table rather than a grouped bar chart so every wave's figure for one predictor lines up for
 * direct comparison. A light "data bar" behind each number, scaled to that row's own largest share, keeps
 * the relative size scannable without turning it back into a chart.
 */
function DriverWaveTable({ table }: { table: WaveDriverTable }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border bg-slate-50">
            <th className="px-2.5 py-2 text-left font-medium text-muted">Predictor</th>
            {table.waves.map((w) => (
              <th key={w.name} className="px-2.5 py-2 text-right font-medium text-muted">
                <div className="truncate text-foreground" title={w.name}>
                  {w.name}
                </div>
                <div className="text-[10px] font-normal text-muted">n = {w.n.toLocaleString()}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => {
            const present = row.shares.filter((v): v is number => v !== null);
            const rowMax = Math.max(1, ...present);
            return (
              <tr key={row.name} className={i % 2 === 1 ? "bg-slate-50/60" : undefined}>
                <td className="max-w-[18rem] truncate px-2.5 py-1.5 font-medium text-foreground" title={row.name}>
                  {row.name}
                </td>
                {row.shares.map((share, j) => (
                  <td key={j} className="relative px-2.5 py-1.5 text-right">
                    {share !== null && (
                      <div
                        className="absolute inset-y-1.5 left-1 rounded bg-primary/10"
                        style={{ width: `${Math.max(3, (share / rowMax) * 100)}%` }}
                      />
                    )}
                    <span className="relative font-medium text-foreground">{share !== null ? `${share}%` : "\u2013"}</span>
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

/**
 * Compares the same question across the files in this project that have been labelled as waves of one
 * tracking study (set per file under Import data). Reads each wave's own file separately with the same
 * distribution/NPS tools the single-file Analytics panels use, then lines the results up side by side, one
 * series or segment per wave, rather than computing anything new. Lives once per project, not once per
 * file: a wave comparison spans several files by definition.
 */
export default function WaveTrackingPanel({ runId }: { runId: string }) {
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<WaveFile[]>([]);
  const [variables, setVariables] = useState<{ name: string; label: string }[]>([]);
  const [weights, setWeights] = useState<{ name: string; label: string }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [mode, setMode] = useState<"chart" | "nps" | "driver">("chart");
  const [variable, setVariable] = useState("");
  const [filter, setFilter] = useState("");
  const [weightVar, setWeightVar] = useState("");
  const [busy, setBusy] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const [outcome, setOutcome] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [outcomeType, setOutcomeType] = useState<"continuous" | "binary">("continuous");
  const [topBoxMin, setTopBoxMin] = useState("");
  const [predictors, setPredictors] = useState<Set<string>>(new Set());
  const [predFilter, setPredFilter] = useState("");

  const [charts, setCharts] = useState<ChartCard[]>([]);
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
  const [npsCards, setNpsCards] = useState<NpsCard[]>([]);
  const [driverGroupVar, setDriverGroupVar] = useState("");
  const [driverCards, setDriverCards] = useState<DriverCard[]>([]);
  const [driverReportsByCard, setDriverReportsByCard] = useState<Record<string, { wave: string; report: DriverReport }[]>>({});
  const [driverTabByCard, setDriverTabByCard] = useState<Record<string, string>>({});
  const [driverSegByCard, setDriverSegByCard] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await listWaveFilesAction(runId);
      if (cancelled) return;
      if (!r.ok) {
        setLoadError(r.error);
        setLoading(false);
        return;
      }
      setFiles(r.files);
      if (r.files.length >= 2) {
        const v = await sharedWaveVariablesAction(
          runId,
          r.files.map((f) => f.documentId),
        );
        if (!cancelled && v.ok) {
          setVariables(v.variables);
          setWeights(v.weights);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  async function build() {
    if (mode === "driver") {
      if (!outcome || predictors.size === 0) return;
      setBusy(true);
      setBuildError(null);
      const r = await runWaveDriverAction(runId, files, {
        outcome,
        outcomeType,
        topBoxMin: topBoxMin ? Number(topBoxMin) : null,
        predictors: Array.from(predictors),
        weightVar: weightVar || null,
        groupVar: driverGroupVar || null,
      });
      setBusy(false);
      if (!r.ok) {
        setBuildError(r.error);
        return;
      }
      const status = await waveDriverFindingStatusAction(runId, r.table.outcome);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setDriverCards((prev) => [...prev, { id, table: r.table, committed: status.ok ? status.committed : false, commitBusy: false }]);
      setDriverReportsByCard((prev) => ({ ...prev, [id]: r.perWave }));
      setDriverTabByCard((prev) => ({ ...prev, [id]: r.perWave[r.perWave.length - 1]?.wave ?? "" }));
      setDriverSegByCard((prev) => ({ ...prev, [id]: null }));
      return;
    }
    if (!variable) return;
    setBusy(true);
    setBuildError(null);
    if (mode === "chart") {
      const r = await runWaveChartAction(runId, files, variable, weightVar || null);
      setBusy(false);
      if (!r.ok) {
        setBuildError(r.error);
        return;
      }
      const status = await waveChartFindingStatusAction(runId, r.result.variable);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setCharts((prev) => [
        ...prev,
        {
          id,
          result: r.result,
          committed: status.ok ? status.committed : false,
          commitBusy: false,
          title: r.result.label,
          colors: r.result.series.map((_, i) => SERIES_COLORS[i % SERIES_COLORS.length]),
          legendPos: "top",
        },
      ]);
      setSelectedChartId(id);
    } else {
      const r = await runWaveNpsAction(runId, files, variable, weightVar || null);
      setBusy(false);
      if (!r.ok) {
        setBuildError(r.error);
        return;
      }
      const status = await waveNpsFindingStatusAction(runId, r.result.variable);
      setNpsCards((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          result: r.result,
          committed: status.ok ? status.committed : false,
          commitBusy: false,
        },
      ]);
    }
  }

  function removeChartCard(cardId: string) {
    setCharts((prev) => prev.filter((c) => c.id !== cardId));
    setSelectedChartId((prev) => (prev === cardId ? null : prev));
  }
  function updateChartCard(cardId: string, patch: Partial<ChartCard>) {
    setCharts((prev) => prev.map((c) => (c.id === cardId ? { ...c, ...patch } : c)));
  }
  async function toggleChartCommit(cardId: string) {
    const card = charts.find((c) => c.id === cardId);
    if (!card) return;
    setCharts((prev) => prev.map((c) => (c.id === cardId ? { ...c, commitBusy: true } : c)));
    if (card.committed) {
      const r = await removeWaveChartFindingAction(runId, card.result.variable);
      if (r.ok) {
        setCharts((prev) => prev.map((c) => (c.id === cardId ? { ...c, committed: false, commitBusy: false } : c)));
        setMessage("Took the finding out of use.");
      } else {
        setError(r.error);
        setCharts((prev) => prev.map((c) => (c.id === cardId ? { ...c, commitBusy: false } : c)));
      }
      return;
    }
    const r = await addWaveChartFindingAction(runId, card.result);
    if (r.ok) {
      setCharts((prev) => prev.map((c) => (c.id === cardId ? { ...c, committed: true, commitBusy: false } : c)));
      setMessage("Added to findings.");
    } else {
      setError(r.error);
      setCharts((prev) => prev.map((c) => (c.id === cardId ? { ...c, commitBusy: false } : c)));
    }
  }

  function removeDriverCard(cardId: string) {
    setDriverCards((prev) => prev.filter((c) => c.id !== cardId));
    setDriverReportsByCard((prev) => {
      const { [cardId]: _drop, ...rest } = prev;
      return rest;
    });
    setDriverTabByCard((prev) => {
      const { [cardId]: _drop, ...rest } = prev;
      return rest;
    });
    setDriverSegByCard((prev) => {
      const { [cardId]: _drop, ...rest } = prev;
      return rest;
    });
  }
  async function toggleDriverCommit(cardId: string) {
    const card = driverCards.find((c) => c.id === cardId);
    if (!card) return;
    setDriverCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, commitBusy: true } : c)));
    if (card.committed) {
      const r = await removeWaveDriverFindingAction(runId, card.table.outcome);
      if (r.ok) {
        setDriverCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, committed: false, commitBusy: false } : c)));
        setMessage("Took the finding out of use.");
      } else {
        setError(r.error);
        setDriverCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, commitBusy: false } : c)));
      }
      return;
    }
    const r = await addWaveDriverFindingAction(runId, card.table);
    if (r.ok) {
      setDriverCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, committed: true, commitBusy: false } : c)));
      setMessage("Added to findings.");
    } else {
      setError(r.error);
      setDriverCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, commitBusy: false } : c)));
    }
  }

  function removeNpsCard(cardId: string) {
    setNpsCards((prev) => prev.filter((c) => c.id !== cardId));
  }
  async function toggleNpsCommit(cardId: string) {
    const card = npsCards.find((c) => c.id === cardId);
    if (!card) return;
    setNpsCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, commitBusy: true } : c)));
    if (card.committed) {
      const r = await removeWaveNpsFindingAction(runId, card.result.variable);
      if (r.ok) {
        setNpsCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, committed: false, commitBusy: false } : c)));
        setMessage("Took the finding out of use.");
      } else {
        setError(r.error);
        setNpsCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, commitBusy: false } : c)));
      }
      return;
    }
    const r = await addWaveNpsFindingAction(runId, card.result);
    if (r.ok) {
      setNpsCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, committed: true, commitBusy: false } : c)));
      setMessage("Added to findings.");
    } else {
      setError(r.error);
      setNpsCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, commitBusy: false } : c)));
    }
  }

  if (loading) return <p className="text-sm text-muted">Loading...</p>;
  if (loadError) return <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{loadError}</p>;

  if (files.length < 2) {
    return (
      <div className="max-w-xl space-y-2 text-sm">
        <p className="text-muted">
          Compare the same question across waves of a tracking study, once at least two raw data files are labelled as
          waves.
        </p>
        <p className="text-muted">
          Open <span className="font-medium text-foreground">Import data</span>, and under each file&apos;s set-up, give it
          a <span className="font-medium text-foreground">Wave</span> label such as &quot;Wave 1&quot; or
          &quot;Baseline&quot;.{" "}
          {files.length === 1 ? "One file is labelled so far." : "No files are labelled yet."}
        </p>
      </div>
    );
  }

  const filteredVars = variables.filter((v) => {
    const s = filter.trim().toLowerCase();
    return !s || v.name.toLowerCase().includes(s) || v.label.toLowerCase().includes(s);
  });

  return (
    <div className="max-w-7xl space-y-4 rounded-xl bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Wave tracking</p>
          <p className="text-[11px] text-muted">Score, distribution and driver-weight comparisons across this project&apos;s labelled waves.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted">Waves tracked</p>
          <p className="text-xl font-semibold text-foreground">{files.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted">Earliest wave</p>
          <p className="truncate text-sm font-semibold text-foreground" title={files[0]?.wave}>{files[0]?.wave ?? "-"}</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted">Latest wave</p>
          <p className="truncate text-sm font-semibold text-foreground" title={files[files.length - 1]?.wave}>
            {files[files.length - 1]?.wave ?? "-"}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted">Shared questions</p>
          <p className="text-xl font-semibold text-foreground">{variables.length}</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-white p-3 text-xs shadow-sm">
        <p className="mb-1.5 font-medium text-foreground">Files, oldest upload first</p>
        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-muted">
          {files.map((f, i) => (
            <li key={f.documentId}>
              {i + 1}. <span className="font-medium text-foreground">{f.wave}</span> ({f.filename})
            </li>
          ))}
        </ol>
      </div>

      {error && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 shadow-sm">{error}</p>}
      {message && <p className="text-xs text-muted">{message}</p>}

<div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-white p-2 text-xs shadow-sm">
        <div className="flex rounded-md border border-border p-0.5">
          <button
            type="button"
            onClick={() => setMode("chart")}
            className={`rounded px-2.5 py-1 font-medium ${mode === "chart" ? "bg-primary text-white" : "text-muted hover:bg-slate-50"}`}
          >
            Distribution
          </button>
          <button
            type="button"
            onClick={() => setMode("nps")}
            className={`rounded px-2.5 py-1 font-medium ${mode === "nps" ? "bg-primary text-white" : "text-muted hover:bg-slate-50"}`}
          >
            NPS
          </button>
          <button
            type="button"
            onClick={() => setMode("driver")}
            className={`rounded px-2.5 py-1 font-medium ${mode === "driver" ? "bg-primary text-white" : "text-muted hover:bg-slate-50"}`}
          >
            Driver weights
          </button>
        </div>
      </div>

      <div className={mode === "driver" ? "grid grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start" : "space-y-4"}>
        <div className={mode === "driver" ? "space-y-3" : ""}>
          {mode === "driver" ? (
            <>
              <div className="space-y-3 rounded-xl border border-border bg-white p-3 text-xs shadow-sm">
                <section className="space-y-1.5">
              <p className="font-medium text-foreground">Outcome</p>
              <input
                value={outcomeFilter}
                onChange={(e) => setOutcomeFilter(e.target.value)}
                placeholder="Search variables"
                className="w-full rounded border border-border px-2 py-1"
              />
              <select
                size={12}
                value={outcome}
                onChange={(e) => {
                  setOutcome(e.target.value);
                  setPredictors((p) => {
                    const n = new Set(p);
                    n.delete(e.target.value);
                    return n;
                  });
                }}
                className="w-full rounded border border-border px-1 py-1"
                aria-label="Outcome variable"
              >
                {variables
                  .filter((v) => {
                    const s = outcomeFilter.trim().toLowerCase();
                    return !s || v.name.toLowerCase().includes(s) || v.label.toLowerCase().includes(s);
                  })
                  .map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}: {v.label}
                    </option>
                  ))}
              </select>
              <div className="space-y-1">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={outcomeType === "continuous"} onChange={() => setOutcomeType("continuous")} />
                  Score (use the average)
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={outcomeType === "binary"} onChange={() => setOutcomeType("binary")} />
                  Top box (yes or no)
                </label>
                {outcomeType === "binary" && (
                  <label className="ml-5 flex items-center gap-1.5">
                    Top box starts at code
                    <input
                      value={topBoxMin}
                      onChange={(e) => setTopBoxMin(e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder="top two"
                      className="w-20 rounded border border-border px-1.5 py-0.5"
                    />
                  </label>
                )}
              </div>
            </section>
                <section className="space-y-1.5">
              <p className="font-medium text-foreground">
                Predictors <span className="font-normal text-muted">({predictors.size} chosen)</span>
              </p>
              <input
                value={predFilter}
                onChange={(e) => setPredFilter(e.target.value)}
                placeholder="Search variables"
                className="w-full rounded border border-border px-2 py-1"
              />
              <div className="flex gap-2 text-[11px]">
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() =>
                    setPredictors(
                      (p) =>
                        new Set([
                          ...p,
                          ...variables
                            .filter((v) => v.name !== outcome)
                            .filter((v) => {
                              const s = predFilter.trim().toLowerCase();
                              return !s || v.name.toLowerCase().includes(s) || v.label.toLowerCase().includes(s);
                            })
                            .slice(0, 40)
                            .map((v) => v.name),
                        ]),
                    )
                  }
                >
                  Tick shown (up to 40)
                </button>
                <button type="button" className="text-muted hover:underline" onClick={() => setPredictors(new Set())}>
                  Clear
                </button>
              </div>
              <div className="max-h-[28rem] space-y-0.5 overflow-y-auto rounded border border-border p-1.5">
                {variables
                  .filter((v) => v.name !== outcome)
                  .filter((v) => {
                    const s = predFilter.trim().toLowerCase();
                    return !s || v.name.toLowerCase().includes(s) || v.label.toLowerCase().includes(s);
                  })
                  .map((v) => (
                    <label key={v.name} className="flex items-start gap-1.5">
                      <input
                        type="checkbox"
                        checked={predictors.has(v.name)}
                        onChange={() =>
                          setPredictors((p) => {
                            const n = new Set(p);
                            if (n.has(v.name)) n.delete(v.name);
                            else n.add(v.name);
                            return n;
                          })
                        }
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium">{v.name}</span> <span className="text-muted">{v.label}</span>
                      </span>
                    </label>
                  ))}
              </div>
            </section>
                <section className="space-y-1.5">
                  <p className="font-medium text-foreground">Segment by (optional)</p>
                  <p className="text-[11px] text-muted">
                    Run each wave&apos;s analysis again within each category of a second question, such as gender,
                    alongside the overall ranking.
                  </p>
                  <select
                    value={driverGroupVar}
                    onChange={(e) => setDriverGroupVar(e.target.value)}
                    className="w-full rounded border border-border px-2 py-1"
                    aria-label="Segment driver analysis by"
                  >
                    <option value="">None</option>
                    {variables
                      .filter((v) => v.name !== outcome && !predictors.has(v.name))
                      .map((v) => (
                        <option key={v.name} value={v.name}>
                          {v.name}: {v.label}
                        </option>
                      ))}
                  </select>
                </section>
                {weights.length > 0 && (
                  <section className="space-y-1.5">
                    <p className="font-medium text-foreground">Weight (optional)</p>
                    <select value={weightVar} onChange={(e) => setWeightVar(e.target.value)} className="w-full rounded border border-border px-2 py-1">
                      <option value="">None</option>
                      {weights.map((w) => (
                        <option key={w.name} value={w.name}>
                          {w.name}: {w.label}
                        </option>
                      ))}
                    </select>
                  </section>
                )}
                <button
                  type="button"
                  disabled={!outcome || predictors.size === 0 || busy}
                  onClick={build}
                  className="w-full rounded-lg bg-primary px-3 py-2 font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? "Building..." : "Compare driver weights"}
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-white p-3 text-xs shadow-sm">
              <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
                <span className="font-medium text-foreground">Question (asked the same way in every wave)</span>
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search variables"
                  className="rounded border border-border px-2 py-1"
                />
                <select value={variable} onChange={(e) => setVariable(e.target.value)} className="rounded border border-border px-2 py-1" aria-label="Question">
                  <option value="">Choose...</option>
                  {filteredVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}: {v.label}
                    </option>
                  ))}
                </select>
              </label>
              {weights.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="font-medium text-foreground">Weight (optional)</span>
            <select value={weightVar} onChange={(e) => setWeightVar(e.target.value)} className="rounded border border-border px-2 py-1">
              <option value="">None</option>
              {weights.map((w) => (
                <option key={w.name} value={w.name}>
                  {w.name}: {w.label}
                </option>
              ))}
            </select>
          </label>
        )}
              <button
                type="button"
                disabled={!variable || busy}
                onClick={build}
                className="rounded-lg bg-primary px-3 py-2 font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Building..." : mode === "chart" ? "Build chart" : "Calculate NPS"}
              </button>
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {buildError && <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{buildError}</p>}
          <p className="max-w-2xl text-[11px] text-muted">
        Only questions present under the same name in every labelled wave are offered, so a build never fails part way
        through. Each wave is its own file, read as its own sample: if the same people were tracked over waves rather
        than a fresh sample drawn each time, read any change here cautiously.
      </p>

          {(npsCards.length > 0 || charts.length > 0 || driverCards.length > 0) &&
        (() => {
          const editing = charts.length > 0 ? (charts.find((c) => c.id === selectedChartId) ?? charts[charts.length - 1]) : null;
          const editingGrouped = !!editing && editing.result.grouped && editing.result.series.length > 1;
          return (
            <div className="space-y-3">
              {editing && (
                <div className="space-y-2">
                  <label className="inline-flex items-center gap-1.5 text-xs">
                    <span className="font-medium text-muted">Editing</span>
                    <select
                      value={editing.id}
                      onChange={(e) => setSelectedChartId(e.target.value)}
                      className="rounded border border-border px-1.5 py-1 text-xs"
                    >
                      {charts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <ChartCustomizePanel
                    title={editing.title}
                    onTitle={(v) => updateChartCard(editing.id, { title: v })}
                    legendPos={editingGrouped ? editing.legendPos : undefined}
                    onLegendPos={editingGrouped ? (v) => updateChartCard(editing.id, { legendPos: v }) : undefined}
                    colors={editing.result.series.map((s, i) => ({
                      label: s.name,
                      value: editing.colors[i] ?? SERIES_COLORS[i % SERIES_COLORS.length],
                    }))}
                    onColor={(i, v) =>
                      updateChartCard(editing.id, {
                        colors: editing.colors.map((c, j) => (j === i ? v : c)),
                      })
                    }
                    onResetColors={() =>
                      updateChartCard(editing.id, {
                        colors: editing.result.series.map((_, i) => SERIES_COLORS[i % SERIES_COLORS.length]),
                      })
                    }
                  />
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {npsCards.map((card) => (
                  <div key={card.id} className="space-y-2 rounded-xl border border-border bg-white p-3 shadow-sm xl:col-span-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-muted">Net Promoter Score</p>
                      <button
                        type="button"
                        onClick={() => removeNpsCard(card.id)}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted hover:bg-slate-50 hover:text-danger"
                        aria-label="Delete this comparison"
                      >
                        Delete
                      </button>
                    </div>
                    <NpsWaveCards result={card.result} />
                    <button
                      type="button"
                      onClick={() => toggleNpsCommit(card.id)}
                      disabled={card.commitBusy}
                      className={`w-full rounded-lg border px-3 py-1.5 text-xs font-medium shadow-sm disabled:opacity-50 ${
                        card.committed ? "border-border text-muted hover:bg-slate-50" : "border-primary text-primary hover:bg-primary/5"
                      }`}
                    >
                      {card.commitBusy ? "Working..." : card.committed ? "Remove from findings" : "Post to findings"}
                    </button>
                  </div>
                ))}
                {charts.map((card) => (
                  <div
                    key={card.id}
                    onClick={() => setSelectedChartId(card.id)}
                    className={`cursor-pointer space-y-2 rounded-xl border bg-white p-3 shadow-sm ${
                      editing && card.id === editing.id ? "border-primary ring-1 ring-primary" : "border-border"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-muted">{card.title}</p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeChartCard(card.id);
                        }}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted hover:bg-slate-50 hover:text-danger"
                        aria-label="Delete this chart"
                      >
                        Delete
                      </button>
                    </div>
                    <ChartVisual result={card.result} title={card.title} colors={card.colors} legendPos={card.legendPos} />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleChartCommit(card.id);
                      }}
                      disabled={card.commitBusy}
                      className={`w-full rounded-lg border px-3 py-1.5 text-xs font-medium shadow-sm disabled:opacity-50 ${
                        card.committed ? "border-border text-muted hover:bg-slate-50" : "border-primary text-primary hover:bg-primary/5"
                      }`}
                    >
                      {card.commitBusy ? "Working..." : card.committed ? "Remove from findings" : "Post to findings"}
                    </button>
                  </div>
                ))}
              </div>
              {driverCards.map((card) => {
                const perWave = driverReportsByCard[card.id] ?? [];
                const activeWave = driverTabByCard[card.id] ?? perWave[perWave.length - 1]?.wave ?? "";
                const activeEntry = perWave.find((p) => p.wave === activeWave) ?? perWave[perWave.length - 1];
                const activeSeg = driverSegByCard[card.id] ?? null;
                return (
                  <div key={card.id} className="space-y-3 rounded-xl border border-border bg-white p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-muted">Driver weights for {card.table.outcomeLabel}, by wave</p>
                      <button
                        type="button"
                        onClick={() => removeDriverCard(card.id)}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted hover:bg-slate-50 hover:text-danger"
                        aria-label="Delete this comparison"
                      >
                        Delete
                      </button>
                    </div>
                    <DriverWaveTable table={card.table} />
                    <button
                      type="button"
                      onClick={() => toggleDriverCommit(card.id)}
                      disabled={card.commitBusy}
                      className={`w-full rounded-lg border px-3 py-1.5 text-xs font-medium shadow-sm disabled:opacity-50 ${
                        card.committed ? "border-border text-muted hover:bg-slate-50" : "border-primary text-primary hover:bg-primary/5"
                      }`}
                    >
                      {card.commitBusy ? "Working..." : card.committed ? "Remove from findings" : "Post to findings"}
                    </button>
                    {activeEntry && (
                      <div className="space-y-3 border-t border-border pt-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-medium text-muted">Full report for</span>
                          {perWave.map((p) => (
                            <button
                              key={p.wave}
                              type="button"
                              onClick={() => setDriverTabByCard((prev) => ({ ...prev, [card.id]: p.wave }))}
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                                p.wave === activeWave ? "border-primary bg-primary text-white" : "border-border text-muted hover:bg-slate-50"
                              }`}
                            >
                              {p.wave}
                            </button>
                          ))}
                        </div>
                        <p className="text-[11px] text-muted">
                          The same ranking, quadrant and model detail the single-file driver analysis tool shows, read
                          off this one wave&apos;s file. Switch tabs to see how it shifted wave to wave.
                        </p>
                        {activeEntry.report.segments && activeEntry.report.segments.length > 0 && (
                          <SegmentTabs
                            options={activeEntry.report.segments.map((s) => s.name)}
                            value={activeSeg}
                            onChange={(v) => setDriverSegByCard((prev) => ({ ...prev, [card.id]: v }))}
                          />
                        )}
                        <ReportView report={driverReportForSegment(activeEntry.report, activeSeg)} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
        </div>
      </div>
    </div>
  );
}
