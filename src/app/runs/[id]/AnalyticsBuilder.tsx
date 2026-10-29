"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type MouseEvent } from "react";
import { driverSummary, recordForRow } from "@/lib/driverPresentation";
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
import ResizableSplit from "./ResizableSplit";
import WaveTrackingPanel from "./WaveTrackingPanel";
import CsmAnalyticsPanel from "./CsmAnalyticsPanel";
import BrandHealthAnalyticsPanel from "./BrandHealthAnalyticsPanel";
import TrackerDashboardPanel, { type TrackerDashboardKind } from "./TrackerDashboardPanel";
import type { WaveFile } from "@/lib/waveTrackingActions";
import { ChartCustomizePanel, type LegendPos } from "./ChartCustomize";
import CrosstabWorkspace from "./CrosstabWorkspace";
import { ThreePane } from "./ThreePane";
import {
  runDistributionAction,
  addChartFindingAction,
  removeChartFindingAction,
  chartFindingStatusAction,
  type ChartMethod,
  type ChartResult,
} from "@/lib/chartActions";
import ChartVisual, { SERIES_COLORS } from "./ChartVisual";
import ScatterVisual from "./ScatterVisual";
import {
  addScatterFindingAction,
  removeScatterFindingAction,
  resolveScatterWordingReviewAction,
  runScatterAction,
  scatterFindingStatusAction,
  type ScatterResult,
  type ScatterWordingReview,
} from "@/lib/scatterActions";
import { histogramNote } from "@/lib/chartKinds";
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
import {
  readWorkspaceMemory,
  writeWorkspaceMemory,
  type RememberedCard,
  type ChartVariant,
  type RememberedDriver,
  type RememberedNps,
  type WorkspaceMemory,
} from "./analyticsWorkspaceMemory";
import { placeScatterCard, rebuiltCardNeedsRead, ScatterStatusClock, scatterRequestKey } from "./scatterCardState";
import { PENDING_POSTED_STATE, canPostOrRemove, postedStateFrom, type PostedState } from "./postedState";
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
 * The analytics tools for one data file (drivers, NPS, charts, wave tracking, CSM, brand health;
 * clustering is listed as not available yet). Each tool works in its own workspace because a survey can
 * have thousands of variables. The Analytics section shows them as a grid of cards (`layout="grid"`,
 * Grant, 2026-10-20); a data file's card elsewhere shows them as tiles, and `part` there shows the
 * Crosstabs tile alone or the analytics tiles alone (Cross tabs itself opens its workspace directly,
 * CrosstabsSection).
 */
type ToolId = "driver" | "nps" | "chart" | "wave" | "csm" | "brand";

export default function AnalyticsBuilder({
  runId,
  documentId,
  filename,
  saved,
  waveFiles,
  part = "all",
  layout = "card",
}: {
  runId: string;
  documentId: string;
  filename: string;
  saved: { id: string; label: string }[];
  waveFiles?: WaveFile[];
  part?: "crosstabs" | "analytics" | "all";
  /**
   * "grid": the Analytics section's tool grid (Grant's review, 2026-10-20), every working tool as a
   * card, Wave tracking shown with the reason when it cannot run, and tools not built yet set apart;
   * each tool opens its own workspace with "All analytics" to come back. "card": the launcher on a
   * data file's card elsewhere, as before.
   */
  layout?: "card" | "grid";
}) {
  const [tool, setTool] = useState<"driver" | "nps" | "chart" | "wave" | null>(null);
  const [showClustering, setShowClustering] = useState(false);
  const [crosstabOpen, setCrosstabOpen] = useState(false);
  const [csmOpen, setCsmOpen] = useState(false);
  const [brandHealthOpen, setBrandHealthOpen] = useState(false);
  // The automatic tracker dashboards (D3): separate tools, featured at the top of the Analytics page.
  const [trackerOpen, setTrackerOpen] = useState<TrackerDashboardKind | null>(null);
  const waves = waveFiles?.length ?? 0;
  const open = (id: ToolId) => (id === "csm" ? setCsmOpen(true) : id === "brand" ? setBrandHealthOpen(true) : setTool(id));
  // What each tool does, as its workspace does it (checked against the tools, 2026-10-20, instead of
  // the old blanket "uncorrected, simple random sampling" warning).
  const tools: { id: ToolId; name: string; text: string; unavailable?: string }[] = [
    {
      id: "driver",
      name: "Driver analysis",
      text: "Pick an outcome such as overall satisfaction and the questions that may explain it, and see which matter most, with the overlap between them handled.",
    },
    { id: "nps", name: "Net Promoter Score", text: "Pick a 0-10 likelihood-to-recommend question and get the score, promoters, passives, detractors and a 95% interval." },
    { id: "chart", name: "Charts", text: "Chart a question's answers as bars, a line or a histogram, or plot two numeric questions against each other, ready to copy or download." },
    {
      id: "wave",
      name: "Wave tracking",
      text: "Compare NPS, distributions and driver weights across the files labelled as waves of this tracking study.",
      unavailable: waves >= 2 ? undefined : `Needs two or more data files labelled as waves (in each file's Setup in Sources); ${waves === 1 ? "one is" : "none are"} labelled now.`,
    },
    {
      id: "csm",
      name: "CSM Analytics",
      text: "Map overall satisfaction, attributes, loyalty and a segment once, then get a scorecard with top-box scores and a driver ranking, on this file or across its waves.",
    },
    {
      id: "brand",
      name: "Brand Health Analytics",
      text: "Name the brand variable and which brand is ours, map the funnel, attributes, loyalty and category entry points once, then get a benchmark against every other brand in the file.",
    },
  ];
  // Grant, 29 October 2026: the automatic brand and CSM dashboards are their own tools ("hardly ever analysed
  // together"), prominent on the Analytics page; Brand Health and CSM Analytics stay below for ad hoc work.
  const dashboards: { kind: TrackerDashboardKind; name: string; text: string }[] = [
    {
      kind: "brand",
      name: "Brand tracking dashboard",
      text: "Built from the file itself: your brand's funnel with the change since the previous wave, the brands compared, and each stage across waves.",
    },
    {
      kind: "csm",
      name: "CSM dashboard",
      text: "Built from the file itself: satisfaction, NPS, likely to stay and switch with their change since the previous wave, the trend, service attributes and driver priority.",
    },
  ];
  const closeLabel = layout === "grid" ? "All analytics" : "Close";

  return (
    <div className={layout === "grid" ? "flex flex-col gap-4" : "rounded-lg border border-border bg-white p-3 text-xs"} data-testid={layout === "grid" ? "analytics-tools" : undefined}>
      {layout === "grid" ? (
        <>
          <section aria-label="Tracker dashboards" data-testid="tracker-dashboards">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Tracker dashboards</h3>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {dashboards.map((d) => (
                <li key={d.kind}>
                  <button
                    type="button"
                    onClick={() => setTrackerOpen(d.kind)}
                    className="flex h-full w-full flex-col items-start gap-1.5 rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5 text-left shadow-sm transition hover:border-blue-400 focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <span className="text-base font-semibold text-foreground">{d.name}</span>
                    <span className="text-xs leading-relaxed text-slate-600">{d.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <h3 className="-mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Analyses</h3>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Analyses">
            {tools.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => open(t.id)}
                  disabled={!!t.unavailable}
                  className="flex h-full w-full flex-col items-start gap-1.5 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:bg-slate-50 disabled:hover:border-slate-200"
                >
                  <span className="text-sm font-semibold text-foreground">{t.name}</span>
                  <span className="text-xs leading-relaxed text-slate-600">{t.text}</span>
                  {t.unavailable && <span className="mt-1 text-xs font-medium text-amber-800">{t.unavailable}</span>}
                </button>
              </li>
            ))}
          </ul>
          <section className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-4" aria-label="Not available yet">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Not available yet</h3>
            <p className="mt-2 text-sm font-medium text-foreground">Clustering</p>
            <p className="text-xs leading-relaxed text-slate-600">
              Group respondents into segments from the questions you choose. Not built yet: the plan is to try a range of cluster counts, suggest one by how stable and well-separated the segments are, then profile each segment in Cross tabs.
            </p>
          </section>
        </>
      ) : (
      <>
      <p className="mb-2 font-medium text-foreground">{part === "crosstabs" ? "Cross tabs" : "Analytics"}</p>
      <div className="flex flex-wrap gap-2">
        {part !== "analytics" && (
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
        )}
        {part !== "crosstabs" && (
        <>
        {dashboards.map((d) => (
          <button
            key={d.kind}
            type="button"
            onClick={() => setTrackerOpen(d.kind)}
            className="flex min-w-[170px] flex-1 basis-[170px] flex-col items-start gap-1 rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-left transition hover:border-primary/50"
          >
            <p className="font-medium text-foreground">{d.name}</p>
            <p className="text-[11px] text-muted">{d.text}</p>
          </button>
        ))}
        {tools
          .filter((t) => !t.unavailable)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => open(t.id)}
              className="flex min-w-[170px] flex-1 basis-[170px] flex-col items-start gap-1 rounded-lg border border-border bg-white p-3 text-left transition hover:border-primary/50 hover:bg-primary/5"
            >
              <p className="font-medium text-foreground">{t.name}</p>
              <p className="text-[11px] text-muted">{t.text}</p>
            </button>
          ))}
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
        </>
        )}
      </div>
      {showClustering && (
        <p className="mt-2 rounded border border-border bg-slate-50 px-2.5 py-2 text-[11px] text-muted">
          Not built yet. The plan: pick the segmentation questions, try a range of cluster counts, suggest one by how stable
          and well-separated the segments are, then profile each segment in Cross tabs. We&apos;ll add it here once it&apos;s
          working end to end, same as the other two.
        </p>
      )}
      </>
      )}
      {tool && (
        <AnalyticsWorkspace
          // A different file is a different workspace with its own remembered cards.
          key={`${runId}:${documentId}`}
          runId={runId}
          documentId={documentId}
          filename={filename}
          onClose={() => setTool(null)}
          closeLabel={closeLabel}
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
          closeLabel={closeLabel}
        />
      )}
      {trackerOpen && (
        <TrackerDashboardPanel
          key={`${runId}:${documentId}:${trackerOpen}`}
          kind={trackerOpen}
          runId={runId}
          documentId={documentId}
          filename={filename}
          onClose={() => setTrackerOpen(null)}
          closeLabel={closeLabel}
        />
      )}
      {brandHealthOpen && (
        <BrandHealthAnalyticsPanel
          runId={runId}
          documentId={documentId}
          filename={filename}
          waveFiles={waveFiles}
          onClose={() => setBrandHealthOpen(false)}
          closeLabel={closeLabel}
        />
      )}
    </div>
  );
}

const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : `${(v * 100).toFixed(d)}%`);

type ChartCard = {
  id: string;
  /** Creation order across every card in the grid; higher is newer (restored cards are negative). */
  seq: number;
  /** The variable as requested, which is what a return to the workspace asks for again. */
  requestVariable: string;
  weightVar: string | null;
  result: ChartResult;
  groupVar: string | null;
  committed: boolean;
  /** Set when the posted-state read failed: committed is then not known, and Post and Remove are withheld (postedState.ts). */
  statusError: string | null;
  commitBusy: boolean;
  title: string;
  colors: string[];
  legendPos: LegendPos;
  /** How the distribution is drawn; bar and line switch on the card without running again. */
  variant: "bar" | "line" | "histogram";
  /** Histogram only: how the bars were made, as the distribution action reported it (ChartResult.method). */
  histSource?: ChartMethod;
};

/** A scatter plot of two numeric variables; its correlation can be posted as a relationship finding. */
type ScatterCard = {
  id: string;
  /** Creation order across every card in the grid; higher is newer (restored cards are negative). */
  seq: number;
  result: ScatterResult;
  xVar: string;
  yVar: string;
  weightVar: string | null;
  title: string;
  spread: boolean;
  committed: boolean;
  /** Whether the posted finding was worked out from the file as it is now; null when unknown. */
  current: boolean | null;
  /**
   * Set when the researcher's own wording was kept while the figures changed under it (Codex
   * RR-01): the card offers keeping it for these figures or using the sentence the tool would
   * write now (RRV-01; calculated findings cannot be reworded in Findings).
   */
  wordingReview: ScatterWordingReview | null;
  wordingBusy: boolean;
  wordingError: string | null;
  /** The posted-state check failed, so committed=false means "not known", not "not posted". */
  statusFailed: boolean;
  commitBusy: boolean;
};

/**
 * A remembered card being worked out again on a return to the workspace, or one that could not be.
 * It holds the remembered request until it is rebuilt or cleared, so a failure (the variable has
 * gone, the server did not answer) is shown with its reason and never silently forgotten.
 */
type RestoreSlot = { id: string; seq: number; entry: RememberedCard; state: "loading" | "failed"; error?: string };
type NpsSlot = { req: RememberedNps; state: "loading" | "failed"; error?: string };
type DriverSlot = { remembered: RememberedDriver; state: "loading" | "failed"; error?: string };

// The chart type is part of a chart's identity: a bar and a line chart of the same question are two
// cards, both remembered and both rebuilt.
const chartKey = (variable: string, groupVar: string | null, weightVar: string | null, variant: ChartVariant) =>
  JSON.stringify([variable, groupVar, weightVar, variant]);
const scatterKey = scatterRequestKey;
const slotKey = (e: RememberedCard) =>
  e.kind === "chart" ? chartKey(e.variable, e.groupVar, e.weightVar, e.variant) : scatterKey(e.x, e.y, e.weightVar);
const describeRemembered = (e: RememberedCard) =>
  e.kind === "chart"
    ? `${e.variant === "histogram" ? "Histogram" : "Chart"} of ${e.variable}${e.groupVar ? ` by ${e.groupVar}` : ""}`
    : `Scatter plot of ${e.y} by ${e.x}`;
/** A server action that throws (a dropped connection) is reported, never treated as an empty result. */
const failedRequest = () => ({ ok: false as const, error: "The request to the server failed. Try again." });
const CLEAR_KEEPS = "Posted findings stay as they are.";

type ChartType = "bar" | "line" | "histogram" | "scatter";
const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: "bar", label: "Bar" },
  { id: "line", label: "Line" },
  { id: "histogram", label: "Histogram" },
  { id: "scatter", label: "Scatter" },
];

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
  closeLabel = "Close",
  initialTool,
}: {
  runId: string;
  documentId: string;
  filename: string;
  onClose: () => void;
  /** "All analytics" when opened from the Analytics tool grid, which it returns to. */
  closeLabel?: string;
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
  // Set when the NPS posted-state read failed: Post and Remove are withheld until a read succeeds (postedState.ts).
  const [npsStatusError, setNpsStatusError] = useState<string | null>(null);
  // UI-R1000-01: set while the NPS result's posted-state read has not answered; Post and Remove wait.
  const [npsStatusPending, setNpsStatusPending] = useState(false);
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
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [scatterX, setScatterX] = useState("");
  const [scatterY, setScatterY] = useState("");
  const [scatters, setScatters] = useState<ScatterCard[]>([]);
  // Card ids only need to be unique within this workspace; a counter keeps them stable and pure.
  const cardSeq = useRef(0);
  const [predictors, setPredictors] = useState<Set<string>>(new Set());
  const [predFilter, setPredFilter] = useState("");
  const [weightVar, setWeightVar] = useState("");
  // predictor -> its importance question. "" means the researcher chose none; a missing key means "use the suggestion".
  const [statedPick, setStatedPick] = useState<Record<string, string>>({});
  const [report, setReport] = useState<DriverReport | null>(null);
  const [driverGroupVar, setDriverGroupVar] = useState("");
  const [driverSeg, setDriverSeg] = useState<string | null>(null);
  const [driverSavedId, setDriverSavedId] = useState<string | null>(null);
  const [driverCommitBusy, setDriverCommitBusy] = useState(false);
  const [saved, setSaved] = useState<SavedDriverAnalysis[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Whether each saved analysis is in findings (RR-04, 2026-10-21). `counts` holds the counts known
  // for certain: from the last successful read, or from a post or removal made here since.
  // `countsRead` is the state of that read. While it is loading or has failed, an analysis with no
  // count here is unknown: neither Post nor Remove is offered for it (driverPostState), so a failed
  // read can never present a posted analysis as not posted. The server refuses duplicate findings
  // either way; this keeps the screen from offering the wrong action.
  const [counts, setCounts] = useState<Record<string, number>>({});
  // The outcome of the last read that answered, for the run it was made for; a read for another run
  // (or none yet) means this run's read is still loading.
  const [countsRead, setCountsRead] = useState<{ runId: string; state: "known" } | { runId: string; state: "failed"; error: string } | null>(null);
  const [countsRetrying, setCountsRetrying] = useState(false);
  // Ordering for count reads: only the newest read may publish (an older, slower answer must not
  // overwrite a newer one), and counts written here after a read started are not overwritten by it.
  const countsSeq = useRef(0);
  const countsWrittenSince = useRef(new Set<string>());
  const [, startTransition] = useTransition();

  // What this browser remembered for this run and file (analyticsWorkspaceMemory). Read once, on
  // opening: requests and saved ids only, each worked out again below, never cached figures.
  const [remembered] = useState(() => readWorkspaceMemory(runId, documentId));
  const [cardSlots, setCardSlots] = useState<RestoreSlot[]>(() =>
    // Newest first, as stored; negative seqs keep them in that order behind anything built now.
    remembered.memory.cards.map((entry, i) => ({ id: `restore-${i}`, seq: -(i + 1), entry, state: "loading" })),
  );
  const [npsSlot, setNpsSlot] = useState<NpsSlot | null>(() => (remembered.memory.nps ? { req: remembered.memory.nps, state: "loading" } : null));
  const [driverSlot, setDriverSlot] = useState<DriverSlot | null>(() =>
    remembered.memory.driver ? { remembered: remembered.memory.driver, state: "loading" } : null,
  );
  // The request behind the NPS result on screen, which is what the memory keeps for it.
  const [npsRequest, setNpsRequest] = useState<RememberedNps | null>(null);
  // Late answers must not overwrite newer actions (the countsSeq pattern): a restore publishes only
  // while its epoch is current (Clear all and closing end every restore in flight), only into a slot
  // that has not been cleared, and the NPS and driver results only while no newer run, reopen or
  // Clear has happened for that tool (npsSeq, driverSeq).
  const restoreEpoch = useRef(0);
  const liveSlots = useRef(new Set(cardSlots.map((s) => s.id)));
  const npsSeq = useRef(0);
  const driverSeq = useRef(0);
  // Which scatter status read is newest per request; a post, take-back or wording decision starts a
  // new generation so a read from before it never lands over it (scatterCardState).
  const scatterStatusClock = useRef(new ScatterStatusClock());
  const openingListing = useRef<Promise<Awaited<ReturnType<typeof listDriverAnalysesAction>>> | null>(null);

  /** Reads which saved analyses are in findings, on opening. A failure is shown, never read as zero. */
  function requestDriverCounts() {
    const seq = ++countsSeq.current;
    const forRun = runId;
    countsWrittenSince.current = new Set();
    const publish = (r: Awaited<ReturnType<typeof driverFindingCountsAction>>) => {
      if (seq !== countsSeq.current) return;
      setCountsRetrying(false);
      if (!r.ok) {
        setCountsRead({ runId: forRun, state: "failed", error: r.error });
        return;
      }
      const written = countsWrittenSince.current;
      setCounts((prev) => {
        const next: Record<string, number> = { ...r.counts };
        for (const id of written) {
          if (id in prev) next[id] = prev[id];
        }
        return next;
      });
      setCountsRead({ runId: forRun, state: "known" });
    };
    driverFindingCountsAction(forRun).then(publish, (e: unknown) => publish({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  }

  /** Retry after a failed read: shows "Checking..." again until the new read answers. */
  function readDriverCounts() {
    setCountsRetrying(true);
    requestDriverCounts();
  }

  /** Records a count learnt from a post or removal made here: known, and kept over an older read. */
  function setDriverCount(id: string, n: number) {
    countsWrittenSince.current.add(id);
    setCounts((c) => ({ ...c, [id]: n }));
  }

  useEffect(() => {
    let live = true;
    loadVariablesAction(runId, documentId).then((r) => {
      if (!live) return;
      if (r.ok) setDict(r.dictionary);
      else setError(r.error);
    });
    const listing = listDriverAnalysesAction(runId, documentId).catch(failedRequest);
    openingListing.current = listing; // a remembered saved analysis is found in this same read
    listing.then((r) => {
      if (!live) return;
      if (r.ok) setSaved(r.items);
      else setError(`Saved analyses could not be loaded: ${r.error}`);
    });
    requestDriverCounts();
    return () => {
      live = false;
      countsSeq.current += 1; // a read still in flight for the previous run no longer publishes
    };
  }, [runId, documentId]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Whether a saved analysis is in findings: known (from a count), or loading / failed while the
   * read has not answered for it. A successful read lists only analyses with findings, so an
   * analysis it does not list is known to have none.
   */
  function driverPostState(id: string): DriverPostState {
    if (id in counts) return { state: "known", n: counts[id] };
    const read = countsRead?.runId === runId && !countsRetrying ? countsRead : null;
    if (read?.state === "known") return { state: "known", n: 0 };
    if (read?.state === "failed") return { state: "failed", error: read.error };
    return { state: "loading" };
  }
  // The result on screen: an analysis not yet saved has no findings. Derived on every render, so a
  // count that arrives, or a Retry that succeeds, updates the open result without reselecting it.
  const openPostState: DriverPostState = driverSavedId ? driverPostState(driverSavedId) : { state: "known", n: 0 };
  const driverCommitted = openPostState.state === "known" && openPostState.n > 0;

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
    const seq = ++driverSeq.current;
    setDriverSlot(null);
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
    const r = await runDriverAnalysisAction(runId, documentId, request).catch(failedRequest);
    setBusy(false);
    if (seq !== driverSeq.current) return; // cleared or replaced while it ran
    setDriverSavedId(null);
    setDriverSeg(null);
    if (r.ok) setReport(r.report);
    else {
      setReport(null);
      setError(r.error);
    }
  }

  async function runNps() {
    if (!npsVariable) return;
    const seq = ++npsSeq.current;
    const req: RememberedNps = { variable: npsVariable, weightVar: weightVar || null, groupVar: npsGroupVar || null };
    setNpsSlot(null);
    setNpsBusy(true);
    setNpsError(null);
    setNpsResult(null);
    setNpsRequest(null);
    setNpsCommitted(false);
    setNpsStatusError(null);
    setNpsSeg(null);
    const r = await runNpsAction(runId, documentId, req.variable, req.weightVar, req.groupVar).catch(failedRequest);
    setNpsBusy(false);
    if (seq !== npsSeq.current) return;
    if (r.ok) {
      // The figures are shown at once; whether they are posted is "checking" until the read answers.
      applyNpsPostedState(PENDING_POSTED_STATE);
      setNpsResult(r.result);
      setNpsRequest(req);
      const status = await npsFindingStatusAction(runId, documentId, r.result.variable).catch(failedRequest);
      if (seq === npsSeq.current) applyNpsPostedState(postedStateFrom(status));
    } else setNpsError(r.error);
  }

  /** Works a remembered NPS result out again from the current file; a newer NPS action wins. */
  async function restoreNps(req: RememberedNps, epoch: number) {
    const seq = npsSeq.current;
    const stillWanted = () => epoch === restoreEpoch.current && seq === npsSeq.current;
    setNpsSlot({ req, state: "loading" });
    const r = await runNpsAction(runId, documentId, req.variable, req.weightVar, req.groupVar).catch(failedRequest);
    if (!stillWanted()) return;
    if (!r.ok) return setNpsSlot({ req, state: "failed", error: r.error });
    const status = await npsFindingStatusAction(runId, documentId, r.result.variable).catch(failedRequest);
    if (!stillWanted()) return;
    setNpsSlot(null);
    setNpsVariable(req.variable);
    setNpsGroupVar(req.groupVar ?? "");
    setNpsResult(r.result);
    setNpsRequest(req);
    setNpsSeg(null);
    applyNpsPostedState(postedStateFrom(status));
  }

  function applyNpsPostedState(p: PostedState) {
    setNpsCommitted(p.committed);
    setNpsStatusError(p.statusError);
    setNpsStatusPending(!!p.pending);
  }

  /** Reads the NPS result's posted state again after it failed; a newer NPS action or a Clear wins. */
  async function retryNpsPostedState() {
    if (!npsResult) return;
    const seq = npsSeq.current;
    applyNpsPostedState(PENDING_POSTED_STATE);
    const status = await npsFindingStatusAction(runId, documentId, npsResult.variable).catch(failedRequest);
    if (seq === npsSeq.current) applyNpsPostedState(postedStateFrom(status));
  }

  /** Clear: takes the NPS result off the workspace and out of the memory; findings are untouched. */
  function clearNps() {
    npsSeq.current += 1;
    setNpsSlot(null);
    setNpsResult(null);
    setNpsRequest(null);
    setNpsCommitted(false);
    setNpsStatusError(null);
    setNpsStatusPending(false);
    setNpsSeg(null);
    setNpsError(null);
  }

  async function toggleNpsFinding() {
    if (!npsResult || !canPostOrRemove({ committed: npsCommitted, statusError: npsStatusError, pending: npsStatusPending })) return;
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

  /**
   * Works out one chart card from the current file: the distribution, then whether it is posted.
   * Shared by building and by restoring, so a restored card is made exactly as a new one is.
   * `look` carries remembered presentation choices (title, colours, legend), never figures.
   */
  async function computeChartCard(
    variable: string,
    wv: string | null,
    groupVar: string | null,
    variant: "bar" | "line" | "histogram",
    seq: number,
    look?: { title: string | null; colors: string[] | null; legendPos: LegendPos },
  ): Promise<{ ok: true; card: ChartCard } | { ok: false; error: string }> {
    // The engine has no grouped histogram, so a histogram is always of all respondents.
    const gv = variant === "histogram" ? null : groupVar;
    const r = await runDistributionAction(runId, documentId, variable, wv, gv).catch(failedRequest);
    if (!r.ok) return r;
    const status = await chartFindingStatusAction(runId, documentId, r.result.variable, gv).catch(failedRequest);
    const defaults = r.result.series.map((_, i) => SERIES_COLORS[i % SERIES_COLORS.length]);
    return {
      ok: true,
      card: {
        id: `chart-${++cardSeq.current}`,
        seq,
        requestVariable: variable,
        weightVar: wv,
        result: r.result,
        groupVar: gv,
        ...postedStateFrom(status),
        commitBusy: false,
        title: look?.title || r.result.label,
        // Remembered colours fit only while the file gives the same number of series.
        colors: look?.colors && look.colors.length === defaults.length ? look.colors : defaults,
        legendPos: look?.legendPos ?? "top",
        variant,
        // The note says how the bars were actually made, from the result (IR-10), not from the variable.
        histSource: variant === "histogram" ? r.result.method : undefined,
      },
    };
  }

  /** Works out one scatter card from the current file; shared by building and restoring. */
  async function computeScatterCard(
    x: string,
    y: string,
    wv: string | null,
    seq: number,
    spread = false,
  ): Promise<{ ok: true; card: ScatterCard; statusGeneration: number } | { ok: false; error: string }> {
    // A call that fails outright (a dropped connection, a server error) says so; before, it left
    // nothing on screen (Grant, 2026-10-20: "scatter plot not rendering").
    const r = await runScatterAction(runId, documentId, x, y, wv).catch(() => ({
      ok: false as const,
      error: "The scatter plot could not be built: the request to the server failed. Try again.",
    }));
    if (!r.ok) return r;
    const statusGeneration = scatterStatusClock.current.begin(scatterKey(x, y, wv));
    const status = await scatterFindingStatusAction(runId, documentId, x, y, wv).catch(() => ({ ok: false as const }));
    return {
      ok: true,
      statusGeneration,
      card: {
        id: `scatter-${++cardSeq.current}`,
        seq,
        result: r.result,
        xVar: x,
        yVar: y,
        weightVar: wv,
        title: `${r.result.y.label} by ${r.result.x.label}`,
        spread,
        committed: status.ok ? status.committed : false,
        current: status.ok ? status.current : null,
        wordingReview: status.ok ? status.wordingReview : null,
        wordingBusy: false,
        wordingError: null,
        statusFailed: !status.ok,
        commitBusy: false,
      },
    };
  }

  /** New cards land at the start of the one grid; this brings the new one into view. */
  const scrollToCard = (id: string) =>
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" }));

  async function runChart() {
    if (chartType === "scatter") return runScatter();
    if (!chartVariable) return;
    setChartBusy(true);
    setChartError(null);
    const r = await computeChartCard(chartVariable, weightVar || null, chartGroupVar || null, chartType, ++cardSeq.current);
    setChartBusy(false);
    if (!r.ok) return setChartError(r.error);
    setCharts((prev) => [...prev, r.card]);
    setSelectedChartId(r.card.id);
    scrollToCard(r.card.id);
  }

  async function runScatter() {
    if (!scatterX || !scatterY || scatterX === scatterY) return;
    setChartBusy(true);
    setChartError(null);
    const wv = weightVar || null;
    const r = await computeScatterCard(scatterX, scatterY, wv, ++cardSeq.current);
    setChartBusy(false);
    if (!r.ok) return setChartError(r.error);
    // One card per scatter request: a scatter card carries its finding's posted and wording state,
    // and two copies of the same pair would disagree once one of them is acted on. Building it again
    // replaces the earlier card (or a remembered one still waiting) and brings it to the front.
    // If the researcher acted on the earlier card while this one was being built, that card's state
    // is newer than this card's read: placeScatterCard keeps it, and a fresh read settles it.
    const key = scatterKey(scatterX, scatterY, wv);
    const statusIsLatest = scatterStatusClock.current.isLatest(key, r.statusGeneration);
    dropSlots((e) => slotKey(e) === key);
    setScatters((prev) => placeScatterCard(prev, r.card, statusIsLatest));
    if (rebuiltCardNeedsRead(scatterStatusClock.current, key, r.statusGeneration)) void refreshScatterStatus(r.card);
    scrollToCard(r.card.id);
  }

  /** Updates the scatter card for a request, whichever card currently stands for it. */
  function patchScatter(key: string, p: Partial<ScatterCard>) {
    setScatters((prev) => prev.map((c) => (scatterKey(c.xVar, c.yVar, c.weightVar) === key ? { ...c, ...p } : c)));
  }

  /**
   * Reads a scatter finding's state again and shows it only if no newer read or action has started
   * for the request meanwhile. Returns whether it was shown. A failed read shows the state as not
   * known ("unknown"), or leaves the card as it was ("keep", after a wording decision whose own
   * error is shown on the card).
   */
  async function refreshScatterStatus(
    req: { xVar: string; yVar: string; weightVar: string | null },
    onFail: "unknown" | "keep" = "unknown",
  ): Promise<boolean> {
    const key = scatterKey(req.xVar, req.yVar, req.weightVar);
    const generation = scatterStatusClock.current.begin(key);
    const status = await scatterFindingStatusAction(runId, documentId, req.xVar, req.yVar, req.weightVar).catch(() => ({ ok: false as const }));
    if (!scatterStatusClock.current.isLatest(key, generation)) return false;
    if (status.ok) patchScatter(key, { committed: status.committed, current: status.current, wordingReview: status.wordingReview, statusFailed: false });
    else if (onFail === "unknown") patchScatter(key, { current: null, wordingReview: null });
    return true;
  }

  /** Removes remembered cards still waiting (or failed) that match, so they never publish later. */
  function dropSlots(match: (e: RememberedCard) => boolean) {
    setCardSlots((prev) =>
      prev.filter((sl) => {
        if (!match(sl.entry)) return true;
        liveSlots.current.delete(sl.id);
        return false;
      }),
    );
  }

  /**
   * Rebuilds one remembered card in its remembered place. It publishes only while its epoch is
   * current and its slot has not been cleared, and never beside a card for the same request built
   * meanwhile. A failure keeps the slot, with the reason, Try again and Clear.
   */
  async function restoreCard(slot: RestoreSlot, epoch: number) {
    const e = slot.entry;
    const r =
      e.kind === "chart"
        ? await computeChartCard(e.variable, e.weightVar, e.groupVar, e.variant, slot.seq, e)
        : await computeScatterCard(e.x, e.y, e.weightVar, slot.seq, e.spread);
    if (epoch !== restoreEpoch.current || !liveSlots.current.has(slot.id)) return;
    if (!r.ok) {
      setCardSlots((prev) => prev.map((sl) => (sl.id === slot.id ? { ...sl, state: "failed", error: r.error } : sl)));
      return;
    }
    liveSlots.current.delete(slot.id);
    setCardSlots((prev) => prev.filter((sl) => sl.id !== slot.id));
    const key = slotKey(e);
    if (e.kind === "chart") {
      const card = r.card as ChartCard;
      setCharts((prev) =>
        // Skipped only when the researcher built the same chart during this visit (a positive seq);
        // other remembered cards never knock each other out.
        prev.some((c) => c.seq > 0 && chartKey(c.requestVariable, c.groupVar, c.weightVar, c.variant) === key) ? prev : [...prev, card],
      );
    } else {
      const card = r.card as ScatterCard;
      // A card for the same request built meanwhile is newer and stays; otherwise the restored card
      // goes in, with a fresh read if an action started for the request while it was rebuilt.
      const needsRead = "statusGeneration" in r && rebuiltCardNeedsRead(scatterStatusClock.current, key, r.statusGeneration);
      setScatters((prev) => (prev.some((c) => scatterKey(c.xVar, c.yVar, c.weightVar) === key) ? prev : [...prev, card]));
      if (needsRead) void refreshScatterStatus(card);
    }
  }

  function retrySlot(slot: RestoreSlot) {
    setCardSlots((prev) => prev.map((sl) => (sl.id === slot.id ? { ...sl, state: "loading", error: undefined } : sl)));
    void restoreCard(slot, restoreEpoch.current);
  }

  function clearSlot(id: string) {
    liveSlots.current.delete(id);
    setCardSlots((prev) => prev.filter((sl) => sl.id !== id));
  }

  /**
   * Posts or takes back a scatter's correlation; the server reads the file again to compute it.
   * `update` posts again over a finding worked out from an earlier version of the file, which the
   * server updates in place with the current figures (scatterActions, Codex IR-01).
   */
  async function toggleScatterCommit(cardId: string, update = false) {
    const card = scatters.find((c) => c.id === cardId);
    if (!card) return;
    // Addressed by request, so the result lands on the card on screen even if a rebuild replaced it.
    const key = scatterKey(card.xVar, card.yVar, card.weightVar);
    const patch = (p: Partial<ScatterCard>) => patchScatter(key, p);
    scatterStatusClock.current.beginWrite(key); // reads already in flight predate this write
    try {
      await commitScatter(card, update, patch);
    } finally {
      scatterStatusClock.current.endWrite(key);
    }
  }

  async function commitScatter(card: ScatterCard, update: boolean, patch: (p: Partial<ScatterCard>) => void) {
    patch({ commitBusy: true });
    const r = card.committed && !update
      ? await removeScatterFindingAction(runId, documentId, card.xVar, card.yVar, card.weightVar)
      : await addScatterFindingAction(runId, documentId, card.xVar, card.yVar, card.weightVar);
    if (r.ok) {
      patch({ committed: update ? true : !card.committed, current: card.committed && !update ? card.current : true, statusFailed: false, commitBusy: false });
      // A post can keep the researcher's wording and flag it for rewording (RR-01), which only the
      // server knows, so the card reads the finding's state again rather than assuming it.
      await refreshScatterStatus(card);
      setMessage(update ? "Updated the finding with the current figures." : card.committed ? "Took the finding out of use." : "Added to findings.");
      startTransition(() => router.refresh());
    } else {
      setError(r.error);
      patch({ commitBusy: false });
    }
  }

  /**
   * The researcher's decision on wording kept over changed figures (RRV-01). It carries the
   * sentence the card showed; when the server's suggestion has moved on it refuses as stale and
   * writes nothing. Either way the card reads the finding's state again rather than assuming it.
   */
  async function resolveScatterWording(cardId: string, choice: "keep" | "use_current") {
    const card = scatters.find((c) => c.id === cardId);
    if (!card?.wordingReview) return;
    const key = scatterKey(card.xVar, card.yVar, card.weightVar);
    const patch = (p: Partial<ScatterCard>) => patchScatter(key, p);
    scatterStatusClock.current.beginWrite(key); // a read already in flight would show the review from before this decision
    try {
      await decideScatterWording(card, choice, patch);
    } finally {
      scatterStatusClock.current.endWrite(key);
    }
  }

  async function decideScatterWording(card: ScatterCard, choice: "keep" | "use_current", patch: (p: Partial<ScatterCard>) => void) {
    if (!card.wordingReview) return;
    patch({ wordingBusy: true, wordingError: null });
    const r = await resolveScatterWordingReviewAction(runId, documentId, card.xVar, card.yVar, card.weightVar, choice, card.wordingReview.suggested_text).catch(
      () => ({ ok: false as const, error: "The request to the server failed. Nothing is known to have changed; try again." }),
    );
    await refreshScatterStatus(card, "keep");
    patch({ wordingBusy: false, wordingError: r.ok ? null : r.error });
    if (r.ok) {
      setMessage(choice === "keep" ? "Kept your wording for the current figures." : "The finding now uses the current wording; your earlier wording is kept on record.");
      startTransition(() => router.refresh());
    }
  }

  function removeChartCard(cardId: string) {
    setCharts((prev) => prev.filter((c) => c.id !== cardId));
    setSelectedChartId((prev) => (prev === cardId ? null : prev));
  }

  function updateChartCard(cardId: string, patch: Partial<ChartCard>) {
    setCharts((prev) => prev.map((c) => (c.id === cardId ? { ...c, ...patch } : c)));
  }

  /** Reads one chart card's posted state again after it failed. */
  async function retryChartPostedState(cardId: string) {
    const card = charts.find((c) => c.id === cardId);
    if (!card) return;
    const status = await chartFindingStatusAction(runId, documentId, card.result.variable, card.groupVar).catch(failedRequest);
    setCharts((prev) => prev.map((c) => (c.id === cardId && c.statusError !== null ? { ...c, ...postedStateFrom(status) } : c)));
  }

  /** The commit action for one chart card: posts or takes back its finding, same shape as the driver/NPS tools. */
  async function toggleChartCommit(cardId: string) {
    const card = charts.find((c) => c.id === cardId);
    if (!card || !canPostOrRemove(card)) return;
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
    driverSeq.current += 1;
    setDriverSlot(null);
    setOutcome(variable);
    setOutcomeType("binary");
    setTopBoxMin("9");
    setPredictors(new Set());
    setReport(null);
    setDriverSavedId(null);
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
    if (!report || openPostState.state !== "known") return;
    setDriverCommitBusy(true);
    if (driverCommitted && driverSavedId) {
      const r = await removeDriverFindingsAction(runId, driverSavedId);
      setDriverCommitBusy(false);
      if (r.ok) {
        setDriverCount(driverSavedId, 0);
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
      setDriverCount(id, 0); // just saved, so known to have no findings yet
      setDriverSavedId(id);
      const list = await listDriverAnalysesAction(runId, documentId);
      if (list.ok) setSaved(list.items);
    }
    const r = await addDriverFindingsAction(runId, id);
    setDriverCommitBusy(false);
    if (r.ok) {
      setDriverCount(id, r.added + r.alreadyPosted);
      setMessage(postedMessage(r.added, r.alreadyPosted));
      startTransition(() => router.refresh());
    } else setError(r.error);
  }

  /**
   * Reopens a saved analysis as it was made (IR-03, 2026-10-20): its result, the request behind it in
   * the controls (outcome, outcome type and top box, predictors, weight, group by, stated importance),
   * and its saved identity; whether it is in findings is derived from its count as that is known.
   * Posting it again then works on this same
   * analysis instead of saving a copy. The result comes from the saved list already on screen, so
   * there is no second read whose late answer could overwrite a newer choice.
   */
  function reopenSaved(s: SavedDriverAnalysis) {
    driverSeq.current += 1; // the researcher's choice wins over a restore still in flight
    setDriverSlot(null);
    showSavedAnalysis(s);
    setError(null);
    setMessage(null);
  }

  /** Puts a saved analysis on screen with the request behind it in the controls. */
  function showSavedAnalysis(s: SavedDriverAnalysis) {
    showDriverRequest(s.report.request);
    setReport(s.report);
    setDriverSeg(null);
    setDriverSavedId(s.id); // whether it is in findings follows from its count (openPostState)
  }

  /** The controls as the request set them: outcome and top box, predictors, weight, group by, stated importance. */
  function showDriverRequest(req: DriverRequest) {
    setOutcomeFilter("");
    setPredFilter("");
    setOutcome(req.outcome);
    setOutcomeType(req.outcomeType);
    setTopBoxMin(req.outcomeType === "binary" && req.topBoxMin != null ? String(req.topBoxMin) : "");
    setPredictors(new Set(req.predictors));
    setWeightVar(req.weightVar ?? "");
    setDriverGroupVar(req.groupVar ?? "");
    // Predictors without a stated-importance question were saved without one: "" keeps that choice
    // instead of falling back to a suggestion the saved result never used.
    const stated = req.statedImportance ?? {};
    setStatedPick(Object.fromEntries(req.predictors.map((p) => [p, stated[p] ?? ""] as const)));
  }

  /**
   * Reopens the remembered driver result. A saved analysis is found by its id in the saved list
   * read on opening (one read, shared with the list on screen); if the list no longer has it, the
   * slot says so rather than showing an older copy. An unsaved result is run again from its
   * request on the current file: the statistics engine, not a model, and nothing is saved.
   */
  async function restoreDriver(
    rem: RememberedDriver,
    epoch: number,
    listing: Promise<Awaited<ReturnType<typeof listDriverAnalysesAction>>>,
  ) {
    const seq = driverSeq.current;
    const stillWanted = () => epoch === restoreEpoch.current && seq === driverSeq.current;
    setDriverSlot({ remembered: rem, state: "loading" });
    if (rem.kind === "saved") {
      const list = await listing;
      if (!stillWanted()) return;
      if (!list.ok) return setDriverSlot({ remembered: rem, state: "failed", error: `Saved analyses could not be read: ${list.error}` });
      const found = list.items.find((x) => x.id === rem.savedId);
      if (!found)
        return setDriverSlot({
          remembered: rem,
          state: "failed",
          error: "This saved analysis is no longer in Saved analyses for this file; it may have been deleted.",
        });
      setDriverSlot(null);
      showSavedAnalysis(found);
      return;
    }
    const r = await runDriverAnalysisAction(runId, documentId, rem.request).catch(failedRequest);
    if (!stillWanted()) return;
    if (!r.ok) return setDriverSlot({ remembered: rem, state: "failed", error: r.error });
    setDriverSlot(null);
    showDriverRequest(rem.request);
    setReport(r.report);
    setDriverSeg(null);
    setDriverSavedId(null);
  }

  function retryDriverSlot() {
    if (!driverSlot) return;
    const listing = listDriverAnalysesAction(runId, documentId).catch(failedRequest);
    listing.then((r) => {
      if (r.ok) setSaved(r.items);
    });
    void restoreDriver(driverSlot.remembered, restoreEpoch.current, listing);
  }

  /** Clear: takes the driver result off the workspace and out of the memory. A saved analysis stays saved. */
  function clearDriver() {
    driverSeq.current += 1;
    setDriverSlot(null);
    setReport(null);
    setDriverSavedId(null);
    setDriverSeg(null);
  }

  // One grid for every chart kind (Grant, 2026-10-21: a scatter sat alone and full width above the
  // tiled charts). Newest first by creation order; remembered cards still being rebuilt hold their
  // place in it.
  type GridItem =
    | { kind: "chart"; seq: number; card: ChartCard }
    | { kind: "scatter"; seq: number; card: ScatterCard }
    | { kind: "slot"; seq: number; slot: RestoreSlot };
  const grid: GridItem[] = [
    ...charts.map((card) => ({ kind: "chart" as const, seq: card.seq, card })),
    ...scatters.map((card) => ({ kind: "scatter" as const, seq: card.seq, card })),
    ...cardSlots.map((slot) => ({ kind: "slot" as const, seq: slot.seq, slot })),
  ].sort((a, b) => b.seq - a.seq);

  // What the memory keeps: the grid in its order, and the NPS and driver results by request or
  // saved id. A slot still rebuilding, or one that failed, is kept as remembered until cleared.
  const memory: WorkspaceMemory = {
    cards: grid.map((g): RememberedCard =>
      g.kind === "slot"
        ? g.slot.entry
        : g.kind === "chart"
          ? {
              kind: "chart",
              variable: g.card.requestVariable,
              groupVar: g.card.groupVar,
              weightVar: g.card.weightVar,
              variant: g.card.variant,
              title: g.card.title !== g.card.result.label ? g.card.title : null,
              colors: g.card.colors,
              legendPos: g.card.legendPos,
            }
          : { kind: "scatter", x: g.card.xVar, y: g.card.yVar, weightVar: g.card.weightVar, spread: g.card.spread },
    ),
    nps: npsResult && npsRequest ? npsRequest : (npsSlot?.req ?? null),
    driver: report
      ? driverSavedId
        ? { kind: "saved", savedId: driverSavedId }
        : { kind: "request", request: report.request }
      : (driverSlot?.remembered ?? null),
  };
  const memoryJson = JSON.stringify(memory);
  // The chart whose title and colours are being edited: the one last clicked, else the newest.
  const newestChart = grid.find((g) => g.kind === "chart");
  const editingChartId =
    charts.find((c) => c.id === selectedChartId)?.id ?? (newestChart?.kind === "chart" ? newestChart.card.id : null);
  useEffect(() => {
    // Written after every change, so leaving by any route (Close, another section, a reload) keeps it.
    writeWorkspaceMemory(runId, documentId, JSON.parse(memoryJson) as WorkspaceMemory);
  }, [runId, documentId, memoryJson]);
  const keptCount = memory.cards.length + (memory.nps ? 1 : 0) + (memory.driver ? 1 : 0);

  useEffect(() => {
    // Rebuild what was on screen last time, after the opening reads above have started (effects
    // run in order). Reads only: no finding is posted, nothing is saved and no model is called.
    const epoch = ++restoreEpoch.current;
    for (const slot of cardSlots) void restoreCard(slot, epoch);
    if (npsSlot) void restoreNps(npsSlot.req, epoch);
    if (driverSlot) void restoreDriver(driverSlot.remembered, epoch, openingListing.current ?? listDriverAnalysesAction(runId, documentId).catch(failedRequest));
    return () => {
      restoreEpoch.current += 1; // a restore in flight no longer publishes (React runs this twice in development)
    };
  }, [runId, documentId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Clear all: every card and result for this file leaves the workspace and the memory. */
  function clearAll() {
    restoreEpoch.current += 1; // no restore still in flight may put a card back
    liveSlots.current.clear();
    setCardSlots([]);
    setCharts([]);
    setScatters([]);
    setSelectedChartId(null);
    setChartError(null);
    clearNps();
    clearDriver();
    setMessage("Cleared this file's results from the workspace. Saved analyses and posted findings are unchanged.");
  }

  /** The message after a post: says so when the findings were already there instead of "Posted 0". */
  const postedMessage = (added: number, alreadyPosted: number) =>
    added === 0 && alreadyPosted > 0
      ? `Already in findings (${alreadyPosted}); nothing was added again.`
      : `Posted ${added} finding${added === 1 ? "" : "s"}, marked as modelled results.`;

  const savedBlock =
    saved.length > 0 ? (
            <section className="space-y-1.5">
              <p className="font-medium text-foreground">Saved analyses</p>
              {saved.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1">
                  <button type="button" className="text-left text-primary hover:underline" aria-current={driverSavedId === s.id ? "true" : undefined} onClick={() => reopenSaved(s)}>
                    {s.title} <span className="text-muted">({new Date(s.createdAt).toLocaleDateString()})</span>
                  </button>
                  <span className="flex shrink-0 items-center gap-2">
                    {(() => {
                      const ps = driverPostState(s.id);
                      if (ps.state !== "known") return <DriverPostStatus state={ps} onRetry={readDriverCounts} compact />;
                      return ps.n > 0 ? (
                        <button
                          type="button"
                          className="text-muted hover:underline"
                          onClick={async () => {
                            const r = await removeDriverFindingsAction(runId, s.id);
                            if (r.ok) {
                              setDriverCount(s.id, 0);
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
                              setDriverCount(s.id, r.added + r.alreadyPosted);
                              setMessage(postedMessage(r.added, r.alreadyPosted));
                              startTransition(() => router.refresh());
                            } else setError(r.error);
                          }}
                        >
                          Post to findings
                        </button>
                      );
                    })()}
                    <button
                      type="button"
                      className="text-muted hover:text-danger"
                      onClick={async () => {
                        const r = await deleteDriverAnalysisAction(runId, s.id);
                        if (!r.ok) {
                          setError(r.error);
                          return;
                        }
                        setSaved((p) => p.filter((x) => x.id !== s.id));
                        if (driverSavedId === s.id) setDriverSavedId(null);
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
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-2.5">
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
            {closeLabel === "Close" ? "Close" : `← ${closeLabel}`}
          </button>
        </div>
      </div>
      {mode === "wave" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <WaveTrackingPanel runId={runId} />
        </div>
      ) : (
      // The shared panes (Grant, 2026-10-20): the setup pane collapses to a rail and every pane can be
      // dragged wider or narrower; the widths are remembered for this workspace.
      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100 p-3 lg:overflow-hidden">
      <ThreePane
        storageKey="analytics-workspace"
        leftDefaultPx={384}
        leftMaxShare={0.45}
        left={
        <div className={`flex min-h-0 flex-col gap-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-xs lg:h-[calc(100vh-5.5rem)] ${mode === "driver" ? "pb-0" : ""}`} data-testid="analytics-setup-pane">
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
                    // Choosing another question supersedes the result on screen, and a restore of it.
                    npsSeq.current += 1;
                    setNpsSlot(null);
                    setNpsVariable(e.target.value);
                    setNpsResult(null);
                    setNpsRequest(null);
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
              {/* The kind of chart is chosen first, as it decides what the rest of the setup asks for. */}
              <section className="space-y-1.5">
                <p className="font-medium text-foreground">Chart type</p>
                <div className="grid grid-cols-4 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1" role="radiogroup" aria-label="Chart type">
                  {CHART_TYPES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={chartType === t.id}
                      onClick={() => setChartType(t.id)}
                      className={`rounded-md px-1.5 py-1 text-xs font-medium ${chartType === t.id ? "bg-primary text-white shadow-sm" : "text-slate-600 hover:bg-white"}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-600">
                  {chartType === "bar" || chartType === "line"
                    ? "A question's answer distribution. Bar and line can be switched on the chart afterwards."
                    : chartType === "histogram"
                      ? "How a numeric question's answers spread out, as touching bars."
                      : "Two numeric questions, one point per respondent who answered both, with their correlation."}
                </p>
              </section>
              {chartType === "scatter" ? (
                <section className="space-y-2">
                  {(
                    [
                      ["X axis", scatterX, setScatterX, scatterY],
                      ["Y axis", scatterY, setScatterY, scatterX],
                    ] as const
                  ).map(([label, value, set, other]) => (
                    <label key={label} className="block space-y-1">
                      <span className="font-medium text-foreground">{label}</span>
                      <select value={value} onChange={(e) => set(e.target.value)} className="w-full rounded border border-slate-200 px-1 py-1" aria-label={`${label} variable`}>
                        <option value="">Choose a numeric question</option>
                        {vars
                          .filter((v) => v.name !== other)
                          .map((v) => (
                            <option key={v.name} value={v.name}>
                              {v.name}: {v.label}
                            </option>
                          ))}
                      </select>
                    </label>
                  ))}
                </section>
              ) : (
              <>
              <section className="flex min-h-0 flex-1 flex-col space-y-1.5">
                <p className="font-medium text-foreground">Question</p>
                <p className="text-[11px] text-muted">
                  {chartType === "histogram"
                    ? "A numeric question. A scale is drawn one bar per answer value; a question with many values, such as age, in the engine's bins."
                    : "Any question with discrete answers. Open ended and pure numeric averages don't chart here."}
                </p>
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
              {chartType !== "histogram" && (
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
              )}
              </>
              )}
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
                disabled={(chartType === "scatter" ? !scatterX || !scatterY || scatterX === scatterY : !chartVariable) || chartBusy}
                onClick={runChart}
                className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                {chartBusy ? "Charting..." : chartType === "scatter" ? "Build scatter plot" : "Build chart"}
              </button>
            </>
          )}
          {mode === "driver" && (
          <>
          {/* Required choices first (Grant's review, 2026-10-20); optional settings folded below with a
              summary of what is set; Run kept at the foot of the pane, saying what is still missing. */}
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Required</p>
          <section className="flex flex-col space-y-1.5">
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
              className="h-36 w-full rounded border border-slate-200 px-1 py-1"
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

          <section className="flex flex-col space-y-1.5">
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
            <div className="max-h-64 min-h-[8rem] space-y-0.5 overflow-y-auto rounded border border-slate-200 p-1.5" data-testid="driver-predictor-list">
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

          <details className="rounded-lg border border-slate-200" data-testid="driver-optional-settings">
            <summary className="cursor-pointer select-none px-2.5 py-2">
              <span className="font-semibold text-foreground">Optional settings</span>
              <span className="mt-0.5 block text-[11px] text-slate-600">
                {[
                  `Group by: ${driverGroupVar ? (vars.find((v) => v.name === driverGroupVar)?.label || driverGroupVar) : "none"}`,
                  ...(weights.length > 0 ? [`Weight: ${weightVar ? (weights.find((w) => w.name === weightVar)?.label || weightVar) : "none"}`] : []),
                  ...(predictors.size > 0 && importanceChoices.length > 0 ? [`Stated importance: ${chosenPreds.filter((p) => statedFor(p)).length} paired`] : []),
                ].join(" · ")}
              </span>
            </summary>
            <div className="flex flex-col gap-4 border-t border-slate-200 p-2.5">
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

            </div>
          </details>

          <div className="lg:hidden">{savedBlock}</div>

          <div className="sticky bottom-0 -mx-4 mt-auto border-t border-slate-200 bg-white px-4 py-3">
            <button
              type="button"
              disabled={!canRun}
              onClick={run}
              className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Working..." : "Run driver analysis"}
            </button>
            {!busy && !canRun && (
              <p className="mt-1.5 text-slate-600" data-testid="driver-run-reason">
                {outcome === "" ? (predictors.size < 2 ? "Choose an outcome and at least two predictors." : "Choose an outcome.") : "Choose at least two predictors."}
              </p>
            )}
          </div>
          </>
          )}
        </div>
        }
        middle={
        <div className="min-h-0 overflow-y-auto rounded-xl bg-slate-100 px-1 text-xs lg:h-[calc(100vh-5.5rem)]" data-testid="analytics-results-pane">
          {(keptCount > 0 || !remembered.available) && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2" data-testid="analytics-kept-bar">
              <p className="text-slate-600">
                {remembered.available
                  ? `${keptCount} result${keptCount === 1 ? "" : "s"} kept for this file in this browser. When you come back they are worked out again from the file as it is then; a saved analysis is reopened from Saved analyses.`
                  : "This browser does not allow this site to store anything, so these results will not be kept after you leave."}
              </p>
              {keptCount > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="rounded-lg border border-border px-2.5 py-1 font-medium text-muted hover:bg-slate-50 hover:text-danger"
                  title={`Removes every chart, scatter plot, NPS and driver result for this file from the workspace. Saved analyses stay in Saved analyses. ${CLEAR_KEEPS}`}
                  data-testid="analytics-clear-all"
                >
                  Clear all
                </button>
              )}
            </div>
          )}
          {mode === "driver" && (
            <>
              <details className="mb-3 rounded-xl border border-slate-200 bg-white px-3 py-2" data-testid="driver-how-to-read">
                <summary className="cursor-pointer select-none font-medium text-foreground">How to read this</summary>
                <ul className="mt-2 list-disc space-y-1.5 pl-4 text-slate-600">
                  <li>The ranking shows what goes with the outcome in this survey. It does not prove cause.</li>
                  <li>Questions that overlap share their weight, so one of them does not take it all.</li>
                  <li>Look at the rank range as well as the rank. A wide range means the order is not settled.</li>
                  <li>Stated importance, if paired, shows what people say matters against what moves the outcome.</li>
                  <li>Read the cases used and the variation explained first: a small sample or a small share explained limits what the ranking can say.</li>
                </ul>
              </details>
              {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-danger">{error}</p>}
              {message && <p className="mb-3 text-muted">{message}</p>}
              <ResizableSplit
                storageKey="nps-drivers"
                testId="nps-driver-split"
                left={
                  npsResult && npsResult.variable === outcome ? (
                  <div className="space-y-2">
                    {npsResult.segments && npsResult.segments.length > 0 && (
                      <SegmentTabs options={npsResult.segments.map((s) => s.name)} value={npsSeg} onChange={setNpsSeg} />
                    )}
                    <NpsVisual result={npsResultForSegment(npsResult, npsSeg)} />
                    {npsStatusPending ? (
                      <PostedStateChecking testId="nps-post-checking" />
                    ) : npsStatusError !== null ? (
                      <PostedStateUnknown error={npsStatusError} onRetry={() => void retryNpsPostedState()} testId="nps-post-unknown" />
                    ) : (
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
                    )}
                  </div>
                  ) : null
                }
                right={
                <div className="space-y-3">
                  {driverSlot && !report && (
                    <RestoreNotice
                      testId="driver-restore-slot"
                      what={driverSlot.remembered.kind === "saved" ? "The saved driver analysis you had open" : `Driver analysis of ${driverSlot.remembered.request.outcome}`}
                      state={driverSlot.state}
                      error={driverSlot.error}
                      onRetry={retryDriverSlot}
                      onClear={clearDriver}
                      clearLabel="Clear this driver result"
                    />
                  )}
                  {!report && !error && !driverSlot && (
                    <p className="max-w-xl rounded-xl border border-slate-200 bg-white p-4 text-slate-600">
                      Driver analysis shows which questions are most closely tied to the outcome. Questions that overlap,
                      such as two ways of asking about the same thing, share their weight between them instead of one of
                      them getting all of it or a negative score. The result is a ranking with an interval on each weight,
                      so you can see which differences are real. It describes what goes with the outcome in this survey.
                      It does not prove cause.
                    </p>
                  )}
                  {report && (
                    <>
                      <div className="flex justify-end">
                        <ClearButton
                          label="Clear this driver result"
                          title={`Removes this result from the workspace. ${driverSavedId ? "The saved analysis stays in Saved analyses. " : ""}${CLEAR_KEEPS}`}
                          onClick={clearDriver}
                          testId="driver-clear"
                        />
                      </div>
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
                            postState={openPostState.state === "known" ? undefined : openPostState}
                            onRetryPostState={readDriverCounts}
                            busy={driverCommitBusy}
                            onPost={postDriverToFindings}
                          />
                        );
                      })()}
                    </>
                  )}
                </div>
                }
              />
            </>
          )}
          {mode === "nps" && (
            <>
              {npsError && <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">{npsError}</p>}
              {npsSlot && !npsResult && (
                <RestoreNotice
                  testId="nps-restore-slot"
                  what={`NPS of ${npsSlot.req.variable}${npsSlot.req.groupVar ? ` by ${npsSlot.req.groupVar}` : ""}`}
                  state={npsSlot.state}
                  error={npsSlot.error}
                  onRetry={() => void restoreNps(npsSlot.req, restoreEpoch.current)}
                  onClear={clearNps}
                  clearLabel="Clear this NPS result"
                />
              )}
              {!npsResult && !npsError && !npsSlot && (
                <p className="max-w-xl text-muted">
                  Pick an 11-point 0 to 10 &quot;how likely are you to recommend...&quot; question on the left. Promoters are
                  9-10, detractors 0-6, everyone else is a passive. The score is the promoter share minus the detractor
                  share.
                </p>
              )}
              {npsResult && (
                <div className="max-w-3xl space-y-3">
                  <div className="flex justify-end">
                    <ClearButton label="Clear this NPS result" title={`Removes this NPS result from the workspace. ${CLEAR_KEEPS}`} onClick={clearNps} testId="nps-clear" />
                  </div>
                  {npsResult.segments && npsResult.segments.length > 0 && (
                    <SegmentTabs options={npsResult.segments.map((s) => s.name)} value={npsSeg} onChange={setNpsSeg} />
                  )}
                  <NpsVisual result={npsResultForSegment(npsResult, npsSeg)} />
                  {npsStatusPending ? (
                    <PostedStateChecking testId="nps-post-checking" />
                  ) : npsStatusError !== null ? (
                    <PostedStateUnknown error={npsStatusError} onRetry={() => void retryNpsPostedState()} testId="nps-post-unknown" />
                  ) : (
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
                  )}
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
              {grid.length === 0 && !chartError && (
                <p className="max-w-xl text-muted">
                  Pick a question on the left and build its answer distribution as a chart, ready to copy or download for a
                  slide. Build another one straight after: each new chart lands first in the grid, so you can build out a
                  whole set and commit the ones worth keeping together.
                </p>
              )}
              {grid.length > 0 && (
                  <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2" data-testid="analytics-card-grid">
                    {grid.map((g) => {
                      if (g.kind === "slot") {
                        const slot = g.slot;
                        return (
                          <div key={slot.id} id={slot.id} className="scroll-mt-4 min-w-0 rounded-xl border border-slate-200 bg-white p-3" data-testid="analytics-card" data-card-kind={slot.entry.kind === "chart" ? slot.entry.variant : "scatter"}>
                            <RestoreNotice
                              testId="analytics-restore-slot"
                              what={describeRemembered(slot.entry)}
                              state={slot.state}
                              error={slot.error}
                              onRetry={() => retrySlot(slot)}
                              onClear={() => clearSlot(slot.id)}
                              clearLabel={slot.entry.kind === "chart" ? "Clear this chart" : "Clear this scatter plot"}
                              bare
                            />
                          </div>
                        );
                      }
                      if (g.kind === "scatter") {
                        const card = g.card;
                        const res = card.result;
                        const c = res.correlation;
                        const shortScale = res.x.distinct <= 12 || res.y.distinct <= 12;
                        const statText = c
                          ? `Pearson correlation r = ${c.r.toFixed(2)} across ${c.n.toLocaleString()} complete cases (${res.weighted ? "weighted" : "unweighted"})`
                          : "No correlation: fewer than three cases answered both, or one of the two does not vary.";
                        const testText = !c ? "" : res.weighted ? "No significance test for a weighted correlation." : res.pValue === null ? "" : res.pValue < 0.001 ? "p < 0.001." : `p = ${res.pValue}.`;
                        return (
                          <div key={card.id} id={card.id} className="scroll-mt-4 min-w-0 space-y-2 rounded-xl border border-slate-200 bg-white p-3" data-testid="scatter-card" data-card-kind="scatter">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-xs font-medium text-muted">{card.title}</p>
                              <ClearButton
                                label="Clear this scatter plot"
                                title={`Removes this scatter plot from the workspace. ${CLEAR_KEEPS}`}
                                onClick={() => setScatters((prev) => prev.filter((x) => x.id !== card.id))}
                              />
                            </div>
                            <p className="text-xs text-foreground" data-testid="scatter-correlation">
                              {statText}
                              {testText ? ` ${testText}` : ""}
                            </p>
                            <p className="text-[11px] text-slate-600">
                              {`${res.complete.toLocaleString()} of ${res.casesInFile.toLocaleString()} cases answered both.${res.capped ? ` ${res.capped.shown.toLocaleString()} of them are drawn, evenly spread; the correlation uses all ${res.capped.of.toLocaleString()}.` : ""} This describes association, not cause.`}
                            </p>
                            {shortScale && (
                              <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                                <input
                                  type="checkbox"
                                  checked={card.spread}
                                  onChange={(e) => setScatters((prev) => prev.map((x) => (x.id === card.id ? { ...x, spread: e.target.checked } : x)))}
                                />
                                Spread overlapping points (display only: on a short answer scale many points sit on the same spot; the values and the correlation are unchanged)
                              </label>
                            )}
                            <ScatterVisual result={res} title={card.title} color={SERIES_COLORS[1]} spread={card.spread} />
                            <div className="space-y-1">
                              <button
                                type="button"
                                onClick={() => toggleScatterCommit(card.id)}
                                disabled={card.commitBusy || !c}
                                className={`w-full rounded-lg border px-3 py-1.5 text-xs font-medium shadow-sm disabled:opacity-50 ${
                                  card.committed ? "border-border text-muted hover:bg-slate-50" : "border-primary text-primary hover:bg-primary/5"
                                }`}
                              >
                                {card.commitBusy ? "Working..." : card.committed ? "Remove from findings" : "Post to findings"}
                              </button>
                              {card.committed && card.current === false && (
                                <div className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900" data-testid="scatter-finding-outdated">
                                  The posted finding was worked out from an earlier version of this file or its setup.{" "}
                                  <button type="button" onClick={() => toggleScatterCommit(card.id, true)} disabled={card.commitBusy} className="font-semibold underline">
                                    Update it with the current figures
                                  </button>
                                </div>
                              )}
                              {card.statusFailed && (
                                <p className="text-[11px] text-amber-900" data-testid="scatter-finding-status-failed">
                                  Whether this correlation is already posted could not be checked. Posting again does not add a second finding.
                                </p>
                              )}
                              {card.committed && card.wordingReview && (
                                <div className="space-y-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900" data-testid="scatter-finding-wording-review">
                                  <p>Your wording of this finding was kept, but it was written for earlier figures. With the current figures the finding would read:</p>
                                  <p className="italic" data-testid="scatter-finding-suggested-text">{card.wordingReview.suggested_text}</p>
                                  <div className="flex flex-wrap gap-2">
                                    <button type="button" onClick={() => resolveScatterWording(card.id, "keep")} disabled={card.wordingBusy} className="rounded border border-amber-300 bg-white px-2 py-0.5 font-semibold disabled:opacity-50">
                                      Keep my wording
                                    </button>
                                    <button type="button" onClick={() => resolveScatterWording(card.id, "use_current")} disabled={card.wordingBusy} className="rounded border border-amber-300 bg-white px-2 py-0.5 font-semibold disabled:opacity-50">
                                      Use the current wording
                                    </button>
                                    {card.wordingBusy && <span>Saving...</span>}
                                  </div>
                                  <p className="text-amber-800">Using the current wording keeps yours on record with the finding.</p>
                                </div>
                              )}
                              {card.wordingError && (
                                <p className="text-[11px] text-red-700" role="alert" data-testid="scatter-finding-wording-error">
                                  {card.wordingError}
                                </p>
                              )}
                              {card.committed && card.current === null && (
                                <p className="text-[11px] text-slate-600" data-testid="scatter-finding-unknown">
                                  Whether the posted finding matches this file as it is now could not be checked.
                                </p>
                              )}
                              {c && (
                                <p className="text-[11px] text-slate-600" data-testid="scatter-post-limits">
                                  {`Posts the correlation: r = ${c.r.toFixed(2)}, ${c.n.toLocaleString()} of ${res.casesInFile.toLocaleString()} cases, ${res.weighted ? "weighted, no significance test" : testText ? `unweighted, ${testText.replace(/\.$/, "")}` : "unweighted"}; worked out again from the file when posted.`}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      }
                      const card = g.card;
                      const isEditing = card.id === editingChartId;
                      const grouped = card.result.grouped && card.result.series.length > 1;
                      return (
                        <div
                          key={card.id}
                          id={card.id}
                          onClick={() => setSelectedChartId(card.id)}
                          className={`scroll-mt-4 min-w-0 cursor-pointer space-y-2 rounded-xl border bg-white p-3 ${
                            isEditing ? "border-primary ring-1 ring-primary" : "border-slate-200"
                          }`}
                          data-testid="chart-card"
                          data-card-kind={card.variant}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-medium text-muted">
                              {card.title}
                              {card.groupVar ? ` × ${card.result.groupLabel}` : ""}
                            </p>
                            <ClearButton
                              label="Clear this chart"
                              title={`Removes this chart from the workspace. ${CLEAR_KEEPS}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                removeChartCard(card.id);
                              }}
                            />
                          </div>
                          {/* The title and colour controls sit in the chart they edit, so they never push other cards apart. */}
                          {isEditing ? (
                            <div onClick={(e) => e.stopPropagation()} data-testid="chart-customize">
                              <ChartCustomizePanel
                                title={card.title}
                                onTitle={(v) => updateChartCard(card.id, { title: v })}
                                legendPos={grouped ? card.legendPos : undefined}
                                onLegendPos={grouped ? (v) => updateChartCard(card.id, { legendPos: v }) : undefined}
                                colors={card.result.series.map((sr, i) => ({
                                  label: sr.name,
                                  value: card.colors[i] ?? SERIES_COLORS[i % SERIES_COLORS.length],
                                }))}
                                onColor={(i, v) => updateChartCard(card.id, { colors: card.colors.map((c, j) => (j === i ? v : c)) })}
                                onResetColors={() =>
                                  updateChartCard(card.id, { colors: card.result.series.map((_, i) => SERIES_COLORS[i % SERIES_COLORS.length]) })
                                }
                              />
                            </div>
                          ) : (
                            <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => setSelectedChartId(card.id)}>
                              Edit title and colours
                            </button>
                          )}
                          {card.variant !== "histogram" ? (
                            // Switching redraws the same figures; nothing is run again.
                            <div className="inline-flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="radiogroup" aria-label="Draw as">
                              {(["bar", "line"] as const).map((v) => (
                                <button
                                  key={v}
                                  type="button"
                                  role="radio"
                                  aria-checked={card.variant === v}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateChartCard(card.id, { variant: v });
                                  }}
                                  className={`rounded-md px-2.5 py-0.5 text-[11px] font-medium ${card.variant === v ? "bg-primary text-white" : "text-slate-600 hover:bg-white"}`}
                                >
                                  {v === "bar" ? "Bar" : "Line"}
                                </button>
                              ))}
                            </div>
                          ) : (
                            histogramNote(card.histSource) && <p className="text-[11px] text-slate-600" data-testid="histogram-source">{histogramNote(card.histSource)}</p>
                          )}
                          <ChartVisual result={card.result} title={card.title} colors={card.colors} legendPos={card.legendPos} variant={card.variant} />
                          {card.statusError !== null ? (
                            <PostedStateUnknown error={card.statusError} onRetry={() => void retryChartPostedState(card.id)} testId="chart-post-unknown" />
                          ) : (
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
                          )}
                        </div>
                      );
                    })}
                  </div>
              )}

            </>
          )}
        </div>
        }
        // Driver analysis has nothing for this pane until an analysis is saved, so it gives the room
        // back to the results instead of showing an empty column.
        right={mode === "driver" && !savedBlock ? undefined : (
        <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-xs lg:h-[calc(100vh-5.5rem)]" data-testid="analytics-side-pane">
          {mode === "driver" ? (
            <>
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
        )}
      />
      </div>
      )}
    </div>
  );

  return createPortal(body, document.body);
}

/** Whether a saved driver analysis is in findings (RR-04): known, still being read, or unreadable. */
export type DriverPostState =
  | { state: "known"; n: number }
  | { state: "loading" }
  | { state: "failed"; error: string };

/** Stands in for Post / Remove while whether the analysis is posted is not known. */
/** A chart or NPS card whose posted state could not be read: the error, Retry, and no Post or Remove. */
/** UI-R1000-01: shown in place of Post and Remove while the posted-state read has not answered. */
function PostedStateChecking({ testId }: { testId: string }) {
  return (
    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-muted" data-testid={testId} aria-live="polite">
      Checking whether this is already in findings...
    </p>
  );
}

function PostedStateUnknown({ error, onRetry, testId }: { error: string; onRetry: () => void; testId: string }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-800" data-testid={testId}>
      <span>Could not check whether this is already in findings, so Post and Remove are not offered: {error}</span>
      <button type="button" onClick={onRetry} className="font-semibold underline">
        Retry
      </button>
    </div>
  );
}

function DriverPostStatus({
  state,
  onRetry,
  compact = false,
}: {
  state: Exclude<DriverPostState, { state: "known" }>;
  onRetry?: () => void;
  compact?: boolean;
}) {
  if (state.state === "loading") {
    return (
      <span className="text-[11px] text-slate-600" role="status" data-testid="driver-post-checking">
        Checking whether this is posted...
      </span>
    );
  }
  return (
    <span className={`flex items-center gap-2 text-[11px] text-danger ${compact ? "" : "text-right"}`} role="alert" data-testid="driver-post-unknown">
      <span>{compact ? "Could not check whether this is posted." : `Could not check whether this is posted: ${state.error}`}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-semibold underline">
          Retry
        </button>
      )}
    </span>
  );
}

export function ReportView({
  report,
  committed = false,
  postState,
  onRetryPostState,
  busy = false,
  onPost,
}: {
  report: DriverReport;
  committed?: boolean;
  /** Set while whether this result is in findings is not known: Post and Remove are withheld. */
  postState?: Exclude<DriverPostState, { state: "known" }>;
  /** Reads the posted state again after it failed. */
  onRetryPostState?: () => void;
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
  const summary = driverSummary(report);
  const fitBox = (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <div className="text-lg font-semibold text-foreground">{summary.fitFigure}</div>
      <div className="text-[11px] text-slate-600">{summary.fitText}</div>
    </div>
  );
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" data-testid="driver-report">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Drivers of {report.outcomeLabel}</p>
          <p className="text-slate-600">{report.outcomeNote}</p>
        </div>
        {onPost && (
          <div className="flex max-w-xs flex-col items-end gap-1">
            {postState ? (
              <DriverPostStatus state={postState} onRetry={onRetryPostState} />
            ) : (
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
            {/* The limits travel with the result: the posted findings state the cases used (n) and
                the fit, and are tagged when the fit is weak or cases are few (driverFindings.ts). */}
            <p className="text-right text-[11px] text-slate-600" data-testid="driver-post-limits">
              {`Posted with: ${summary.used.toLocaleString()} cases used, ${summary.fitFigure} ${r.fit.mcFadden === null ? "of the variation explained" : "pseudo R-squared"}${summary.limitations.length > 0 ? `, ${summary.limitations.length} ${summary.limitations.length === 1 ? "limitation" : "limitations"} below` : ""}.`}
            </p>
          </div>
        )}
      </div>

      {/* What the ranking rests on, read before the ranking (Grant's review, 2026-10-20). */}
      <section className="space-y-2" aria-label="Result summary" data-testid="driver-summary">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 px-3 py-2">
            <div className="text-lg font-semibold text-foreground">
              {`${summary.used.toLocaleString()} of ${summary.inFile.toLocaleString()}`}
            </div>
            <div className="text-[11px] text-slate-600">
              {`cases used${summary.usedShare !== null ? ` (${summary.usedShare < 0.01 && summary.usedShare > 0 ? "under 1" : Math.round(summary.usedShare * 100)}% of the file)` : ""}${summary.weighted ? ", weighted" : ""}`}
            </div>
          </div>
          {fitBox}
        </div>
        {summary.exclusions.length > 0 && (
          <ul className="space-y-0.5 text-[11px] text-slate-600" data-testid="driver-exclusions">
            {summary.exclusions.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        )}
        {summary.limitations.length > 0 && (
          <ul className="space-y-1 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800" data-testid="driver-limitations">
            {summary.limitations.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-slate-600">This describes what goes with the outcome in this survey, not what causes it.</p>
      </section>

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
      <details className="rounded-lg border border-slate-200 px-3 py-2 text-[11px] text-slate-600" data-testid="driver-method-details">
        <summary className="cursor-pointer select-none font-medium text-foreground">Method details</summary>
        <div className="mt-2 space-y-1.5">
          <p>
            {methodText} Intervals come from 95% bootstrap ranges, repeatable because the resampling is seeded. A rank range that
            spans several places means those questions cannot be separated reliably. The p value tests whether the question adds
            anything once the others are in the model.
          </p>
          <p>
            {r.method === "shapley"
              ? "The split is a Shapley decomposition: each question's weight is its average contribution to the explained variation across every order the questions could be added in, so two overlapping questions divide the credit between them rather than one taking it all."
              : r.method === "relative_weights"
                ? "With too many questions to check every order exactly, the split uses Johnson's relative weights, which approximates the same Shapley idea through an orthogonal transformation of the predictors rather than full enumeration."
                : "With even more questions, the split falls back to the size of each standardised coefficient from the fitted model, quicker to compute but less reliable once questions overlap."}
          </p>
          {r.fit.mcFadden !== null && (
            <p>{`Nagelkerke pseudo R-squared ${r.fit.nagelkerke?.toFixed(2) ?? "-"}.`}</p>
          )}
        </div>
      </details>

      {/* One below the other, each the width of the driver pane: side by side, a quadrant got half of an already
          half-width pane (Grant, 29 October 2026: "the quadrant is tiny"). */}
      <div className="space-y-4" data-testid="driver-quadrants">
        <Quadrant report={report} />
        <StatedQuadrant report={report} />
      </div>
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

  // Joined by the predictor's code (Codex AN500-F01); an old report with colliding names joins nothing for them.
  const rows = report.result.rows
    .map((r) => {
      const p = recordForRow(r, report.performance, report.result.rows);
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
      {/* One compact toolbar above the chart: copy, download, and the styling folded away. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="quadrant-toolbar">
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
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "download" ? "Downloading..." : "Download PNG"}
        </button>
        <details className="relative">
          <summary className="cursor-pointer select-none rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            Chart style
          </summary>
          <div className="absolute left-0 z-20 mt-1 w-[34rem] max-w-[80vw] shadow-lg">
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
          </div>
        </details>
        {status && <span className="text-[11px] text-muted">{status}</span>}
      </div>
      {/* The legend is a row above or below the chart, never a column beside it: beside it, it took most of a
          narrow pane and left the chart a thumbnail (Grant, 29 October 2026: "the quadrant is tiny"). */}
      <div className="mt-2 flex flex-col gap-3 rounded-xl border border-border bg-white p-3" data-testid="quadrant-frame">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H + TITLE_H}`}
          className="w-full"
          data-testid="quadrant-chart"
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
          className="flex flex-row flex-wrap justify-center gap-x-5 gap-y-2"
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
      const r = recordForRow({ name: s.name, variable: s.predictor }, report.result.rows, stated.map((x) => ({ name: x.name, variable: x.predictor })));
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

/**
 * Clear takes a result off the workspace and out of what this browser remembers for the file. It
 * never deletes a saved analysis or a posted finding; its tooltip says so.
 */
function ClearButton({ label, title, onClick, testId }: { label: string; title: string; onClick: (e: MouseEvent) => void; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label}
      data-testid={testId}
      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted hover:bg-slate-50 hover:text-danger"
    >
      Clear
    </button>
  );
}

/**
 * A remembered result being worked out again, or one that could not be: the reason is shown with
 * Try again and Clear, so a request that no longer applies is neither shown as a result nor
 * silently dropped.
 */
function RestoreNotice({
  testId,
  what,
  state,
  error,
  onRetry,
  onClear,
  clearLabel,
  bare = false,
}: {
  testId: string;
  what: string;
  state: "loading" | "failed";
  error?: string;
  onRetry: () => void;
  onClear: () => void;
  clearLabel: string;
  bare?: boolean;
}) {
  return (
    <div
      className={`space-y-1.5 ${bare ? "" : "max-w-xl rounded-xl border border-slate-200 bg-white p-3"} ${state === "failed" ? "text-amber-900" : "text-slate-600"}`}
      data-testid={testId}
      data-state={state}
      role={state === "failed" ? "alert" : "status"}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium">{what}</p>
        <ClearButton label={clearLabel} title={`Removes this from the workspace. ${CLEAR_KEEPS}`} onClick={onClear} />
      </div>
      {state === "loading" ? (
        <p>Working this out again from the current file...</p>
      ) : (
        <>
          <p>Kept from your last visit, but it could not be worked out again: {error}</p>
          <button type="button" onClick={onRetry} className="rounded border border-amber-300 bg-white px-2 py-0.5 font-semibold">
            Try again
          </button>
        </>
      )}
    </div>
  );
}
