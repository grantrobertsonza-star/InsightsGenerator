"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { loadVariablesAction } from "@/lib/crosstabActions";
import {
  runNpsAction,
  addNpsFindingAction,
  removeNpsFindingAction,
  npsFindingStatusAction,
  type NpsResult,
} from "@/lib/npsActions";
import NpsVisual from "./NpsVisual";
import WaveTrackingPanel from "./WaveTrackingPanel";
import CsmAnalyticsPanel from "./CsmAnalyticsPanel";
import BrandHealthAnalyticsPanel from "./BrandHealthAnalyticsPanel";
import type { WaveFile } from "@/lib/waveTrackingActions";
import { ChartCustomizePanel, type LegendPos } from "./ChartCustomize";
import CrosstabWorkspace from "./CrosstabWorkspace";
import {
  runDistributionAction,
  addChartFindingAction,
  removeChartFindingAction,
  chartFindingStatusAction,
  type ChartResult,
} from "@/lib/chartActions";
import ChartVisual, { SERIES_COLORS } from "./ChartVisual";
import {
  addDriverFindingsAction,
  driverFindingCountsAction,
  removeDriverFindingsAction,
  deleteDriverAnalysisAction,
  listDriverAnalysesAction,
  runDriverAnalysisAction,
  saveDriverAnalysisAction,
} from "@/lib/driverActions";
import type { DriverReport, DriverRequest, SavedDriverAnalysis } from "@/lib/drivers";
import type { VariableDictionary, VariableInfo } from "@/lib/parseStatsFile";
import { KANO_LABELS, kanoPlace, type KanoQuadrantName } from "@/lib/driverQuadrant";

const IMPORTANCE_LIKE = /importan|(^|[^a-z])imp([^a-z]|$)/i;
const STOP_WORDS = new Set(["the", "a", "an", "of", "to", "and", "is", "was", "are", "how", "importance", "important", "very", "your", "you", "in", "for", "on", "my", "with", "at", "it", "i", "me"]);
const wordsOf = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w)),
  );

/** The importance question whose wording most overlaps the predictor's, when it overlaps enough to be a safe guess. */
function suggestImportance(pred: VariableInfo, candidates: VariableInfo[]): string {
  const a = wordsOf(pred.label ?? "");
  if (a.size === 0) return "";
  let best = "";
  let bestScore = 0;
  for (const c of candidates) {
    const b = wordsOf(c.label ?? "");
    if (b.size === 0) continue;
    const common = [...a].filter((w) => b.has(w)).length;
    const score = common / (a.size + b.size - common);
    if (score > bestScore) {
      bestScore = score;
      best = c.name;
    }
  }
  return bestScore >= 0.5 ? best : "";
}

/**
 * The launcher on a data file's card. One Analytics block with four tiles: Crosstabs, Driver analysis,
 * NPS and Clustering. The work for each happens in its own full-window workspace because a survey can
 * have thousands of variables.
 */
export default function AnalyticsBuilder({
  runId,
  documentId,
  filename,
  saved,
  waveFiles,
}: {
  runId: string;
  documentId: string;
  filename: string;
  saved: { id: string; label: string }[];
  waveFiles?: WaveFile[];
}) {
  const [tool, setTool] = useState<"driver" | "nps" | "chart" | "wave" | null>(null);
  const [showClustering, setShowClustering] = useState(false);
  const [crosstabOpen, setCrosstabOpen] = useState(false);
  const [csmOpen, setCsmOpen] = useState(false);
  const [brandHealthOpen, setBrandHealthOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-white p-3 text-xs">
      <p className="mb-2 font-medium text-foreground">Analytics</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCrosstabOpen(true)}
          className="flex min-w-[170px] flex-1 basis-[170px] flex-col items-start gap-1 rounded-lg border border-border bg-white p-3 text-left transition hover:border-primary/50 hover:bg-primary/5"
        >
          <p className="font-medium text-foreground">Crosstabs</p>
          <p className="text-[11px] text-muted">
            {saved.length > 0
              ? `${saved.length} table${saved.length > 1 ? "s" : ""} in the set. Open the workspace to view, add or commit.`
              : "Build a set of weighted crosstabs from the full variable list, then commit it to generate findings."}
          </p>
        </button>
        <button
          type="button"
          onClick={() => setTool("driver")}
          className="flex min-w-[170px] flex-1 basis-[170px] flex-col items-start gap-1 rounded-lg border border-border bg-white p-3 text-left transition hover:border-primary/50 hover:bg-primary/5"
        >
          <p className="font-medium text-foreground">Driver analysis</p>
          <p className="text-[11px] text-muted">
            Pick an outcome such as overall satisfaction and the questions that may explain it, and see which matter most,
            with the overlap between them handled.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setTool("nps")}
          className="flex min-w-[170px] flex-1 basis-[170px] flex-col items-start gap-1 rounded-lg border border-border bg-white p-3 text-left transition hover:border-primary/50 hover:bg-primary/5"
        >
          <p className="font-medium text-foreground">Net Promoter Score</p>
          <p className="text-[11px] text-muted">
            Pick a 0-10 likelihood-to-recommend question and get the score, promoters, passives, detractors and a 95%
            interval.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setTool("chart")}
          className="flex min-w-[170px] flex-1 basis-[170px] flex-col items-start gap-1 rounded-lg border border-border bg-white p-3 text-left transition hover:border-primary/50 hover:bg-primary/5"
        >
          <p className="font-medium text-foreground">Charts</p>
          <p className="text-[11px] text-muted">
            Pick any question and see its answer distribution as a bar chart instead of a table, ready to copy or download.
          </p>
        </button>
        {(waveFiles?.length ?? 0) >= 2 && (
          <button
            type="button"
            onClick={() => setTool("wave")}
            className="flex min-w-[170px] flex-1 basis-[170px] flex-col items-start gap-1 rounded-lg border border-border bg-white p-3 text-left transition hover:border-primary/50 hover:bg-primary/5"
          >
            <p className="font-medium text-foreground">Wave tracking</p>
            <p className="text-[11px] text-muted">
              Compare NPS, distributions and driver weights across the files labelled as waves of this tracking
              study.
            </p>
          </button>
        )}
        <button
          type="button"
          onClick={() => setCsmOpen(true)}
          className="flex min-w-[170px] flex-1 basis-[170px] flex-col items-start gap-1 rounded-lg border border-border bg-white p-3 text-left transition hover:border-primary/50 hover:bg-primary/5"
        >
          <p className="font-medium text-foreground">CSM Analytics</p>
          <p className="text-[11px] text-muted">
            Map overall satisfaction, attributes, loyalty and a segment once, then get a scorecard with
            top-box scores and a driver ranking, on this file or across its waves.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setBrandHealthOpen(true)}
          className="flex min-w-[170px] flex-1 basis-[170px] flex-col items-start gap-1 rounded-lg border border-border bg-white p-3 text-left transition hover:border-primary/50 hover:bg-primary/5"
        >
          <p className="font-medium text-foreground">Brand Health Analytics</p>
          <p className="text-[11px] text-muted">
            Name the brand variable and which brand is ours, map the funnel, attributes, loyalty and
            category entry points once, then get a benchmark against every other brand in the file.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setShowClustering((v) => !v)}
          className="flex min-w-[170px] flex-1 basis-[170px] flex-col items-start gap-1 rounded-lg border border-dashed border-border bg-white p-3 text-left opacity-80 transition hover:border-primary/50"
        >
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            Clustering
            <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Coming soon</span>
          </p>
          <p className="text-[11px] text-muted">Group respondents into segments from the questions you choose.</p>
        </button>
      </div>
      {showClustering && (
        <p className="mt-2 rounded border border-border bg-slate-50 px-2.5 py-2 text-[11px] text-muted">
          Not built yet. The plan: pick the segmentation questions, try a range of cluster counts, suggest one by how stable
          and well-separated the segments are, then profile each segment in Cross tabs. We&apos;ll add it here once it&apos;s
          working end to end, same as the other two.
        </p>
      )}
      {tool && (
        <AnalyticsWorkspace
          runId={runId}
          documentId={documentId}
          filename={filename}
          onClose={() => setTool(null)}
          initialTool={tool}
        />
      )}
      {crosstabOpen && (
        <CrosstabWorkspace
          runId={runId}
          documentId={documentId}
          filename={filename}
          onClose={() => setCrosstabOpen(false)}
        />
      )}
      {csmOpen && (
        <CsmAnalyticsPanel
          runId={runId}
          documentId={documentId}
          filename={filename}
          waveFiles={waveFiles}
          onClose={() => setCsmOpen(false)}
        />
      )}
      {brandHealthOpen && (
        <BrandHealthAnalyticsPanel
          runId={runId}
          documentId={documentId}
          filename={filename}
          waveFiles={waveFiles}
          onClose={() => setBrandHealthOpen(false)}
        />
      )}
    </div>
  );
}

const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : `${(v * 100).toFixed(d)}%`);

type ChartCard = {
  id: string;
  result: ChartResult;
  groupVar: string | null;
  committed: boolean;
  commitBusy: boolean;
  title: string;
  colors: string[];
  legendPos: LegendPos;
};

function usable(v: VariableInfo): boolean {
  return v.numeric && !v.text && !v.weightLike && v.nDistinct >= 2;
}

/** Swaps in one segment's own result and performance, so the existing quadrant/bar views render that slice instead of the overall. Falls back to the overall report if the segment isn't there or came back skipped. */
export function driverReportForSegment(report: DriverReport, segName: string | null): DriverReport {
  if (!segName) return report;
  const seg = report.segments?.find((s) => s.name === segName);
  if (!seg || seg.skipped || !seg.result || !seg.performance) return report;
  return {
    ...report,
    outcomeLabel: `${report.outcomeLabel} (${segName})`,
    casesInFile: seg.n,
    weighted: seg.weighted,
    result: seg.result,
    performance: seg.performance,
    stated: seg.stated,
  };
}

/** Same idea for NPS: builds a full result shaped exactly like the overall one from a single segment's figures, so the full ring and breakdown can be drawn for that segment too. */
function npsResultForSegment(result: NpsResult, segName: string | null): NpsResult {
  if (!segName) return result;
  const seg = result.segments?.find((s) => s.name === segName);
  if (!seg) return result;
  return {
    ...result,
    label: `${result.label} (${segName})`,
    n: seg.n,
    nps: seg.nps,
    lo: seg.lo,
    hi: seg.hi,
    promoters: seg.promoters,
    passives: seg.passives,
    detractors: seg.detractors,
    scale: seg.scale,
    groupVariable: null,
    groupLabel: null,
    segments: null,
  };
}

/** Overall / segment picker shared by the NPS and driver-analysis views. */
export function SegmentTabs({ options, value, onChange }: { options: string[]; value: string | null; onChange: (v: string | null) => void }) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
          value === null ? "border-primary bg-primary text-white" : "border-border text-muted hover:bg-slate-50"
        }`}
      >
        Overall
      </button>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
            value === o ? "border-primary bg-primary text-white" : "border-border text-muted hover:bg-slate-50"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function AnalyticsWorkspace({
  runId,
  documentId,
  filename,
  onClose,
  initialTool,
}: {
  runId: string;
  documentId: string;
  filename: string;
  onClose: () => void;
  /** Which tool the workspace opens on; a researcher can switch between them without losing either one's setup. */
  initialTool: "driver" | "nps" | "chart" | "wave";
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"driver" | "nps" | "chart" | "wave">(initialTool);
  const [dict, setDict] = useState<VariableDictionary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [outcomeType, setOutcomeType] = useState<"continuous" | "binary">("continuous");
  const [topBoxMin, setTopBoxMin] = useState("");
  const [npsVariable, setNpsVariable] = useState("");
  const [npsFilter, setNpsFilter] = useState("");
  const [npsBusy, setNpsBusy] = useState(false);
  const [npsError, setNpsError] = useState<string | null>(null);
  const [npsResult, setNpsResult] = useState<NpsResult | null>(null);
  const [npsCommitted, setNpsCommitted] = useState(false);
  const [npsCommitBusy, setNpsCommitBusy] = useState(false);
  const [npsGroupVar, setNpsGroupVar] = useState("");
  const [npsSeg, setNpsSeg] = useState<string | null>(null);
  const [chartVariable, setChartVariable] = useState("");
  const [chartFilter, setChartFilter] = useState("");
  const [chartGroupVar, setChartGroupVar] = useState("");
  const [chartBusy, setChartBusy] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [charts, setCharts] = useState<ChartCard[]>([]);
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
  const [predictors, setPredictors] = useState<Set<string>>(new Set());
  const [predFilter, setPredFilter] = useState("");
  const [weightVar, setWeightVar] = useState("");
  // predictor -> its importance question. "" means the researcher chose none; a missing key means "use the suggestion".
  const [statedPick, setStatedPick] = useState<Record<string, string>>({});
  const [report, setReport] = useState<DriverReport | null>(null);
  const [driverGroupVar, setDriverGroupVar] = useState("");
  const [driverSeg, setDriverSeg] = useState<string | null>(null);
  const [driverSavedId, setDriverSavedId] = useState<string | null>(null);
  const [driverCommitted, setDriverCommitted] = useState(false);
  const [driverCommitBusy, setDriverCommitBusy] = useState(false);
  const [saved, setSaved] = useState<SavedDriverAnalysis[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    loadVariablesAction(runId, documentId).then((r) => {
      if (!live) return;
      if (r.ok) setDict(r.dictionary);
      else setError(r.error);
    });
    listDriverAnalysesAction(runId, documentId).then((r) => {
      if (live && r.ok) setSaved(r.items);
    });
    driverFindingCountsAction(runId).then((r) => {
      if (live && r.ok) setCounts(r.counts);
    });
    return () => {
      live = false;
    };
  }, [runId, documentId]);

  const vars = useMemo(() => (dict?.variables ?? []).filter(usable), [dict]);
  const weights = useMemo(() => (dict?.variables ?? []).filter((v) => v.weightLike), [dict]);
  const match = (v: VariableInfo, q: string) => {
    const s = q.trim().toLowerCase();
    return !s || v.name.toLowerCase().includes(s) || (v.label ?? "").toLowerCase().includes(s);
  };
  const outcomeChoices = vars.filter((v) => match(v, outcomeFilter));
  const predChoices = vars.filter((v) => v.name !== outcome && match(v, predFilter));

  const toggle = (name: string) =>
    setPredictors((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const importanceChoices = useMemo(
    () => vars.filter((v) => IMPORTANCE_LIKE.test(v.name) || IMPORTANCE_LIKE.test(v.label ?? "")),
    [dict], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const chosenPreds = vars.filter((v) => predictors.has(v.name));
  const statedFor = (pred: VariableInfo): string => {
    if (pred.name in statedPick) return statedPick[pred.name];
    return suggestImportance(
      pred,
      importanceChoices.filter((c) => c.name !== pred.name && c.name !== outcome && !predictors.has(c.name)),
    );
  };

  const canRun = outcome !== "" && predictors.size >= 2 && !busy;

  async function run() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const request: DriverRequest = {
      outcome,
      outcomeType,
      topBoxMin: outcomeType === "binary" && topBoxMin.trim() !== "" ? Number(topBoxMin) : null,
      predictors: [...predictors],
      weightVar: weightVar || null,
      statedImportance: Object.fromEntries(
        chosenPreds.map((p) => [p.name, statedFor(p)] as const).filter(([, imp]) => imp !== ""),
      ),
      groupVar: driverGroupVar || null,
    };
    const r = await runDriverAnalysisAction(runId, documentId, request);
    setBusy(false);
    setDriverSavedId(null);
    setDriverCommitted(false);
    setDriverSeg(null);
    if (r.ok) setReport(r.report);
    else {
      setReport(null);
      setError(r.error);
    }
  }

  async function runNps() {
    if (!npsVariable) return;
    setNpsBusy(true);
    setNpsError(null);
    setNpsResult(null);
    setNpsCommitted(false);
    setNpsSeg(null);
    const r = await runNpsAction(runId, documentId, npsVariable, weightVar || null, npsGroupVar || null);
    setNpsBusy(false);
    if (r.ok) {
      setNpsResult(r.result);
      const status = await npsFindingStatusAction(runId, documentId, r.result.variable);
      if (status.ok) setNpsCommitted(status.committed);
    } else setNpsError(r.error);
  }

  async function toggleNpsFinding() {
    if (!npsResult) return;
    setNpsCommitBusy(true);
    if (npsCommitted) {
      const r = await removeNpsFindingAction(runId, documentId, npsResult.variable);
      setNpsCommitBusy(false);
      if (r.ok) {
        setNpsCommitted(false);
        setMessage("Took the NPS finding out of use.");
        startTransition(() => router.refresh());
      } else setNpsError(r.error);
    } else {
      const r = await addNpsFindingAction(runId, documentId, npsResult);
      setNpsCommitBusy(false);
      if (r.ok) {
        setNpsCommitted(true);
        setMessage("Added to findings.");
        startTransition(() => router.refresh());
      } else setNpsError(r.error);
    }
  }

  async function runChart() {
    if (!chartVariable) return;
    setChartBusy(true);
    setChartError(null);
    const gv = chartGroupVar || null;
    const r = await runDistributionAction(runId, documentId, chartVariable, weightVar || null, gv);
    setChartBusy(false);
    if (r.ok) {
      const status = await chartFindingStatusAction(runId, documentId, r.result.variable, gv);
      const cardId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setCharts((prev) => [
        ...prev,
        {
          id: cardId,
          result: r.result,
          groupVar: gv,
          committed: status.ok ? status.committed : false,
          commitBusy: false,
          title: r.result.label,
          colors: r.result.series.map((_, i) => SERIES_COLORS[i % SERIES_COLORS.length]),
          legendPos: "top",
        },
      ]);
      setSelectedChartId(cardId);
    } else setChartError(r.error);
  }

  function removeChartCard(cardId: string) {
    setCharts((prev) => prev.filter((c) => c.id !== cardId));
    setSelectedChartId((prev) => (prev === cardId ? null : prev));
  }

  function updateChartCard(cardId: string, patch: Partial<ChartCard>) {
    setCharts((prev) => prev.map((c) => (c.id === cardId ? { ...c, ...patch } : c)));
  }

  /** The commit action for one chart card: posts or takes back its finding, same shape as the driver/NPS tools. */
  async function toggleChartCommit(cardId: string) {
    const card = charts.find((c) => c.id === cardId);
    if (!card) return;
    setCharts((prev) => prev.map((c) => (c.id === cardId ? { ...c, commitBusy: true } : c)));
    if (card.committed) {
      const r = await removeChartFindingAction(runId, documentId, card.result.variable, card.groupVar);
      if (r.ok) {
        setCharts((prev) => prev.map((c) => (c.id === cardId ? { ...c, committed: false, commitBusy: false } : c)));
        setMessage("Took the finding out of use.");
        startTransition(() => router.refresh());
      } else {
        setError(r.error);
        setCharts((prev) => prev.map((c) => (c.id === cardId ? { ...c, commitBusy: false } : c)));
      }
      return;
    }
    const r = await addChartFindingAction(runId, documentId, card.result, card.groupVar);
    if (r.ok) {
      setCharts((prev) => prev.map((c) => (c.id === cardId ? { ...c, committed: true, commitBusy: false } : c)));
      setMessage("Added to findings.");
      startTransition(() => router.refresh());
    } else {
      setError(r.error);
      setCharts((prev) => prev.map((c) => (c.id === cardId ? { ...c, commitBusy: false } : c)));
    }
  }

  /** Switches to driver analysis with this NPS question as a top-box (promoter) outcome, inside the same workspace. */
  function driveNps(variable: string) {
    setOutcome(variable);
    setOutcomeType("binary");
    setTopBoxMin("9");
    setPredictors(new Set());
    setReport(null);
    setDriverSavedId(null);
    setDriverCommitted(false);
    setDriverSeg(null);
    setDriverGroupVar(npsGroupVar); // carry the same grouping across, if one was set for NPS
    setMode("driver");
  }

  async function save() {
    if (!report) return;
    const title = `Drivers of ${report.outcomeLabel}`;
    const r = await saveDriverAnalysisAction(runId, documentId, title, report);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const list = await listDriverAnalysesAction(runId, documentId);
    if (list.ok) setSaved(list.items);
    setMessage("Saved.");
    startTransition(() => router.refresh());
  }

  /** The single commit action for the analysis on screen: saves it if it isn't already, then posts or takes
   * back its findings, the same "post to findings" action the other Analytics tools use. */
  async function postDriverToFindings() {
    if (!report) return;
    setDriverCommitBusy(true);
    if (driverCommitted && driverSavedId) {
      const r = await removeDriverFindingsAction(runId, driverSavedId);
      setDriverCommitBusy(false);
      if (r.ok) {
        setDriverCommitted(false);
        setCounts((c) => ({ ...c, [driverSavedId]: 0 }));
        setMessage("Took the findings out of use.");
        startTransition(() => router.refresh());
      } else setError(r.error);
      return;
    }
    let id = driverSavedId;
    if (!id) {
      const title = `Drivers of ${report.outcomeLabel}`;
      const saveResult = await saveDriverAnalysisAction(runId, documentId, title, report);
      if (!saveResult.ok) {
        setDriverCommitBusy(false);
        setError(saveResult.error);
        return;
      }
      id = saveResult.id;
      setDriverSavedId(id);
      const list = await listDriverAnalysesAction(runId, documentId);
      if (list.ok) setSaved(list.items);
    }
    const r = await addDriverFindingsAction(runId, id);
    setDriverCommitBusy(false);
    if (r.ok) {
      setDriverCommitted(true);
      setCounts((c) => ({ ...c, [id as string]: r.added }));
      setMessage(`Posted ${r.added} finding${r.added === 1 ? "" : "s"}.`);
      startTransition(() => router.refresh());
    } else setError(r.error);
  }

  const savedBlock =
    saved.length > 0 ? (
            <section className="space-y-1.5">
              <p className="font-medium text-foreground">Saved analyses</p>
              {saved.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1">
                  <button type="button" className="text-left text-primary hover:underline" onClick={() => { setReport(s.report); setDriverSeg(null); }}>
                    {s.title} <span className="text-muted">({new Date(s.createdAt).toLocaleDateString()})</span>
                  </button>
                  <span className="flex shrink-0 items-center gap-2">
                    {(counts[s.id] ?? 0) > 0 ? (
                      <button
                        type="button"
                        className="text-muted hover:underline"
                        onClick={async () => {
                          const r = await removeDriverFindingsAction(runId, s.id);
                          if (r.ok) {
                            setCounts((c) => ({ ...c, [s.id]: 0 }));
                            setMessage(`Took ${r.removed} findings out of use.`);
                          } else setError(r.error);
                        }}
                      >
                        Remove from findings
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={async () => {
                          const r = await addDriverFindingsAction(runId, s.id);
                          if (r.ok) {
                            setCounts((c) => ({ ...c, [s.id]: r.added }));
                            setMessage(`Added ${r.added} findings, marked as modelled results.`);
                            startTransition(() => router.refresh());
                          } else setError(r.error);
                        }}
                      >
                        Post to findings
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-muted hover:text-danger"
                      onClick={async () => {
                        await deleteDriverAnalysisAction(runId, s.id);
                        setSaved((p) => p.filter((x) => x.id !== s.id));
                      }}
                    >
                      Delete
                    </button>
                  </span>
                </div>
              ))}
            </section>
          ) : null;

  const body = (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-label="Analytics workspace">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-2.5">
        <div>
          <p className="text-sm font-semibold text-foreground">
            Analytics: {mode === "driver" ? "driver analysis" : mode === "nps" ? "Net Promoter Score" : mode === "wave" ? "wave tracking" : "charts"}
          </p>
          <p className="text-[11px] text-muted">{filename}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode("driver")}
              className={`rounded-md px-2.5 py-1 font-medium ${mode === "driver" ? "bg-primary text-white" : "text-muted hover:bg-slate-50"}`}
            >
              Driver analysis
            </button>
            <button
              type="button"
              onClick={() => setMode("nps")}
              className={`rounded-md px-2.5 py-1 font-medium ${mode === "nps" ? "bg-primary text-white" : "text-muted hover:bg-slate-50"}`}
            >
              NPS
            </button>
            <button
              type="button"
              onClick={() => setMode("chart")}
              className={`rounded-md px-2.5 py-1 font-medium ${mode === "chart" ? "bg-primary text-white" : "text-muted hover:bg-slate-50"}`}
            >
              Charts
            </button>
            <button
              type="button"
              onClick={() => setMode("wave")}
              className={`rounded-md px-2.5 py-1 font-medium ${mode === "wave" ? "bg-primary text-white" : "text-muted hover:bg-slate-50"}`}
            >
              Wave tracking
            </button>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-slate-50">
            Close
          </button>
        </div>
      </div>
      {mode === "wave" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <WaveTrackingPanel runId={runId} />
        </div>
      ) : (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[22rem_minmax(0,1fr)_22rem]">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-r-2 border-sky-200 bg-sky-50 p-4 text-xs">
          {!dict && !error && <p className="text-muted">Loading the variable list...</p>}
          {mode === "nps" && dict && (
            <>
              <section className="flex min-h-0 flex-1 flex-col space-y-1.5">
                <p className="font-medium text-foreground">Question</p>
                <p className="text-[11px] text-muted">
                  An 11-point 0 to 10 &quot;how likely are you to recommend...&quot; question. Promoters are 9-10, detractors
                  0-6.
                </p>
                <input
                  value={npsFilter}
                  onChange={(e) => setNpsFilter(e.target.value)}
                  placeholder="Search variables"
                  className="w-full rounded border border-border px-2 py-1"
                />
                <select
                  size={4}
                  value={npsVariable}
                  onChange={(e) => {
                    setNpsVariable(e.target.value);
                    setNpsResult(null);
                  }}
                  className="w-full min-h-[14rem] flex-1 rounded border border-border px-1 py-1"
                  aria-label="NPS question"
                >
                  {vars
                    .filter((v) => {
                      const s2 = npsFilter.trim().toLowerCase();
                      return !s2 || v.name.toLowerCase().includes(s2) || (v.label ?? "").toLowerCase().includes(s2);
                    })
                    .map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}: {v.label}
                      </option>
                    ))}
                </select>
              </section>
              <section className="space-y-1.5">
                <p className="font-medium text-foreground">Group by (optional)</p>
                <p className="text-[11px] text-muted">See the score for each category of a second question, such as gender, alongside the overall.</p>
                <select
                  value={npsGroupVar}
                  onChange={(e) => {
                    setNpsGroupVar(e.target.value);
                    setNpsResult(null);
                  }}
                  className="w-full rounded border border-border px-1 py-1"
                  aria-label="Group NPS by"
                >
                  <option value="">None</option>
                  {vars
                    .filter((gv) => gv.name !== npsVariable)
                    .map((gv) => (
                      <option key={gv.name} value={gv.name}>
                        {gv.name}: {gv.label}
                      </option>
                    ))}
                </select>
              </section>
              {weights.length > 0 && (
                <section className="space-y-1.5">
                  <p className="font-medium text-foreground">Weight (optional)</p>
                  <select value={weightVar} onChange={(e) => setWeightVar(e.target.value)} className="w-full rounded border border-border px-1 py-1">
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
                disabled={!npsVariable || npsBusy}
                onClick={runNps}
                className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                {npsBusy ? "Calculating..." : "Calculate NPS"}
              </button>
            </>
          )}
          {mode === "chart" && dict && (
            <>
              <section className="flex min-h-0 flex-1 flex-col space-y-1.5">
                <p className="font-medium text-foreground">Question</p>
                <p className="text-[11px] text-muted">Any question with discrete answers. Open ended and pure numeric averages don&apos;t chart here.</p>
                <input
                  value={chartFilter}
                  onChange={(e) => setChartFilter(e.target.value)}
                  placeholder="Search variables"
                  className="w-full rounded border border-border px-2 py-1"
                />
                <select
                  size={4}
                  value={chartVariable}
                  onChange={(e) => setChartVariable(e.target.value)}
                  className="w-full min-h-[14rem] flex-1 rounded border border-border px-1 py-1"
                  aria-label="Chart question"
                >
                  {vars
                    .filter((v) => {
                      const s2 = chartFilter.trim().toLowerCase();
                      return !s2 || v.name.toLowerCase().includes(s2) || (v.label ?? "").toLowerCase().includes(s2);
                    })
                    .map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}: {v.label}
                      </option>
                    ))}
                </select>
              </section>
              <section className="space-y-1.5">
                <p className="font-medium text-foreground">Group by (optional)</p>
                <p className="text-[11px] text-muted">Split the chart into one series per category of a second question, such as gender.</p>
                <select
                  value={chartGroupVar}
                  onChange={(e) => setChartGroupVar(e.target.value)}
                  className="w-full rounded border border-border px-1 py-1"
                  aria-label="Group by"
                >
                  <option value="">None</option>
                  {vars
                    .filter((gv) => gv.name !== chartVariable)
                    .map((gv) => (
                      <option key={gv.name} value={gv.name}>
                        {gv.name}: {gv.label}
                      </option>
                    ))}
                </select>
              </section>
              {weights.length > 0 && (
                <section className="space-y-1.5">
                  <p className="font-medium text-foreground">Weight (optional)</p>
                  <select value={weightVar} onChange={(e) => setWeightVar(e.target.value)} className="w-full rounded border border-border px-1 py-1">
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
                disabled={!chartVariable || chartBusy}
                onClick={runChart}
                className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                {chartBusy ? "Charting..." : "Build chart"}
              </button>
            </>
          )}
          {mode === "driver" && (
          <>
          <section className="flex min-h-0 flex-1 flex-col space-y-1.5">
            <p className="font-medium text-foreground">1. Outcome</p>
            <input
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value)}
              placeholder="Search variables"
              className="w-full rounded border border-border px-2 py-1"
            />
            <select
              size={4}
              value={outcome}
              onChange={(e) => {
                setOutcome(e.target.value);
                setPredictors((p) => {
                  const n = new Set(p);
                  n.delete(e.target.value);
                  return n;
                });
              }}
              className="w-full min-h-[8rem] flex-1 rounded border border-border px-1 py-1"
              aria-label="Outcome variable"
            >
              {outcomeChoices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}: {v.label}
                </option>
              ))}
            </select>
            <div className="space-y-1">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={outcomeType === "continuous"} onChange={() => setOutcomeType("continuous")} />
                Score (use the average, linear regression)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={outcomeType === "binary"} onChange={() => setOutcomeType("binary")} />
                Top box (yes or no, logistic regression)
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

          <section className="flex min-h-0 flex-1 flex-col space-y-1.5">
            <p className="font-medium text-foreground">
              2. Predictors <span className="font-normal text-muted">({predictors.size} chosen)</span>
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
                onClick={() => setPredictors((p) => new Set([...p, ...predChoices.slice(0, 40).map((v) => v.name)]))}
              >
                Tick shown (up to 40)
              </button>
              <button type="button" className="text-muted hover:underline" onClick={() => setPredictors(new Set())}>
                Clear
              </button>
            </div>
            <div className="min-h-[10rem] flex-1 space-y-0.5 overflow-y-auto rounded border border-border p-1.5">
              {predChoices.slice(0, 300).map((v) => (
                <label key={v.name} className="flex items-start gap-1.5">
                  <input type="checkbox" checked={predictors.has(v.name)} onChange={() => toggle(v.name)} className="mt-0.5" />
                  <span>
                    <span className="font-medium">{v.name}</span> <span className="text-muted">{v.label}</span>
                  </span>
                </label>
              ))}
              {predChoices.length === 0 && <p className="p-1 text-muted">No numeric variables match.</p>}
            </div>
          </section>

          <section className="space-y-1.5">
            <p className="font-medium text-foreground">3. Group by (optional)</p>
            <p className="text-[11px] text-muted">
              Run the same analysis again within each category of a second question, such as gender, alongside the
              overall ranking.
            </p>
            <select
              value={driverGroupVar}
              onChange={(e) => {
                setDriverGroupVar(e.target.value);
                setDriverSeg(null);
              }}
              className="w-full rounded border border-border px-1 py-1"
              aria-label="Group driver analysis by"
            >
              <option value="">None</option>
              {vars
                .filter((gv) => gv.name !== outcome && !predictors.has(gv.name))
                .map((gv) => (
                  <option key={gv.name} value={gv.name}>
                    {gv.name}: {gv.label}
                  </option>
                ))}
            </select>
          </section>

          {weights.length > 0 && (
            <section className="space-y-1.5">
              <p className="font-medium text-foreground">4. Weight (optional)</p>
              <select value={weightVar} onChange={(e) => setWeightVar(e.target.value)} className="w-full rounded border border-border px-1 py-1">
                <option value="">None</option>
                {weights.map((w) => (
                  <option key={w.name} value={w.name}>
                    {w.name}: {w.label}
                  </option>
                ))}
              </select>
            </section>
          )}

          {predictors.size > 0 && importanceChoices.length > 0 && (
            <section className="space-y-1.5">
              <p className="font-medium text-foreground">
                5. Stated importance <span className="font-normal text-muted">(optional)</span>
              </p>
              <p className="text-[11px] text-muted">
                If the survey also asked how important each thing is, pair them to see what people say matters against what
                actually moves the outcome. Pairs below were matched on wording; change any that look wrong.
              </p>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded border border-border p-1.5">
                {chosenPreds.slice(0, 40).map((p) => (
                  <div key={p.name} className="space-y-0.5">
                    <p className="truncate text-[11px]" title={p.label ?? p.name}>
                      {p.label || p.name}
                    </p>
                    <select
                      value={statedFor(p)}
                      onChange={(e) => setStatedPick((prev) => ({ ...prev, [p.name]: e.target.value }))}
                      className="w-full rounded border border-border px-1 py-0.5"
                    >
                      <option value="">No importance question</option>
                      {importanceChoices
                        .filter((c) => c.name !== p.name && c.name !== outcome)
                        .slice(0, 300)
                        .map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}: {(c.label ?? "").slice(0, 70)}
                          </option>
                        ))}
                    </select>
                  </div>
                ))}
              </div>
            </section>
          )}

          <button
            type="button"
            disabled={!canRun}
            onClick={run}
            className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Working..." : "Run driver analysis"}
          </button>
          {predictors.size < 2 && <p className="text-muted">Choose an outcome and at least two predictors.</p>}

          <div className="xl:hidden">{savedBlock}</div>
          </>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto p-4 text-xs">
          {mode === "driver" && (
            <>
              {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-danger">{error}</p>}
              {message && <p className="mb-3 text-muted">{message}</p>}
              <div
                className={
                  npsResult && npsResult.variable === outcome
                    ? "grid grid-cols-1 items-start gap-4 xl:grid-cols-2"
                    : undefined
                }
              >
                {npsResult && npsResult.variable === outcome && (
                  <div className="space-y-2">
                    {npsResult.segments && npsResult.segments.length > 0 && (
                      <SegmentTabs options={npsResult.segments.map((s) => s.name)} value={npsSeg} onChange={setNpsSeg} />
                    )}
                    <NpsVisual result={npsResultForSegment(npsResult, npsSeg)} />
                    <button
                      type="button"
                      onClick={toggleNpsFinding}
                      disabled={npsCommitBusy}
                      className={`w-full rounded-lg border px-3 py-2 font-medium disabled:opacity-50 ${
                        npsCommitted
                          ? "border-border text-muted hover:bg-slate-50"
                          : "border-primary bg-primary text-white hover:opacity-90"
                      }`}
                    >
                      {npsCommitBusy ? "Working..." : npsCommitted ? "Remove from findings" : "Post to findings"}
                    </button>
                  </div>
                )}
                <div className="space-y-3">
                  {!report && !error && (
                    <p className="max-w-xl text-muted">
                      Driver analysis shows which questions are most closely tied to the outcome. Questions that overlap,
                      such as two ways of asking about the same thing, share their weight between them instead of one of
                      them getting all of it or a negative score. The result is a ranking with an interval on each weight,
                      so you can see which differences are real. It describes what goes with the outcome in this survey.
                      It does not prove cause.
                    </p>
                  )}
                  {report && (
                    <>
                      {report.segments && report.segments.length > 0 && (
                        <SegmentTabs options={report.segments.map((s) => s.name)} value={driverSeg} onChange={setDriverSeg} />
                      )}
                      {(() => {
                        const seg = driverSeg ? report.segments?.find((s) => s.name === driverSeg) : null;
                        if (seg?.skipped) {
                          return (
                            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                              {seg.reason || "Not enough cases in this group to run the model."}
                            </p>
                          );
                        }
                        return (
                          <ReportView
                            report={driverReportForSegment(report, driverSeg)}
                            committed={driverCommitted}
                            busy={driverCommitBusy}
                            onPost={postDriverToFindings}
                          />
                        );
                      })()}
                    </>
                  )}
                </div>
              </div>
            </>
          )}
          {mode === "nps" && (
            <>
              {npsError && <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">{npsError}</p>}
              {!npsResult && !npsError && (
                <p className="max-w-xl text-muted">
                  Pick an 11-point 0 to 10 &quot;how likely are you to recommend...&quot; question on the left. Promoters are
                  9-10, detractors 0-6, everyone else is a passive. The score is the promoter share minus the detractor
                  share.
                </p>
              )}
              {npsResult && (
                <div className="max-w-3xl space-y-3">
                  {npsResult.segments && npsResult.segments.length > 0 && (
                    <SegmentTabs options={npsResult.segments.map((s) => s.name)} value={npsSeg} onChange={setNpsSeg} />
                  )}
                  <NpsVisual result={npsResultForSegment(npsResult, npsSeg)} />
                  <button
                    type="button"
                    onClick={toggleNpsFinding}
                    disabled={npsCommitBusy}
                    className={`w-full rounded-lg border px-3 py-2 font-medium disabled:opacity-50 ${
                      npsCommitted
                        ? "border-border text-muted hover:bg-slate-50"
                        : "border-primary bg-primary text-white hover:opacity-90"
                    }`}
                  >
                    {npsCommitBusy ? "Working..." : npsCommitted ? "Remove from findings" : "Post to findings"}
                  </button>
                  <div className="rounded-xl border border-border bg-slate-50 p-3">
                    <button
                      type="button"
                      onClick={() => driveNps(npsResult.variable)}
                      className="w-full rounded-lg border border-primary bg-white px-3 py-2 font-medium text-primary hover:bg-primary/5"
                    >
                      Find what drives this score &rarr;
                    </button>
                    <p className="mt-2 text-muted">
                      Sets this question as the driver-analysis outcome (promoter, 9 or above, vs. everyone else) and opens
                      the predictor picker on the left. The chart stays on screen next to the results as you build it.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
          {mode === "chart" && (
            <>
              {chartError && <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">{chartError}</p>}
              {charts.length === 0 && !chartError && (
                <p className="max-w-xl text-muted">
                  Pick a question on the left and build its answer distribution as a chart, ready to copy or download for a
                  slide. Build another one straight after: each chart stays on screen below the last, in a grid, so you can
                  build out a whole set and commit the ones worth keeping together.
                </p>
              )}
              {charts.length > 0 && (() => {
                const editing = charts.find((c) => c.id === selectedChartId) ?? charts[charts.length - 1];
                const editingGrouped = editing.result.grouped && editing.result.series.length > 1;
                return (
                  <>
                    <div className="mb-3 space-y-2">
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
                              {c.groupVar ? ` × ${c.result.groupLabel}` : ""}
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
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      {charts.map((card) => (
                        <div
                          key={card.id}
                          onClick={() => setSelectedChartId(card.id)}
                          className={`cursor-pointer space-y-2 rounded-xl border bg-white p-3 ${
                            card.id === editing.id ? "border-primary ring-1 ring-primary" : "border-border"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-medium text-muted">
                              {card.title}
                              {card.groupVar ? ` × ${card.result.groupLabel}` : ""}
                            </p>
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
                              card.committed
                                ? "border-border text-muted hover:bg-slate-50"
                                : "border-primary text-primary hover:bg-primary/5"
                            }`}
                          >
                            {card.commitBusy ? "Working..." : card.committed ? "Remove from findings" : "Post to findings"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </>
          )}
        </div>

        <aside className="hidden min-h-0 flex-col gap-4 overflow-y-auto border-l-2 border-slate-300 bg-white p-4 text-xs xl:flex">
          {mode === "driver" ? (
            <>
              <h3 className="text-sm font-semibold text-foreground">How to read this</h3>
              {report ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-border bg-slate-50 px-3 py-2">
                    <div className="text-lg font-semibold text-foreground">{report.result.n.toLocaleString()}</div>
                    <div className="text-[11px] text-muted">of {report.casesInFile.toLocaleString()} cases used</div>
                  </div>
                  <div className="rounded-lg border border-border bg-slate-50 px-3 py-2">
                    <div className="text-lg font-semibold text-foreground">
                      {report.result.fit.mcFadden === null
                        ? `${Math.round(report.result.fit.rSquared * 100)}%`
                        : report.result.fit.mcFadden.toFixed(2)}
                    </div>
                    <div className="text-[11px] text-muted">
                      {report.result.fit.mcFadden === null ? "variation explained" : "pseudo R-squared"}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-muted">Run an analysis to see how many cases it used and how well the questions explain the outcome.</p>
              )}
              <ul className="list-disc space-y-1.5 pl-4 text-muted">
                <li>The ranking shows what goes with the outcome in this survey. It does not prove cause.</li>
                <li>Questions that overlap share their weight, so one of them does not take it all.</li>
                <li>Look at the rank range as well as the rank. A wide range means the order is not settled.</li>
                <li>Stated importance, if paired, shows what people say matters against what moves the outcome.</li>
                <li>
                  {!report || report.result.method === "shapley"
                    ? "The split itself is a Shapley decomposition: each question's weight is its average contribution to the explained variation across every order the questions could be added in, so two overlapping questions divide the credit between them rather than one taking it all."
                    : report.result.method === "relative_weights"
                      ? "With too many questions to check every order exactly, the split switches to Johnson's relative weights, which approximates the same Shapley idea through an orthogonal transformation of the predictors rather than full enumeration."
                      : "With even more questions, the split falls back to the size of each standardised coefficient from the fitted model, quicker to compute but less reliable once questions overlap."}
                </li>
              </ul>
              {savedBlock}
            </>
          ) : mode === "nps" ? (
            <>
              <h3 className="text-sm font-semibold text-foreground">How to read this</h3>
              <ul className="list-disc space-y-1.5 pl-4 text-muted">
                <li>NPS is the share who are promoters (9-10) minus the share who are detractors (0-6). Passives (7-8) don&apos;t count either way.</li>
                <li>The 95% interval shows how much the score could move on a repeat sample. A wide interval against a small base means read it cautiously.</li>
                <li>This reads the file directly; it isn&apos;t saved as a Cross tabs table, so picking different questions here never clutters that list.</li>
              </ul>
            </>
          ) : (
            <>
              <h3 className="text-sm font-semibold text-foreground">How to read this</h3>
              <ul className="list-disc space-y-1.5 pl-4 text-muted">
                <li>Bars are the share of valid answers choosing each option, out of the base shown under the title.</li>
                <li>Group by a second question, such as gender, to get one coloured bar per category instead of one line.</li>
                <li>A purely continuous question (age, income) has no answer categories, so it falls back to a histogram, and can&apos;t be grouped.</li>
                <li>This reads the file directly, the same way NPS does, so it isn&apos;t saved as a Cross tabs table.</li>
                <li>For a table of this question instead, use Crosstabs.</li>
                <li>Copy image or download PNG to drop the chart straight into a slide or report.</li>
              </ul>
            </>
          )}
        </aside>
      </div>
      )}
    </div>
  );

  return createPortal(body, document.body);
}

export function ReportView({
  report,
  committed = false,
  busy = false,
  onPost,
}: {
  report: DriverReport;
  committed?: boolean;
  busy?: boolean;
  onPost?: () => void;
}) {
  const r = report.result;
  const maxShare = Math.max(...r.rows.map((x) => x.share), 0.0001);
  const methodText =
    r.method === "shapley"
      ? "Importance is each question's average contribution across every order in which questions can be added (Shapley split of the explained variance)."
      : r.method === "relative_weights"
        ? "Importance uses Johnson's relative weights, which split the explained variance when questions overlap."
        : "Importance is the size of each standardised coefficient.";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Drivers of {report.outcomeLabel}</p>
          <p className="text-muted">{report.outcomeNote}</p>
          <p className="text-muted">
            {r.n.toLocaleString()} of {report.casesInFile.toLocaleString()} cases used{report.weighted ? ", weighted" : ""}.
            {r.fit.mcFadden === null
              ? ` The questions together explain ${pct(r.fit.rSquared)} of the variation (adjusted ${pct(r.fit.adjRSquared)}).`
              : ` Pseudo R-squared ${r.fit.mcFadden.toFixed(2)} (McFadden), ${r.fit.nagelkerke?.toFixed(2)} (Nagelkerke). The model classifies ${pct(r.fit.classificationRate)} of cases correctly, against ${pct(r.fit.baseRate)} by always guessing the larger group.`}
          </p>
        </div>
        {onPost && (
          <button
            type="button"
            onClick={onPost}
            disabled={busy}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
              committed ? "border-border text-muted hover:bg-slate-50" : "border-primary bg-primary text-white hover:opacity-90"
            }`}
          >
            {busy ? "Working..." : committed ? "Remove from findings" : "Post to findings"}
          </button>
        )}
      </div>

      {r.warnings.length > 0 && (
        <ul className="space-y-1 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
          {r.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead className="text-[11px] uppercase text-muted">
            <tr>
              <th className="py-1 pr-2">Rank</th>
              <th className="py-1 pr-2">Question</th>
              <th className="py-1 pr-2">Share of explained variation</th>
              <th className="py-1 pr-2">Rank range</th>
              <th className="py-1 pr-2">Correlation</th>
              <th className="py-1 pr-2">{r.fit.mcFadden === null ? "Std. beta" : "Odds ratio per SD"}</th>
              <th className="py-1 pr-2">p</th>
              <th className="py-1">Overlap (VIF)</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((x) => (
              <tr key={x.name} className="border-t border-border align-top">
                <td className="py-1.5 pr-2 font-medium">{x.rank}</td>
                <td className="py-1.5 pr-2">{x.name}</td>
                <td className="py-1.5 pr-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-28 overflow-hidden rounded bg-slate-200" aria-hidden>
                      <div className="h-full rounded bg-primary" style={{ width: `${(x.share / maxShare) * 100}%` }} />
                    </div>
                    <span className="font-medium">{pct(x.share, 1)}</span>
                    {x.shareLow !== null && x.shareHigh !== null && (
                      <span className="text-muted">
                        ({pct(x.shareLow)} to {pct(x.shareHigh)})
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-1.5 pr-2 text-muted">{x.rankLow !== null ? (x.rankLow === x.rankHigh ? `${x.rankLow}` : `${x.rankLow} to ${x.rankHigh}`) : "-"}</td>
                <td className="py-1.5 pr-2">{x.correlation.toFixed(2)}</td>
                <td className="py-1.5 pr-2">{x.effect.toFixed(2)}</td>
                <td className="py-1.5 pr-2">{x.pValue === null ? "-" : x.pValue < 0.001 ? "<.001" : x.pValue.toFixed(3)}</td>
                <td className={`py-1.5 ${x.vif > 5 ? "text-amber-700" : ""}`}>{Number.isFinite(x.vif) ? x.vif.toFixed(1) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted">
        {methodText} Intervals come from 95% bootstrap ranges, repeatable because the resampling is seeded. A rank range that spans
        several places means those questions cannot be separated reliably. The p value tests whether the question adds
        anything once the others are in the model. This describes association in this survey, not cause.
      </p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Quadrant report={report} />
        <StatedQuadrant report={report} />
      </div>
      {report.skipped.length > 0 && (
        <p className="text-[11px] text-muted">
          Left out: {report.skipped.map((s) => `${s.variable} (${s.reason})`).join("; ")}.
        </p>
      )}
    </div>
  );
}

/** Importance against performance: where to act first. Performance is the share giving the top two answers, or the average when that is not meaningful. */
const QUAD_DEFAULT_COLORS = { fix: "#dc2626", protect: "#16a34a", low1: "#ca8a04", low2: "#2563eb" };

function Quadrant({ report }: { report: DriverReport }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<"copy" | "download" | null>(null);
  const [title, setTitle] = useState("Importance against performance");
  const [legendPos, setLegendPos] = useState<LegendPos>("top");
  const [quadColors, setQuadColors] = useState(QUAD_DEFAULT_COLORS);

  const rows = report.result.rows
    .map((r) => {
      const p = report.performance.find((x) => x.name === r.name);
      return { name: r.name, importance: r.share, perf: p?.topTwo ?? null, mean: p?.mean ?? null };
    });
  const useTop = rows.filter((r) => r.perf !== null).length >= Math.ceil(rows.length / 2);
  const pts = rows
    .map((r) => ({ name: r.name, x: useTop ? r.perf : r.mean, y: r.importance }))
    .filter((p): p is { name: string; x: number; y: number } => p.x !== null);
  if (pts.length < 3) return null;
  const methodNote =
    report.result.method === "shapley"
      ? "The importance (y) axis is a Shapley split of the explained variance."
      : report.result.method === "relative_weights"
        ? "The importance (y) axis uses Johnson's relative weights, the approximation the analysis switches to once there are too many questions to enumerate every subset exactly."
        : "The importance (y) axis is the size of each standardised coefficient.";
  const W = 560;
  const H = 340;
  // Extra room above the plot for the title, drawn as SVG text (not HTML) so it travels with the chart
  // into the copied/downloaded image, the same way ChartVisual and NpsVisual draw theirs.
  const TITLE_H = 30;
  const pad = { l: 46, r: 20, t: 18, b: 40 };
  const xsRaw = pts.map((p) => p.x);
  const xMinRaw = Math.min(...xsRaw);
  const xMaxRaw = Math.max(...xsRaw);
  // Pad the domain so the end points don't sit flush on the axes, and labels have room to clear the frame.
  const xPad = (xMaxRaw - xMinRaw || 1) * 0.1;
  const xMin = xMinRaw - xPad;
  const xMax = xMaxRaw + xPad;
  const xSpan = xMax - xMin || 1;
  const yMaxRaw = Math.max(...pts.map((p) => p.y)) || 1;
  const yMax = yMaxRaw * 1.15;
  const sx = (v: number) => pad.l + ((v - xMin) / xSpan) * (W - pad.l - pad.r);
  const sy = (v: number) => H - pad.b - (v / yMax) * (H - pad.t - pad.b);
  const medX = [...xsRaw].sort((a, b) => a - b)[Math.floor(xsRaw.length / 2)];
  const medY = 1 / pts.length;
  const fmtX = (v: number) => (useTop ? `${Math.round(v * 100)}%` : v.toFixed(1));
  const fmtY = (v: number) => `${Math.round(v * 100)}%`;
  const xTicks = [xMinRaw, (xMinRaw + xMaxRaw) / 2, xMaxRaw];
  const yTicks = [0, yMaxRaw / 2, yMaxRaw];

  // Labels sit to the right of their point by default, flip to the left once the point is close enough to the
  // right edge that a right-hand label would run past the frame, and nudge down on vertical overlap with a
  // label already placed (processed top to bottom so each new label only has to dodge the ones above it).
  // A clashing label is nudged away from the frame, not blindly downward: a point near the bottom edge
  // pushed down runs straight into the axis line and its tick labels, so the direction follows which half
  // of the plot the point sits in.
  const yLo = pad.t + 8;
  const yHi = H - pad.b - 4;
  const taken: { x1: number; x2: number; y: number }[] = [];
  const labels = [...pts]
    .sort((a, b) => sy(a.y) - sy(b.y))
    .map((p) => {
      const text = p.name.length > 26 ? `${p.name.slice(0, 25)}...` : p.name;
      const width = text.length * 5.2;
      const left = sx(p.x) + 8 + width > W - pad.r;
      const x1 = left ? sx(p.x) - 8 - width : sx(p.x) + 8;
      const x2 = x1 + width;
      const pushUp = sy(p.y) > (pad.t + H - pad.b) / 2;
      let y = Math.min(yHi, Math.max(yLo, sy(p.y) + 3));
      for (let tries = 0; tries < 12; tries++) {
        const clash = taken.find((t) => x1 < t.x2 && x2 > t.x1 && Math.abs(t.y - y) < 11);
        if (!clash) break;
        y = Math.min(yHi, Math.max(yLo, pushUp ? clash.y - 11 : clash.y + 11));
      }
      taken.push({ x1, x2, y });
      return { p, text, left, y };
    });

  // Four-way split around the median lines, coloured the way the quadrant reads for action: important and
  // weak is the one to fix, important and strong is the one to protect, and the two low-importance corners
  // barely matter either way.
  const QUAD = {
    fix: { fill: quadColors.fix, tint: `${quadColors.fix}14`, label: "Important weakness" },
    protect: { fill: quadColors.protect, tint: `${quadColors.protect}14`, label: "Important strength" },
    low1: { fill: quadColors.low1, tint: `${quadColors.low1}14`, label: "Unimportant weakness" },
    low2: { fill: quadColors.low2, tint: `${quadColors.low2}14`, label: "Unimportant strength" },
  };
  const quadrantOf = (p: { x: number; y: number }) =>
    p.y >= medY ? (p.x < medX ? QUAD.fix : QUAD.protect) : p.x < medX ? QUAD.low1 : QUAD.low2;
  const midX = sx(medX);
  const midY = sy(medY);

  async function toPngBlob(scaleFactor = 2): Promise<Blob | null> {
    const svg = svgRef.current;
    if (!svg) return null;
    const xml = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("The image could not be rendered."));
        im.src = url;
      });
      const w = svg.viewBox.baseVal.width || W;
      const h = svg.viewBox.baseVal.height || H;
      const canvas = document.createElement("canvas");
      canvas.width = w * scaleFactor;
      canvas.height = h * scaleFactor;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function download() {
    setBusy("download");
    setStatus(null);
    const blob = await toPngBlob(2);
    setBusy(null);
    if (!blob) {
      setStatus("Could not render the image.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `importance-performance-${report.request.outcome}.png`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Downloaded.");
  }

  async function copy() {
    setBusy("copy");
    setStatus(null);
    const blob = await toPngBlob(2);
    setBusy(null);
    if (!blob) {
      setStatus("Could not render the image.");
      return;
    }
    try {
      const Ctor = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (navigator.clipboard && "write" in navigator.clipboard && Ctor) {
        await navigator.clipboard.write([new Ctor({ "image/png": blob })]);
        setStatus("Copied. Paste it into your slide.");
      } else {
        await download();
        setStatus("This browser can't copy images, so it downloaded instead.");
      }
    } catch {
      await download();
      setStatus("Copying didn't work, so it downloaded instead.");
    }
  }

  return (
    <div>
      <ChartCustomizePanel
        title={title}
        onTitle={setTitle}
        legendPos={legendPos}
        onLegendPos={setLegendPos}
        colors={[
          { label: QUAD.fix.label, value: quadColors.fix },
          { label: QUAD.protect.label, value: quadColors.protect },
          { label: QUAD.low1.label, value: quadColors.low1 },
          { label: QUAD.low2.label, value: quadColors.low2 },
        ]}
        onColor={(i, v) => {
          const keys: (keyof typeof quadColors)[] = ["fix", "protect", "low1", "low2"];
          setQuadColors((prev) => ({ ...prev, [keys[i]]: v }));
        }}
        onResetColors={() => setQuadColors(QUAD_DEFAULT_COLORS)}
      />
      <div className="mt-2 flex flex-col gap-3 rounded-xl border border-border bg-white p-3 sm:flex-row sm:items-center">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H + TITLE_H}`}
          className="w-full max-w-2xl"
          style={{ order: legendPos === "top" ? 1 : 0 }}
          role="img"
          aria-label="Importance against performance by question"
        >
          <rect x="0" y="0" width={W} height={H + TITLE_H} fill="#ffffff" />
          <text x={W / 2} y="20" textAnchor="middle" fontSize="15" fontWeight="700" fill="#0f172a" fontFamily="system-ui, -apple-system, sans-serif">
            {title}
          </text>
          <g transform={`translate(0, ${TITLE_H})`}>
          <rect x={pad.l} y={pad.t} width={midX - pad.l} height={midY - pad.t} fill={QUAD.fix.tint} />
          <rect x={midX} y={pad.t} width={W - pad.r - midX} height={midY - pad.t} fill={QUAD.protect.tint} />
          <rect x={pad.l} y={midY} width={midX - pad.l} height={H - pad.b - midY} fill={QUAD.low1.tint} />
          <rect x={midX} y={midY} width={W - pad.r - midX} height={H - pad.b - midY} fill={QUAD.low2.tint} />
          <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="currentColor" opacity="0.3" />
          <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke="currentColor" opacity="0.3" />
          <line x1={midX} y1={pad.t} x2={midX} y2={H - pad.b} stroke="currentColor" opacity="0.35" strokeDasharray="4 4" />
          <line x1={pad.l} y1={midY} x2={W - pad.r} y2={midY} stroke="currentColor" opacity="0.35" strokeDasharray="4 4" />
          {xTicks.map((t, i) => (
            <g key={`xt${i}`}>
              <line x1={sx(t)} y1={H - pad.b} x2={sx(t)} y2={H - pad.b + 4} stroke="currentColor" opacity="0.4" />
              <text x={sx(t)} y={H - pad.b + 15} fontSize="9" textAnchor="middle" fill="currentColor" opacity="0.6">
                {fmtX(t)}
              </text>
            </g>
          ))}
          {yTicks.map((t, i) => (
            <g key={`yt${i}`}>
              <line x1={pad.l - 4} y1={sy(t)} x2={pad.l} y2={sy(t)} stroke="currentColor" opacity="0.4" />
              <text x={pad.l - 7} y={sy(t) + 3} fontSize="9" textAnchor="end" fill="currentColor" opacity="0.6">
                {fmtY(t)}
              </text>
            </g>
          ))}
          {pts.map((p) => (
            <circle key={p.name} cx={sx(p.x)} cy={sy(p.y)} r={6.5} fill={quadrantOf(p).fill} stroke="white" strokeWidth={1.5} />
          ))}
          {labels.map(({ p, text, left, y }) => (
            <text
              key={p.name}
              x={left ? sx(p.x) - 10 : sx(p.x) + 10}
              y={y}
              fontSize="10"
              fontWeight="600"
              textAnchor={left ? "end" : "start"}
              fill="#0f172a"
            >
              {text}
            </text>
          ))}
          <text x={(pad.l + W - pad.r) / 2} y={H - 8} fontSize="11" textAnchor="middle" fill="currentColor" opacity="0.7">
            {useTop ? "Performance: share giving the top two answers" : "Performance: average answer"}
          </text>
          <text x={12} y={(pad.t + H - pad.b) / 2} fontSize="11" textAnchor="middle" fill="currentColor" opacity="0.7" transform={`rotate(-90 12 ${(pad.t + H - pad.b) / 2})`}>
            Importance (share)
          </text>
          </g>
        </svg>
        <div
          className="flex shrink-0 flex-row flex-wrap gap-x-4 gap-y-2 sm:flex-col sm:gap-y-3"
          style={{ order: legendPos === "top" ? 0 : 1 }}
        >
          {([QUAD.fix, QUAD.protect, QUAD.low1, QUAD.low2] as const).map((q) => (
            <div key={q.label} className="flex items-center gap-1.5">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: q.fill }} />
              <span className="whitespace-nowrap font-medium text-foreground">{q.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copy}
          disabled={busy !== null}
          className="rounded-lg border border-primary px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
        >
          {busy === "copy" ? "Copying..." : "Copy image"}
        </button>
        <button
          type="button"
          onClick={download}
          disabled={busy !== null}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "download" ? "Downloading..." : "Download PNG"}
        </button>
        {status && <span className="text-[11px] text-muted">{status}</span>}
      </div>
      <p className="text-[11px] text-muted">
        Questions high on importance and low on performance (red) are the first to fix. The dashed lines mark the middle of
        the questions shown. {methodNote}
      </p>
    </div>
  );
}

const QUADRANT_FILL: Record<KanoQuadrantName, string> = {
  satisfiers: "#047857",
  exciters: "#7c3aed",
  mustBes: "#b45309",
  indifference: "#64748b",
};

/**
 * Derived against stated importance: what actually moves the outcome against what people say matters.
 * Both axes are centred on the average of the questions shown and scaled to standard deviations.
 */
function StatedQuadrant({ report }: { report: DriverReport }) {
  const stated = report.stated ?? [];
  const joined = stated
    .map((s) => {
      const r = report.result.rows.find((x) => x.name === s.name);
      return r ? { name: s.name, derived: r.share, top: s.topTwo, mean: s.mean } : null;
    })
    .filter((x): x is { name: string; derived: number; top: number | null; mean: number | null } => x !== null);
  const useTop = joined.length > 0 && joined.every((j) => j.top !== null);
  const points = joined
    .map((j) => ({ name: j.name, derived: j.derived, stated: useTop ? j.top : j.mean }))
    .filter((p): p is { name: string; derived: number; stated: number } => p.stated !== null);
  if (points.length < 3) return null;
  const placed = kanoPlace(points);

  const W = 620;
  const H = 400;
  const pad = { l: 56, r: 24, t: 26, b: 46 };
  const rx = Math.max(1.5, ...placed.map((p) => Math.abs(p.zx))) * 1.1;
  const ry = Math.max(1.5, ...placed.map((p) => Math.abs(p.zy))) * 1.1;
  const sx = (z: number) => pad.l + ((z + rx) / (2 * rx)) * (W - pad.l - pad.r);
  const sy = (z: number) => H - pad.b - ((z + ry) / (2 * ry)) * (H - pad.t - pad.b);
  const cx = sx(0);
  const cy = sy(0);

  // Labels: to the right of the point, or to its left near the right edge, nudged down when two would overlap.
  const taken: { x1: number; x2: number; y: number }[] = [];
  const labels = [...placed]
    .sort((a, b) => sy(a.zy) - sy(b.zy))
    .map((p) => {
      const text = p.name.length > 30 ? `${p.name.slice(0, 29)}...` : p.name;
      const width = text.length * 5.3;
      const left = sx(p.zx) > W * 0.62;
      const x1 = left ? sx(p.zx) - 8 - width : sx(p.zx) + 8;
      const x2 = x1 + width;
      let y = sy(p.zy) + 3;
      for (let tries = 0; tries < 12; tries++) {
        const clash = taken.find((t) => x1 < t.x2 && x2 > t.x1 && Math.abs(t.y - y) < 11);
        if (!clash) break;
        y = clash.y + 11;
      }
      taken.push({ x1, x2, y });
      return { p, text, left, y };
    });

  const groups = (["satisfiers", "exciters", "mustBes", "indifference"] as KanoQuadrantName[]).map((q) => ({
    q,
    names: placed.filter((p) => p.quadrant === q).map((p) => p.name),
  }));

  return (
    <div>
      <p className="mb-1 font-medium text-foreground">Derived against stated importance</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl rounded-xl border border-border bg-white" role="img" aria-label="Derived importance against stated importance by question">
        <rect x={pad.l} y={pad.t} width={cx - pad.l} height={cy - pad.t} fill={`${QUADRANT_FILL.exciters}14`} />
        <rect x={cx} y={pad.t} width={W - pad.r - cx} height={cy - pad.t} fill={`${QUADRANT_FILL.satisfiers}14`} />
        <rect x={pad.l} y={cy} width={cx - pad.l} height={H - pad.b - cy} fill={`${QUADRANT_FILL.indifference}10`} />
        <rect x={cx} y={cy} width={W - pad.r - cx} height={H - pad.b - cy} fill={`${QUADRANT_FILL.mustBes}14`} />
        <line x1={cx} y1={pad.t} x2={cx} y2={H - pad.b} stroke="currentColor" opacity="0.25" strokeDasharray="4 4" />
        <line x1={pad.l} y1={cy} x2={W - pad.r} y2={cy} stroke="currentColor" opacity="0.25" strokeDasharray="4 4" />
        <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="none" stroke="currentColor" opacity="0.2" />
        <text x={pad.l + 6} y={pad.t + 13} fontSize="10.5" fontWeight="600" fill={QUADRANT_FILL.exciters}>
          Exciters (the unexpected)
        </text>
        <text x={W - pad.r - 6} y={pad.t + 13} fontSize="10.5" fontWeight="600" textAnchor="end" fill={QUADRANT_FILL.satisfiers}>
          Satisfiers (key drivers)
        </text>
        <text x={pad.l + 6} y={H - pad.b - 6} fontSize="10.5" fontWeight="600" fill={QUADRANT_FILL.indifference}>
          Indifference (secondary)
        </text>
        <text x={W - pad.r - 6} y={H - pad.b - 6} fontSize="10.5" fontWeight="600" textAnchor="end" fill={QUADRANT_FILL.mustBes}>
          Must-be&apos;s (potential dissatisfiers)
        </text>
        {labels.map(({ p, text, left, y }) => (
          <g key={p.name}>
            <circle cx={sx(p.zx)} cy={sy(p.zy)} r={6.5} fill={QUADRANT_FILL[p.quadrant]} stroke="white" strokeWidth={1.5} />
            <text x={left ? sx(p.zx) - 10 : sx(p.zx) + 10} y={y} fontSize="10" fontWeight="600" textAnchor={left ? "end" : "start"} fill="#0f172a">
              {text}
            </text>
          </g>
        ))}
        <text x={(pad.l + W - pad.r) / 2} y={H - 10} fontSize="11" textAnchor="middle" fill="currentColor" opacity="0.7">
          Stated importance ({useTop ? "share rating it top two" : "average rating"}), low to high
        </text>
        <text x={14} y={(pad.t + H - pad.b) / 2} fontSize="11" textAnchor="middle" fill="currentColor" opacity="0.7" transform={`rotate(-90 14 ${(pad.t + H - pad.b) / 2})`}>
          Derived importance (share of explained variance), low to high
        </text>
      </svg>
      <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
        {groups.map(({ q, names }) => (
          <div key={q} className="rounded border border-border px-2 py-1">
            <p className="text-[11px] font-medium" style={{ color: QUADRANT_FILL[q] }}>
              {KANO_LABELS[q].title}
            </p>
            <p className="text-[10.5px] text-muted">{KANO_LABELS[q].meaning}</p>
            <p className="text-[11px]">{names.length > 0 ? names.join("; ") : "None"}</p>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-muted">
        Both axes are centred on the average of the questions shown and scaled to standard deviations, so the dashed lines
        mark the middle of what was asked. Derived importance comes from the model above, not from asking. This follows the
        quadrant approach Lieberman (2023) describes, which uses Johnson&apos;s relative weights for the derived axis; the
        corner names are a market research convention, not a strict Kano survey. The gap between the two axes is the
        finding: a question high on derived and low on stated importance is doing more than people say.
      </p>
    </div>
  );
}
