"use client";

import type { FindingCodingCounts } from "@/lib/codingAnalysis";
import {
  useState,
  useTransition,
  useRef,
  useEffect,
  type TransitionStartFunction,
} from "react";
import {
  setFindingStatus,
  setManyFindingStatuses,
  setFindingKind,
  setFindingTheme,
  setFindingNote,
  type FindingKind,
} from "@/lib/findingActions";
import { getDocumentPreviewUrl } from "@/lib/previewActions";
import type { ParsedTable } from "@/lib/parseTable";
import {
  EyeIcon,
  CheckIcon,
  CrossIcon,
  ListIcon,
  GridIcon,
  ChartIcon,
} from "@/components/icons";
import { buildChartForThemeGroup } from "@/lib/findingsChartData";
import { classifyFindingDiscovery } from "@/lib/discoveryClassification";
import FindingsChart from "./FindingsChart";

type Finding = {
  id: string;
  origin: "stated" | "generated" | "coded";
  data_type: "qualitative" | "quantitative" | null;
  finding_text: string;
  finding_kind: FindingKind | null;
  theme: string | null;
  status: "pending" | "accepted" | "rejected";
  source_filename: string | null;
  source_page: number | null;
  quote_verified: boolean | null;
  source_document_id: string | null;
  source_table_id: string | null;
  source_cells: { rowIndices?: number[] } | null;
  duplicate_group_id: string | null;
  researcher_note: string | null;
  pattern_type: string | null;
  stated_stats: Record<string, unknown> | null;
  created_at: string;
  corroborates_report_claim: boolean;
  is_contradicted: boolean;
  contradicts_report: boolean;
  reproduced_runs: number | null;
  total_runs: number | null;
  supporting_segments: number | null;
  supporting_speakers: number | null;
  // Live counts with denominators, merged in by the page (see getFindingCodingCounts).
  coding_counts?: FindingCodingCounts | null;
  quote_match: "exact" | "near" | "none" | null;
};

type Viewer =
  | { kind: "pdf"; url: string; page: number | null; title: string }
  | {
      kind: "table";
      table: ParsedTable;
      title: string;
      highlightRowIndices: number[];
    };

function DocumentPreviewPanel({
  viewer,
  onClose,
}: {
  viewer: Viewer;
  onClose: () => void;
}) {
  const highlightRef = useRef<HTMLTableRowElement | null>(null);
  const highlightSet =
    viewer.kind === "table" ? new Set(viewer.highlightRowIndices) : null;
  const firstHighlightIndex =
    viewer.kind === "table" && viewer.highlightRowIndices.length > 0
      ? Math.min(...viewer.highlightRowIndices)
      : null;

  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
    // Re-run whenever a different finding's preview opens, so the panel jumps
    // to the new highlighted row rather than staying scrolled where it was.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer]);

  return (
    <div className="sticky top-4 flex h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-xl border border-border bg-white shadow-lg">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-slate-50 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">
            {viewer.title}
          </div>
          {viewer.kind === "pdf" && viewer.page != null && (
            <div className="mt-0.5 text-xs font-medium text-primary">
              Page {viewer.page}
            </div>
          )}
          {viewer.kind === "table" && (
            <div className="mt-0.5 text-xs font-medium text-muted">
              {viewer.table.rows.length} row
              {viewer.table.rows.length === 1 ? "" : "s"} &middot;{" "}
              {viewer.table.headers.length} column
              {viewer.table.headers.length === 1 ? "" : "s"}
              {viewer.highlightRowIndices.length > 0 && (
                <span className="ml-2 font-semibold text-amber-700">
                  &bull; {viewer.highlightRowIndices.length} row
                  {viewer.highlightRowIndices.length === 1 ? "" : "s"} behind
                  this finding, highlighted below
                </span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-muted transition hover:border-slate-400 hover:text-foreground"
          aria-label="Close preview"
        >
          <CrossIcon className="h-4 w-4" />
        </button>
      </div>
      {viewer.kind === "pdf" ? (
        <iframe
          src={
            viewer.page != null
              ? `${viewer.url}#page=${viewer.page}`
              : viewer.url
          }
          className="flex-1 border-0"
          title="Source document preview"
        />
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr>
                {viewer.table.headers.map((header) => (
                  <th
                    key={header}
                    className="whitespace-nowrap border-b border-border px-3 py-2 text-left font-semibold text-muted"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {viewer.table.rows.map((row, rowIndex) => {
                const isHighlighted = highlightSet?.has(rowIndex) ?? false;
                return (
                  <tr
                    key={rowIndex}
                    ref={
                      rowIndex === firstHighlightIndex
                        ? highlightRef
                        : undefined
                    }
                    className={`border-b border-border last:border-0 ${
                      isHighlighted
                        ? "bg-amber-50 ring-1 ring-inset ring-amber-200"
                        : "even:bg-slate-50/50"
                    }`}
                  >
                    {viewer.table.headers.map((header) => (
                      <td
                        key={header}
                        className={`whitespace-nowrap px-3 py-1.5 ${
                          isHighlighted
                            ? "font-medium text-amber-900"
                            : "text-foreground"
                        }`}
                      >
                        {row[header] ?? ""}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const kindLabel: Record<FindingKind, string> = {
  fact: "Fact",
  own_finding: "Own finding",
  external_citation: "External citation",
  hypothesis: "Hypothesis",
  methodology: "Methodology",
  recommendation: "Recommendation",
  stated_insight: "Stated insight",
};

const kindOrder: FindingKind[] = [
  "fact",
  "own_finding",
  "external_citation",
  "hypothesis",
  "methodology",
  "recommendation",
  "stated_insight",
];

const NEW_THEME_VALUE = "__new_theme__";

const selectClass =
  "rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

function ThemeCell({
  runId,
  finding,
  themes,
  onThemeAdded,
}: {
  runId: string;
  finding: Finding;
  themes: string[];
  onThemeAdded: (theme: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [isAdding, setIsAdding] = useState(false);
  const [newTheme, setNewTheme] = useState("");

  if (isAdding) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = newTheme.trim();
          if (!value) return;
          startTransition(() => setFindingTheme(runId, finding.id, value));
          onThemeAdded(value);
          setIsAdding(false);
          setNewTheme("");
        }}
        className="flex gap-1"
      >
        <input
          autoFocus
          value={newTheme}
          onChange={(e) => setNewTheme(e.target.value)}
          placeholder="New theme name"
          className="min-w-0 flex-1 rounded-md border border-border px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-white hover:bg-primary-hover"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setIsAdding(false)}
          className="rounded-md border border-border px-2 py-1 text-xs font-medium text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </form>
    );
  }

  return (
    <select
      value={finding.theme ?? ""}
      disabled={isPending}
      onChange={(e) => {
        if (e.target.value === NEW_THEME_VALUE) {
          setIsAdding(true);
          return;
        }
        startTransition(() =>
          setFindingTheme(runId, finding.id, e.target.value),
        );
      }}
      className={`${selectClass} w-full`}
    >
      {!finding.theme && <option value="">No theme</option>}
      {themes.map((theme) => (
        <option key={theme} value={theme}>
          {theme}
        </option>
      ))}
      <option value={NEW_THEME_VALUE}>+ Add new theme...</option>
    </select>
  );
}

function OriginBadge({ origin }: { origin: "stated" | "generated" | "coded" }) {
  const styles =
    origin === "generated"
      ? "bg-primary-light text-primary ring-blue-200"
      : origin === "coded"
        ? "bg-purple-50 text-purple-600 ring-purple-200"
        : "bg-slate-50 text-slate-500 ring-slate-200";
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${styles}`}
    >
      {origin}
    </span>
  );
}

function CodingCountBadges({
  counts,
  base,
}: {
  counts: FindingCodingCounts;
  base: string;
}) {
  const plural = (n: number, word: string) => `${word}${n === 1 ? "" : "s"}`;
  return (
    <>
      {counts.speakersWith !== null && counts.speakersTotal !== null ? (
        <span
          title="Participants with at least one turn coded to this theme, out of all participants who spoke."
          className={`${base} bg-slate-50 text-slate-600 ring-slate-200`}
        >
          {counts.speakersWith} of {counts.speakersTotal}{" "}
          {plural(counts.speakersTotal, "participant")}
        </span>
      ) : null}
      <span
        title="Participant turns coded to this theme, out of all participant turns."
        className={`${base} bg-slate-50 text-slate-600 ring-slate-200`}
      >
        {counts.turns} of {counts.participantTurns}{" "}
        {plural(counts.participantTurns, "turn")}
      </span>
      {counts.independentSpeakers !== null && counts.echoTurns > 0 && (
        <span
          title="Focus group: participants with at least one coded turn that does not simply echo another speaker."
          className={`${base} bg-amber-50 text-amber-700 ring-amber-200`}
        >
          {counts.independentSpeakers} independent, {counts.echoTurns}{" "}
          {plural(counts.echoTurns, "echo")}
        </span>
      )}
      {counts.groupsWith !== null && counts.groupsTotal !== null && (
        <span
          title="Focus groups where a theme of this name was coded, out of all focus groups coded."
          className={`${base} bg-slate-50 text-slate-600 ring-slate-200`}
        >
          {counts.groupsWith} of {counts.groupsTotal}{" "}
          {plural(counts.groupsTotal, "group")}
        </span>
      )}
    </>
  );
}

// The validated / net-new split on the finding itself. A report's own
// stated or coded findings need no badge: they ARE what the report said.
// A computed finding either checks a report claim (validated) or is new.
// Contradiction flags sit apart from that, because a correction reads very
// differently from an addition.
// What a coded (transcript) finding rests on: how many of the repeated open
// coding passes found its theme, and how many turns and speakers it was
// applied to. Nothing renders for findings that did not come from the
// codebook pipeline.
function CodingBadges({
  finding,
}: {
  finding: Pick<
    Finding,
    | "origin"
    | "reproduced_runs"
    | "total_runs"
    | "supporting_segments"
    | "supporting_speakers"
    | "coding_counts"
  >;
}) {
  if (finding.origin !== "coded") return null;
  const base =
    "inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset";
  const run = finding.reproduced_runs;
  const total = finding.total_runs;
  return (
    <>
      {run !== null && total !== null && total > 0 && (
        <span
          title={`The open coding was run ${total} times over the transcript. This theme was found in ${run} of them.`}
          className={`${base} ${
            run === total
              ? "bg-success-light text-success ring-emerald-200"
              : run / total >= 0.67
                ? "bg-slate-50 text-slate-600 ring-slate-200"
                : "bg-amber-50 text-amber-700 ring-amber-200"
          }`}
        >
          Found in {run} of {total} passes
        </span>
      )}
      {finding.coding_counts && (
        <CodingCountBadges counts={finding.coding_counts} base={base} />
      )}
      {!finding.coding_counts && finding.supporting_segments !== null && (
        <span
          title="Participant turns the codebook was applied to for this theme."
          className={`${base} bg-slate-50 text-slate-600 ring-slate-200`}
        >
          {finding.supporting_segments} turn
          {finding.supporting_segments === 1 ? "" : "s"}
          {finding.supporting_speakers
            ? `, ${finding.supporting_speakers} speaker${finding.supporting_speakers === 1 ? "" : "s"}`
            : ""}
        </span>
      )}
    </>
  );
}

function DiscoveryBadges({
  finding,
}: {
  finding: Pick<
    Finding,
    | "origin"
    | "corroborates_report_claim"
    | "is_contradicted"
    | "contradicts_report"
  >;
}) {
  const discovery = classifyFindingDiscovery({
    origin: finding.origin,
    corroboratesReportClaim: finding.corroborates_report_claim,
  });
  const base =
    "inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset";
  return (
    <>
      {finding.origin === "generated" && discovery.type === "net_new" && (
        <span
          title="Computed from the data by the Elevator. No claim in the original report points at it."
          className={`${base} bg-indigo-50 text-indigo-700 ring-indigo-200`}
        >
          New, not in the report
        </span>
      )}
      {finding.origin === "generated" && discovery.type === "validated" && (
        <span
          title="A claim in the original report is grounded in this computed pattern."
          className={`${base} bg-slate-50 text-slate-600 ring-slate-200`}
        >
          Checks a report claim
        </span>
      )}
      {finding.contradicts_report && (
        <span
          title="This finding conflicts with something the report said. The report's claim is rated not supported."
          className={`${base} bg-rose-50 text-rose-700 ring-rose-200`}
        >
          Contradicts the report
        </span>
      )}
      {finding.is_contradicted && (
        <span
          title="The Elevator's own evidence conflicts with this claim, so it is rated not supported."
          className={`${base} bg-rose-50 text-rose-700 ring-rose-200`}
        >
          Contradicted
        </span>
      )}
    </>
  );
}

function DataTypeBadge({
  dataType,
}: {
  dataType: "qualitative" | "quantitative" | null;
}) {
  if (!dataType) return null;
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${
        dataType === "qualitative"
          ? "bg-purple-50 text-purple-600 ring-purple-200"
          : "bg-sky-50 text-sky-600 ring-sky-200"
      }`}
    >
      {dataType === "qualitative" ? "Qual" : "Quant"}
    </span>
  );
}

function DuplicateBadge() {
  return (
    <span
      title="Wording and figures here are close enough to another finding in this run that they're probably the same finding stated more than once."
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-inset ring-amber-200 bg-amber-50"
    >
      <span aria-hidden>&#9888;</span> possible duplicate
    </span>
  );
}

function isNotSignificantComparison(
  finding: Pick<Finding, "pattern_type" | "stated_stats">,
): boolean {
  if (finding.pattern_type !== "banner_comparison") return false;
  const caveats = (finding.stated_stats as { caveats?: unknown } | null)
    ?.caveats;
  return Array.isArray(caveats) && caveats.includes("not_significant");
}

function NotSignificantBadge() {
  return (
    <span
      title="This banner comparison was computed and tested, but the difference did not reach statistical significance. It's shown for completeness, not treated as a real pattern, and won't be carried into insights or recommendations."
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 ring-1 ring-inset ring-slate-200 bg-slate-50"
    >
      not significant
    </span>
  );
}

// A descriptive_summary pattern (bannerPlanComputation.ts) never ran a test
// at all -- typically one reading per banner category, with nothing to test
// it against -- so it earns its own badge rather than being lumped in with
// "tested but not significant", which would overstate how much happened.
function isDescriptiveOnly(
  finding: Pick<Finding, "pattern_type" | "stated_stats">,
): boolean {
  if (finding.pattern_type !== "banner_comparison") return false;
  const caveats = (finding.stated_stats as { caveats?: unknown } | null)
    ?.caveats;
  return Array.isArray(caveats) && caveats.includes("insufficient_n_for_test");
}

function DescriptiveOnlyBadge() {
  return (
    <span
      title="There wasn't enough data in this group to test it against anything -- this is just its own value, shown for reference, not a tested comparison."
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 ring-1 ring-inset ring-slate-200 bg-slate-50"
    >
      descriptive only
    </span>
  );
}

function KindControl({
  runId,
  finding,
  isPending,
  startTransition,
}: {
  runId: string;
  finding: Finding;
  isPending: boolean;
  startTransition: TransitionStartFunction;
}) {
  if (finding.origin === "generated") {
    return <span className="text-xs text-muted">&mdash;</span>;
  }
  return (
    <select
      value={finding.finding_kind ?? ""}
      disabled={isPending}
      onChange={(e) =>
        startTransition(() => {
          setFindingKind(runId, finding.id, e.target.value as FindingKind);
        })
      }
      className={selectClass}
    >
      {!finding.finding_kind && <option value="">Not set</option>}
      {kindOrder.map((kind) => (
        <option key={kind} value={kind}>
          {kindLabel[kind]}
        </option>
      ))}
    </select>
  );
}

// Short, locale-aware timestamp for a finding card's footer -- e.g.
// "5 Oct, 15:20" -- so a researcher skimming 140 of these can tell a
// stale run apart from one that was just reprocessed, without opening
// the finding history panel. Drops the year since every finding on a run
// was extracted within the same session, almost always the same day.
function formatFindingTimestamp(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SourceInfo({
  finding,
  viewerLoadingId,
  openPreview,
}: {
  finding: Finding;
  viewerLoadingId: string | null;
  openPreview: (finding: Finding) => void;
}) {
  return (
    <div className="text-xs text-muted">
      <div className="truncate">{finding.source_filename ?? "—"}</div>
      {finding.source_page != null && <div>page {finding.source_page}</div>}
      {(finding.source_document_id || finding.source_table_id) && (
        <button
          onClick={() => openPreview(finding)}
          disabled={viewerLoadingId === finding.id}
          className="mt-1 flex items-center gap-1 font-medium text-primary hover:underline disabled:opacity-60"
        >
          <EyeIcon className="h-3 w-3" />
          {viewerLoadingId === finding.id ? "Opening..." : "View source"}
        </button>
      )}
      {finding.quote_verified === false && (
        <div
          title="The quoted sentence for this finding could not be found verbatim in the source text. Worth a manual check."
          className="mt-1 flex items-center gap-1 font-medium text-danger"
        >
          <span aria-hidden>&#9888;</span> unverified quote
        </div>
      )}
      <div
        title={new Date(finding.created_at).toLocaleString()}
        className="mt-1 text-[11px] text-muted/70"
      >
        {formatFindingTimestamp(finding.created_at)}
      </div>
    </div>
  );
}

function NoteField({ runId, finding }: { runId: string; finding: Finding }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(finding.researcher_note ?? "");
  const [isSaving, startSaving] = useTransition();

  function save() {
    setIsEditing(false);
    if (draft.trim() === (finding.researcher_note ?? "")) return;
    startSaving(() => setFindingNote(runId, finding.id, draft));
  }

  if (!isEditing) {
    return finding.researcher_note ? (
      <button
        onClick={() => setIsEditing(true)}
        className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-left text-xs text-amber-800 transition hover:bg-amber-100"
      >
        <span className="mt-0.5 shrink-0 font-medium">Note:</span>
        <span>{finding.researcher_note}</span>
      </button>
    ) : (
      <button
        onClick={() => setIsEditing(true)}
        className="self-start text-xs font-medium text-muted transition hover:text-primary"
      >
        + Add note
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(finding.researcher_note ?? "");
            setIsEditing(false);
          }
        }}
        placeholder="e.g. watch this against Q2 tracking"
        rows={2}
        disabled={isSaving}
        className="w-full rounded-md border border-border px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary"
      />
      <div className="flex gap-1.5">
        <button
          onClick={save}
          disabled={isSaving}
          className="rounded-md border border-primary/30 bg-primary-light px-2 py-0.5 text-xs font-medium text-primary transition hover:border-primary/60"
        >
          Save
        </button>
        <button
          onClick={() => {
            setDraft(finding.researcher_note ?? "");
            setIsEditing(false);
          }}
          disabled={isSaving}
          className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted transition hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ReviewButtons({
  runId,
  finding,
  isPending,
  startTransition,
  onOptimisticStatus,
}: {
  runId: string;
  finding: Finding;
  isPending: boolean;
  startTransition: TransitionStartFunction;
  onOptimisticStatus: (findingId: string, status: Finding["status"]) => void;
}) {
  function setStatus(status: "accepted" | "rejected") {
    onOptimisticStatus(finding.id, status);
    startTransition(() => setFindingStatus(runId, finding.id, status));
  }

  return (
    <div className="flex gap-1.5">
      <button
        disabled={isPending}
        onClick={() => setStatus("accepted")}
        className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
          finding.status === "accepted"
            ? "border-success bg-success-light text-success"
            : "border-border text-muted hover:border-success hover:text-success"
        }`}
      >
        <CheckIcon className="h-3 w-3" />
        Accept
      </button>
      <button
        disabled={isPending}
        onClick={() => setStatus("rejected")}
        className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
          finding.status === "rejected"
            ? "border-danger bg-danger-light text-danger"
            : "border-border text-muted hover:border-danger hover:text-danger"
        }`}
      >
        <CrossIcon className="h-3 w-3" />
        Reject
      </button>
    </div>
  );
}

const ALL = "__all__";
const NO_THEME_LABEL = "No theme";

// A small, muted palette used to color-code theme groups so related cards
// are easy to spot at a glance. Picked deterministically from the theme
// name (same theme always gets the same color), reserving a neutral tone
// for findings with no theme rather than a random color.
const THEME_PALETTE = [
  {
    borderLeft: "border-l-blue-400",
    dot: "bg-blue-400",
    badge: "bg-blue-50 text-blue-700 ring-blue-200",
  },
  {
    borderLeft: "border-l-indigo-400",
    dot: "bg-indigo-400",
    badge: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  },
  {
    borderLeft: "border-l-violet-400",
    dot: "bg-violet-400",
    badge: "bg-violet-50 text-violet-700 ring-violet-200",
  },
  {
    borderLeft: "border-l-cyan-400",
    dot: "bg-cyan-400",
    badge: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  },
  {
    borderLeft: "border-l-teal-400",
    dot: "bg-teal-400",
    badge: "bg-teal-50 text-teal-700 ring-teal-200",
  },
  {
    borderLeft: "border-l-amber-400",
    dot: "bg-amber-400",
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
  },
  {
    borderLeft: "border-l-fuchsia-400",
    dot: "bg-fuchsia-400",
    badge: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
  },
];
const NEUTRAL_THEME_COLOR = {
  borderLeft: "border-l-slate-300",
  dot: "bg-slate-300",
  badge: "bg-slate-50 text-slate-600 ring-slate-200",
};

function hashThemeName(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function colorFor(theme: string) {
  if (theme === NO_THEME_LABEL) return NEUTRAL_THEME_COLOR;
  return THEME_PALETTE[hashThemeName(theme) % THEME_PALETTE.length];
}

// Reach summary for a coded (transcript) theme finding: a ring for the share
// of participants who raised it, a status pill from how many coding passes
// found it, and two small tiles for turns and passes. The finer detail
// (independent vs echo speakers, group coverage) stays as one quiet line.
function CodedReachSummary({ finding }: { finding: Finding }) {
  const counts = finding.coding_counts;
  if (finding.origin !== "coded" || !counts) return null;
  if (counts.speakersWith === null || counts.speakersTotal === null) return null;
  if (counts.speakersTotal <= 0) return null;
  const frac = Math.min(1, counts.speakersWith / counts.speakersTotal);
  const r = 40;
  const circ = 2 * Math.PI * r;
  const pct = Math.round(frac * 100);
  const run = finding.reproduced_runs;
  const total = finding.total_runs;
  const hasPasses = run !== null && total !== null && total > 0;
  const status = !hasPasses
    ? null
    : run === total
      ? { label: "Stable", cls: "bg-success-light text-success" }
      : run / total >= 0.67
        ? { label: "Likely", cls: "bg-amber-50 text-amber-700" }
        : { label: "Tentative", cls: "bg-rose-50 text-rose-700" };
  const quiet: string[] = [];
  if (counts.independentSpeakers !== null && counts.echoTurns > 0) {
    quiet.push(
      `${counts.independentSpeakers} independent, ${counts.echoTurns} ${counts.echoTurns === 1 ? "echo" : "echoes"}`,
    );
  }
  if (counts.groupsWith !== null && counts.groupsTotal !== null) {
    quiet.push(
      `${counts.groupsWith} of ${counts.groupsTotal} ${counts.groupsTotal === 1 ? "group" : "groups"}`,
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <div
          className="relative h-[96px] w-[96px] shrink-0"
          title={`${counts.speakersWith} of ${counts.speakersTotal} participants had at least one turn coded to this theme.`}
        >
          <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden>
            <circle
              cx="48"
              cy="48"
              r={r}
              fill="none"
              strokeWidth="10"
              className="stroke-slate-200"
            />
            <circle
              cx="48"
              cy="48"
              r={r}
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(frac * circ).toFixed(1)} ${circ.toFixed(1)}`}
              transform="rotate(-90 48 48)"
              className="stroke-primary"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold leading-none text-foreground">
              {pct}%
            </span>
            <span className="mt-0.5 text-[10px] text-muted">of people</span>
          </div>
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-3 gap-2">
          <div className="rounded-lg bg-slate-50 px-2.5 py-2">
            <div className="text-sm font-bold text-foreground">
              {counts.speakersWith} of {counts.speakersTotal}
            </div>
            <div className="text-[11px] text-muted">participants</div>
          </div>
          <div className="rounded-lg bg-slate-50 px-2.5 py-2">
            <div className="text-sm font-bold text-foreground">
              {counts.turns} of {counts.participantTurns}
            </div>
            <div className="text-[11px] text-muted">turns</div>
          </div>
          <div
            className="rounded-lg bg-slate-50 px-2.5 py-2"
            title={
              hasPasses
                ? `The open coding was run ${total} times over the transcript. This theme was found in ${run} of them.`
                : undefined
            }
          >
            {hasPasses ? (
              <>
                <div className="flex gap-1 pt-0.5">
                  {Array.from({ length: total }).map((_, i) => (
                    <span
                      key={i}
                      className={`h-3 w-3 rounded-full border-2 border-purple-600 ${
                        i < run ? "bg-purple-600" : "bg-white"
                      }`}
                    />
                  ))}
                </div>
                <div className="mt-1 text-[11px] text-muted">
                  {run} of {total} passes
                </div>
              </>
            ) : (
              <div className="text-[11px] text-muted">passes n/a</div>
            )}
          </div>
        </div>
      </div>
      {(status || quiet.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {status && (
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.cls}`}
            >
              {status.label}
            </span>
          )}
          {quiet.length > 0 && (
            <span className="text-xs text-muted">{quiet.join("  ·  ")}</span>
          )}
        </div>
      )}
    </div>
  );
}

function FindingCard({
  finding,
  runId,
  isPending,
  startTransition,
  onOptimisticStatus,
  viewerLoadingId,
  openPreview,
  cardBorderClass,
  borderLeftClass,
  isDuplicate = false,
  themeLabel,
}: {
  finding: Finding;
  runId: string;
  isPending: boolean;
  startTransition: (callback: () => void) => void;
  onOptimisticStatus: (findingId: string, status: Finding["status"]) => void;
  viewerLoadingId: string | null;
  openPreview: (finding: Finding) => void;
  cardBorderClass: string;
  borderLeftClass: string;
  isDuplicate?: boolean;
  // Only set for a card standing in for its own single-finding theme group
  // (see the single-finding-theme grid below): the theme normally shown in
  // a shared heading above several cards has nowhere to go when there's
  // only one card, so it rides on the card itself instead.
  themeLabel?: { theme: string; dotClass: string };
}) {
  const hasReachSummary =
    finding.origin === "coded" &&
    !!finding.coding_counts &&
    finding.coding_counts.speakersWith !== null &&
    finding.coding_counts.speakersTotal !== null &&
    finding.coding_counts.speakersTotal > 0;
  return (
    <div
      className={`card-surface flex flex-col gap-2.5 rounded-xl border border-l-4 bg-white p-4 ${cardBorderClass} ${borderLeftClass} ${
        finding.status === "rejected" ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        {themeLabel ? (
          <span className="inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 ring-1 ring-inset ring-slate-200 bg-slate-50">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${themeLabel.dotClass}`}
              aria-hidden
            />
            <span className="min-w-0">{themeLabel.theme}</span>
          </span>
        ) : (
          <span />
        )}
        <ReviewButtons
          runId={runId}
          finding={finding}
          isPending={isPending}
          startTransition={startTransition}
          onOptimisticStatus={onOptimisticStatus}
        />
      </div>
      {/* All the badges together, in a row that wraps only when it must. */}
      <div className="flex flex-wrap items-center gap-1 [&>*]:whitespace-nowrap">
        <OriginBadge origin={finding.origin} />
        <DiscoveryBadges finding={finding} />
        {!hasReachSummary && <CodingBadges finding={finding} />}
        <DataTypeBadge dataType={finding.data_type} />
        {isNotSignificantComparison(finding) && <NotSignificantBadge />}
        {isDescriptiveOnly(finding) && <DescriptiveOnlyBadge />}
        {isDuplicate && <DuplicateBadge />}
      </div>
      <div className="max-w-prose text-sm text-foreground">
        {finding.finding_text}
      </div>
      {hasReachSummary && <CodedReachSummary finding={finding} />}
      <NoteField runId={runId} finding={finding} />
      <div className="mt-auto flex items-start justify-between gap-3 border-t border-border pt-2.5">
        <div className="min-w-0 flex-1">
          <SourceInfo
            finding={finding}
            viewerLoadingId={viewerLoadingId}
            openPreview={openPreview}
          />
        </div>
        <div className="shrink-0">
          <KindControl
            runId={runId}
            finding={finding}
            isPending={isPending}
            startTransition={startTransition}
          />
        </div>
      </div>
    </div>
  );
}

export default function FindingsTable({
  runId,
  findings: findingsProp,
}: {
  runId: string;
  findings: Finding[];
}) {
  const [isPending, startTransition] = useTransition();
  const [extraThemes, setExtraThemes] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [sortByReach, setSortByReach] = useState(false);
  // Findings-page charting, tier 1 (2026-10-05 decision): an opt-in layer on
  // top of the existing theme groups, not a replacement for them -- a theme
  // only ever gets a chart toggle when every finding in it is a
  // code-computed banner_comparison (see findingsChartData.ts), and even
  // then the cards stay exactly where they are, just collapsed by default
  // once the chart is open so a 40-card comparison set reads as one picture
  // instead of forty. Nothing renders differently until a person clicks it.
  const [chartOpenThemes, setChartOpenThemes] = useState<Set<string>>(
    new Set(),
  );
  function toggleChartForTheme(theme: string) {
    setChartOpenThemes((prev) => {
      const next = new Set(prev);
      if (next.has(theme)) next.delete(theme);
      else next.add(theme);
      return next;
    });
  }

  // Three top-level tabs over the same findings (2026-10-05 decision):
  // "all" is the page exactly as it always was (every finding, the inline
  // per-theme chart toggle included, untouched); "charts" narrows to only
  // the theme groups a chart can actually be built for, with the chart and
  // its cards both shown open by default rather than opt-in; "stated"
  // narrows to report-sourced findings (stated/coded origin), which never
  // have a chart to offer. A finding that's neither -- a generated finding
  // from the older table-wide scan (tableComputation.ts's
  // segment_difference/relationship/outlier, not a banner comparison) --
  // only shows under "all", same as today; it was never chartable and was
  // never report-sourced, so inventing a third bucket for it would be
  // noise, not signal.
  const [activeTab, setActiveTab] = useState<"all" | "charts" | "stated">(
    "all",
  );
  const duplicatesRef = useRef<HTMLDivElement | null>(null);
  // Jump targets for the floating top/bottom nav below -- a run with 100+
  // findings has no other way to get back to the filter bar once you've
  // scrolled a few screens down into the grid.
  const topRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // The server only tells us the true status once revalidatePath round-trips,
  // and clicking Accept/Reject on several cards in quick succession can let
  // those round-trips land out of order, undoing an earlier click's visual
  // state. Layering these local overrides on top of the server data means a
  // click turns the button green immediately and keeps it that way regardless
  // of network timing; the override just falls away once it agrees with what
  // the server sends back.
  const [statusOverrides, setStatusOverrides] = useState<
    Record<string, Finding["status"]>
  >({});
  const findings = findingsProp.map((finding) =>
    statusOverrides[finding.id]
      ? { ...finding, status: statusOverrides[finding.id] }
      : finding,
  );

  function setOptimisticStatus(findingId: string, status: Finding["status"]) {
    setStatusOverrides((prev) => ({ ...prev, [findingId]: status }));
  }

  function setManyOptimisticStatuses(
    findingIds: string[],
    status: Finding["status"],
  ) {
    setStatusOverrides((prev) => {
      const next = { ...prev };
      for (const id of findingIds) next[id] = status;
      return next;
    });
  }

  function acceptAllVisible(findingIds: string[]) {
    setManyOptimisticStatuses(findingIds, "accepted");
    startTransition(() =>
      setManyFindingStatuses(runId, findingIds, "accepted"),
    );
  }

  function rejectAllVisible(findingIds: string[]) {
    setManyOptimisticStatuses(findingIds, "rejected");
    startTransition(() =>
      setManyFindingStatuses(runId, findingIds, "rejected"),
    );
  }

  const [sourceFilter, setSourceFilter] = useState(ALL);
  const [themeFilter, setThemeFilter] = useState(ALL);
  const [kindFilter, setKindFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [dataTypeFilter, setDataTypeFilter] = useState(ALL);

  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [viewerLoadingId, setViewerLoadingId] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);

  async function openPreview(finding: Finding) {
    if (!finding.source_document_id && !finding.source_table_id) return;
    setViewerError(null);
    setViewerLoadingId(finding.id);
    const result = await getDocumentPreviewUrl(runId, {
      sourceDocumentId: finding.source_document_id,
      sourceTableId: finding.source_table_id,
    });
    setViewerLoadingId(null);
    if ("error" in result) {
      setViewerError(result.error);
      return;
    }
    const title = finding.source_filename ?? "Source document";
    if (result.kind === "table") {
      setViewer({
        kind: "table",
        table: result.table,
        title,
        highlightRowIndices: finding.source_cells?.rowIndices ?? [],
      });
    } else {
      setViewer({
        kind: "pdf",
        url: result.url,
        page: finding.source_page,
        title,
      });
    }
  }

  // Computed from the full, untabbed `findings` -- a theme's chart
  // eligibility doesn't depend on which tab happens to be open, only on
  // whether every finding sharing that theme name is a code-computed,
  // chartable pattern type (banner_comparison, segment_difference,
  // relationship, or outlier -- see findingsChartData.ts's
  // CHARTABLE_PATTERN_TYPES).
  const chartEligibleThemeNames = (() => {
    const byTheme = new Map<string, Finding[]>();
    for (const finding of findings) {
      const key = finding.theme ?? NO_THEME_LABEL;
      if (!byTheme.has(key)) byTheme.set(key, []);
      byTheme.get(key)!.push(finding);
    }
    const eligible = new Set<string>();
    for (const [theme, themeFindings] of byTheme) {
      if (buildChartForThemeGroup(themeFindings)) eligible.add(theme);
    }
    return eligible;
  })();

  const visibleFindings =
    activeTab === "charts"
      ? findings.filter((f) =>
          chartEligibleThemeNames.has(f.theme ?? NO_THEME_LABEL),
        )
      : activeTab === "stated"
        ? findings.filter((f) => f.origin === "stated" || f.origin === "coded")
        : findings;

  const themes = Array.from(
    new Set([
      ...visibleFindings
        .map((c) => c.theme)
        .filter((t): t is string => Boolean(t)),
      ...extraThemes,
    ]),
  ).sort();

  const sources = Array.from(
    new Set(
      visibleFindings
        .map((c) => c.source_filename)
        .filter((s): s is string => Boolean(s)),
    ),
  ).sort();

  const filteredFindings = visibleFindings.filter((finding) => {
    if (sourceFilter !== ALL && finding.source_filename !== sourceFilter)
      return false;
    if (themeFilter !== ALL && finding.theme !== themeFilter) return false;
    if (kindFilter !== ALL && finding.finding_kind !== kindFilter) return false;
    if (statusFilter !== ALL && finding.status !== statusFilter) return false;
    if (dataTypeFilter !== ALL && finding.data_type !== dataTypeFilter)
      return false;
    return true;
  });

  const filtersActive =
    sourceFilter !== ALL ||
    themeFilter !== ALL ||
    kindFilter !== ALL ||
    statusFilter !== ALL;

  // Findings flagged as probable duplicates of each other get pulled out into
  // their own review section rather than showing up (twice) in the normal
  // theme groups, so it reads as "these need a decision" rather than just
  // more findings.
  const duplicateFindings = filteredFindings.filter(
    (c) => c.duplicate_group_id,
  );
  const themeEligibleFindings = filteredFindings.filter(
    (c) => !c.duplicate_group_id,
  );

  const duplicateGroups = (() => {
    const groups = new Map<string, Finding[]>();
    for (const finding of duplicateFindings) {
      const key = finding.duplicate_group_id!;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(finding);
    }
    return Array.from(groups.entries()).map(([groupId, groupFindings]) => ({
      groupId,
      findings: groupFindings,
    }));
  })();

  // Groups findings by theme for the card view, in the same alphabetical
  // order as the theme filter, with anything untagged in its own bucket
  // at the end rather than scattered or dropped.
  const groupedByTheme = (() => {
    const groups = new Map<string, Finding[]>();
    for (const finding of themeEligibleFindings) {
      const key = finding.theme ?? NO_THEME_LABEL;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(finding);
    }
    const orderedKeys = [...themes, NO_THEME_LABEL].filter((key) =>
      groups.has(key),
    );
    const built = orderedKeys.map((theme) => ({
      theme,
      findings: groups.get(theme)!,
    }));
    if (!sortByReach) return built;
    // Highest share of participants first: the figure inside each card's
    // ring. Findings without participant counts (stated, computed) sink to
    // the end, in their existing order, because Array.sort is stable.
    const reachOf = (finding: Finding): number => {
      const c = finding.coding_counts;
      if (
        finding.origin !== "coded" ||
        !c ||
        c.speakersWith === null ||
        c.speakersTotal === null ||
        c.speakersTotal <= 0
      ) {
        return -1;
      }
      return c.speakersWith / c.speakersTotal;
    };
    return built
      .map((group) => ({
        theme: group.theme,
        findings: [...group.findings].sort((x, y) => reachOf(y) - reachOf(x)),
      }))
      .sort(
        (x, y) =>
          Math.max(...y.findings.map(reachOf)) -
          Math.max(...x.findings.map(reachOf)),
      );
  })();

  // Bucketing for the cards view: a theme with only one finding still
  // deserves its own heading-and-grid treatment when it sits between two
  // other multi-finding themes (breaking up a single-run elsewhere would
  // separate it from its natural reading position for no reason), but a
  // *run* of consecutive single-finding themes is exactly the whitespace
  // problem -- each one claiming a full-width row for one ~320px card.
  // Those runs get merged into one shared grid instead, with each card
  // carrying its own theme label (see FindingCard's themeLabel prop) in
  // place of the heading that would otherwise sit above just one card.
  type ThemeGroup = (typeof groupedByTheme)[number];
  type RenderBlock =
    | { kind: "group"; theme: string; findings: ThemeGroup["findings"] }
    | { kind: "single-run"; groups: ThemeGroup[] };
  const renderBlocks = (() => {
    const blocks: RenderBlock[] = [];
    let buffer: ThemeGroup[] = [];
    const flush = () => {
      if (buffer.length > 0) {
        blocks.push({ kind: "single-run", groups: buffer });
        buffer = [];
      }
    };
    for (const group of groupedByTheme) {
      if (group.findings.length === 1) {
        buffer.push(group);
      } else {
        flush();
        blocks.push({
          kind: "group",
          theme: group.theme,
          findings: group.findings,
        });
      }
    }
    flush();
    return blocks;
  })();

  // Counts for the clickable category strip above the list. These deliberately
  // ignore the theme filter itself (but respect the other filters) so every
  // pill keeps showing its true count even while one theme is selected,
  // rather than the other pills all collapsing to zero.
  const pillEligibleFindings = visibleFindings.filter((finding) => {
    if (sourceFilter !== ALL && finding.source_filename !== sourceFilter)
      return false;
    if (kindFilter !== ALL && finding.finding_kind !== kindFilter) return false;
    if (statusFilter !== ALL && finding.status !== statusFilter) return false;
    if (dataTypeFilter !== ALL && finding.data_type !== dataTypeFilter)
      return false;
    return true;
  });
  const pillDuplicateCount = pillEligibleFindings.filter(
    (c) => c.duplicate_group_id,
  ).length;
  const themeCounts = (() => {
    const counts = new Map<string, number>();
    for (const finding of pillEligibleFindings) {
      if (finding.duplicate_group_id) continue;
      const key = finding.theme ?? NO_THEME_LABEL;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  })();
  const pillThemeOrder = [...themes, NO_THEME_LABEL].filter(
    (key) => (themeCounts.get(key) ?? 0) > 0,
  );

  function scrollToDuplicates() {
    duplicatesRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function scrollToTop() {
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  const chartableFindingsCount = findings.filter((f) =>
    chartEligibleThemeNames.has(f.theme ?? NO_THEME_LABEL),
  ).length;
  const statedFindingsCount = findings.filter(
    (f) => f.origin === "stated" || f.origin === "coded",
  ).length;

  return (
    <div className="flex items-start gap-4">
      <div ref={topRef} className="min-w-0 flex-1">
        <div className="mb-3 inline-flex items-center gap-0.5 rounded-lg border border-border bg-white p-0.5">
          {(
            [
              ["all", "All findings", findings.length],
              ["charts", "Chart findings", chartableFindingsCount],
              ["stated", "Stated findings", statedFindingsCount],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              onClick={() => setActiveTab(value)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                activeTab === value
                  ? "bg-primary-light text-primary"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                  activeTab === value
                    ? "bg-white text-primary"
                    : "bg-slate-100 text-muted"
                }`}
              >
                {count}
              </span>
            </button>
          ))}
        </div>
        {(pillThemeOrder.length > 0 ||
          pillDuplicateCount > 0 ||
          filtersActive) && (
          <div className="mb-3 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
            {filtersActive && (
              <button
                onClick={() => {
                  setSourceFilter(ALL);
                  setThemeFilter(ALL);
                  setKindFilter(ALL);
                  setStatusFilter(ALL);
                }}
                className="flex items-center justify-center rounded-lg border border-primary/30 bg-primary-light px-2.5 py-1.5 text-xs font-medium text-primary transition hover:border-primary/60"
              >
                Clear filters
              </button>
            )}
            {pillThemeOrder.map((theme) => {
              const isActive = themeFilter === theme;
              return (
                <button
                  key={theme}
                  onClick={() => setThemeFilter(isActive ? ALL : theme)}
                  className={`flex items-center justify-between gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium leading-none transition ${
                    isActive
                      ? "border-primary bg-primary-light text-primary"
                      : "border-border bg-white text-foreground hover:border-slate-400"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${colorFor(theme).dot}`}
                      aria-hidden
                    />
                    <span className="truncate">{theme}</span>
                  </span>
                  <span className="shrink-0 text-muted">
                    {themeCounts.get(theme) ?? 0}
                  </span>
                </button>
              );
            })}
            {pillDuplicateCount > 0 && (
              <button
                onClick={scrollToDuplicates}
                className="flex items-center justify-between gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium leading-none text-amber-700 transition hover:border-amber-300"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
                    aria-hidden
                  />
                  <span className="truncate">Possible duplicates</span>
                </span>
                <span className="shrink-0 text-amber-600">
                  {pillDuplicateCount}
                </span>
              </button>
            )}
          </div>
        )}
        <div className="mb-3 inline-flex items-center gap-0.5 rounded-lg border border-border bg-white p-0.5">
          {(
            [
              [ALL, "All evidence"],
              ["qualitative", "Qualitative"],
              ["quantitative", "Quantitative"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setDataTypeFilter(value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                dataTypeFilter === value
                  ? "bg-primary-light text-primary"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className={selectClass}
          >
            <option value={ALL}>All sources</option>
            {sources.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
          <select
            value={themeFilter}
            onChange={(e) => setThemeFilter(e.target.value)}
            className={selectClass}
          >
            <option value={ALL}>All themes</option>
            {themes.map((theme) => (
              <option key={theme} value={theme}>
                {theme}
              </option>
            ))}
          </select>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            className={selectClass}
          >
            <option value={ALL}>All kinds</option>
            {kindOrder.map((kind) => (
              <option key={kind} value={kind}>
                {kindLabel[kind]}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={selectClass}
          >
            <option value={ALL}>All statuses</option>
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
          <span className="text-xs text-muted">
            Showing {filteredFindings.length} of {visibleFindings.length}
          </span>
          {filteredFindings.length > 0 && (
            <div className="flex items-center gap-1.5">
              <button
                disabled={isPending}
                onClick={() =>
                  acceptAllVisible(filteredFindings.map((c) => c.id))
                }
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-success hover:text-success"
              >
                <CheckIcon className="h-3 w-3" />
                Accept all{filtersActive ? " visible" : ""}
              </button>
              <button
                disabled={isPending}
                onClick={() =>
                  rejectAllVisible(filteredFindings.map((c) => c.id))
                }
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-danger hover:text-danger"
              >
                <CrossIcon className="h-3 w-3" />
                Reject all{filtersActive ? " visible" : ""}
              </button>
            </div>
          )}
          {activeTab !== "charts" && (
            <button
              type="button"
              onClick={() => setSortByReach((v) => !v)}
              aria-pressed={sortByReach}
              title="Order themes and findings by the share of participants who raised them (the percentage in each card's ring), highest first."
              className={`ml-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                sortByReach
                  ? "border-primary bg-primary-light text-primary"
                  : "border-border bg-white text-muted hover:text-foreground"
              }`}
            >
              Sort by % of people{sortByReach ? " (high to low)" : ""}
            </button>
          )}
          {activeTab !== "charts" && (
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-white p-0.5">
              <button
                onClick={() => setViewMode("cards")}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  viewMode === "cards"
                    ? "bg-primary-light text-primary"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <GridIcon className="h-3.5 w-3.5" />
                Cards
              </button>
              <button
                onClick={() => setViewMode("table")}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  viewMode === "table"
                    ? "bg-primary-light text-primary"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <ListIcon className="h-3.5 w-3.5" />
                Table
              </button>
            </div>
          )}
        </div>

        {activeTab === "charts" ? (
          // A grid rather than the stacked single-column list the other two
          // tabs use: these are meant to be scanned side by side, not read
          // top to bottom like a feed of cards. Each tile grows to full
          // width on its own (has-[details[open]]:col-span-full) the moment
          // its own "show comparisons" disclosure opens, so the expanded
          // card grid underneath has room rather than being squeezed into
          // one grid column.
          <div className="grid grid-cols-[repeat(auto-fit,minmax(420px,1fr))] items-start gap-5">
            {groupedByTheme.map((group) => {
              const chartSpec = buildChartForThemeGroup(group.findings);
              if (!chartSpec) return null; // defensive only; visibleFindings already guarantees this
              return (
                <div
                  key={group.theme}
                  className="rounded-xl border border-border bg-slate-50/60 p-3 has-[details[open]]:col-span-full"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${colorFor(group.theme).dot}`}
                      aria-hidden
                    />
                    <h3 className="text-sm font-semibold text-foreground">
                      {group.theme}
                    </h3>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${colorFor(group.theme).badge}`}
                    >
                      {group.findings.length}
                    </span>
                    {group.findings.some((c) => c.status !== "accepted") && (
                      <button
                        disabled={isPending}
                        onClick={() =>
                          acceptAllVisible(group.findings.map((c) => c.id))
                        }
                        className="ml-1 flex items-center gap-1 rounded-lg border border-border px-2 py-0.5 text-xs font-medium text-muted transition hover:border-success hover:text-success"
                      >
                        <CheckIcon className="h-3 w-3" />
                        Accept all in theme
                      </button>
                    )}
                  </div>
                  <div className="mb-2">
                    <FindingsChart spec={chartSpec} />
                  </div>
                  {/* The chart is the point of this tab, so the comparisons
                      behind it stay tucked away by default rather than
                      dumping dozens of near-identical cards right under it
                      -- that wall of tiles immediately under the chart was
                      the "mixed with the tiles" clutter this replaced. One
                      click still gets to every card, same as the inline
                      toggle on the "All findings" tab. */}
                  <details className="group/charttab-cards">
                    <summary className="mb-2 cursor-pointer text-xs font-medium text-muted hover:text-foreground">
                      Show the {group.findings.length} individual comparisons
                      behind this chart
                    </summary>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
                      {group.findings.map((finding) => (
                        <FindingCard
                          key={finding.id}
                          finding={finding}
                          runId={runId}
                          isPending={isPending}
                          startTransition={startTransition}
                          onOptimisticStatus={setOptimisticStatus}
                          viewerLoadingId={viewerLoadingId}
                          openPreview={openPreview}
                          cardBorderClass="border-border"
                          borderLeftClass={colorFor(group.theme).borderLeft}
                        />
                      ))}
                    </div>
                  </details>
                </div>
              );
            })}
            {groupedByTheme.length === 0 && (
              <p className="col-span-full text-sm text-muted">
                No chartable comparisons match these filters.
              </p>
            )}
          </div>
        ) : viewMode === "cards" ? (
          <div className="flex flex-col gap-7">
            {renderBlocks.map((block, blockIndex) =>
              block.kind === "group" ? (
                <div key={block.theme}>
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${colorFor(block.theme).dot}`}
                      aria-hidden
                    />
                    <h3 className="text-sm font-semibold text-foreground">
                      {block.theme}
                    </h3>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${colorFor(block.theme).badge}`}
                    >
                      {block.findings.length}
                    </span>
                    {block.findings.some((c) => c.status !== "accepted") && (
                      <button
                        disabled={isPending}
                        onClick={() =>
                          acceptAllVisible(block.findings.map((c) => c.id))
                        }
                        className="ml-1 flex items-center gap-1 rounded-lg border border-border px-2 py-0.5 text-xs font-medium text-muted transition hover:border-success hover:text-success"
                      >
                        <CheckIcon className="h-3 w-3" />
                        Accept all in theme
                      </button>
                    )}
                    {(() => {
                      const chartSpec = buildChartForThemeGroup(block.findings);
                      if (!chartSpec) return null;
                      const open = chartOpenThemes.has(block.theme);
                      return (
                        <button
                          onClick={() => toggleChartForTheme(block.theme)}
                          className={`ml-1 flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-medium transition ${
                            open
                              ? "border-primary text-primary"
                              : "border-border text-muted hover:border-primary hover:text-primary"
                          }`}
                        >
                          <ChartIcon className="h-3 w-3" />
                          {open ? "Hide chart" : "View as chart"}
                        </button>
                      );
                    })()}
                  </div>
                  {(() => {
                    if (!chartOpenThemes.has(block.theme)) return null;
                    const chartSpec = buildChartForThemeGroup(block.findings);
                    if (!chartSpec) return null;
                    return (
                      <div className="mb-3">
                        <FindingsChart spec={chartSpec} />
                      </div>
                    );
                  })()}
                  {(() => {
                    const cardsGrid = (
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
                        {block.findings.map((finding) => (
                          <FindingCard
                            key={finding.id}
                            finding={finding}
                            runId={runId}
                            isPending={isPending}
                            startTransition={startTransition}
                            onOptimisticStatus={setOptimisticStatus}
                            viewerLoadingId={viewerLoadingId}
                            openPreview={openPreview}
                            cardBorderClass="border-border"
                            borderLeftClass={colorFor(block.theme).borderLeft}
                          />
                        ))}
                      </div>
                    );
                    // Once the chart is open, the individual pairwise/ANOVA
                    // cards collapse underneath it by default (per the
                    // 2026-10-05 decision) -- still there, one click away,
                    // rather than removed. With the chart closed (the
                    // default), nothing changes from before this feature.
                    if (!chartOpenThemes.has(block.theme)) return cardsGrid;
                    return (
                      <details className="group/cards">
                        <summary className="mb-2 cursor-pointer text-xs font-medium text-muted hover:text-foreground">
                          Show the {block.findings.length} individual
                          comparisons behind this chart
                        </summary>
                        {cardsGrid}
                      </details>
                    );
                  })()}
                </div>
              ) : (
                <div
                  key={`single-run-${blockIndex}`}
                  className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3"
                >
                  {block.groups.map((group) =>
                    group.findings.map((finding) => (
                      <FindingCard
                        key={finding.id}
                        finding={finding}
                        runId={runId}
                        isPending={isPending}
                        startTransition={startTransition}
                        onOptimisticStatus={setOptimisticStatus}
                        viewerLoadingId={viewerLoadingId}
                        openPreview={openPreview}
                        cardBorderClass="border-border"
                        borderLeftClass={colorFor(group.theme).borderLeft}
                        themeLabel={{
                          theme: group.theme,
                          dotClass: colorFor(group.theme).dot,
                        }}
                      />
                    )),
                  )}
                </div>
              ),
            )}

            {duplicateGroups.length > 0 && (
              <div ref={duplicatesRef}>
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full bg-amber-400"
                    aria-hidden
                  />
                  <h3 className="text-sm font-semibold text-foreground">
                    Possible duplicates
                  </h3>
                  <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                    {duplicateFindings.length}
                  </span>
                </div>
                <p className="mb-3 text-xs text-muted">
                  These look like the same finding, stated more than once. Take
                  a look and reject any repeats, the survivor will rejoin its
                  normal theme next time this run is processed.
                </p>
                <div className="flex flex-col gap-3">
                  {duplicateGroups.map(
                    ({ groupId, findings: groupFindings }) => (
                      <div
                        key={groupId}
                        className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3 rounded-xl border border-dashed border-amber-200 bg-amber-50/30 p-3"
                      >
                        {groupFindings.map((finding) => (
                          <FindingCard
                            key={finding.id}
                            finding={finding}
                            runId={runId}
                            isPending={isPending}
                            startTransition={startTransition}
                            onOptimisticStatus={setOptimisticStatus}
                            viewerLoadingId={viewerLoadingId}
                            openPreview={openPreview}
                            cardBorderClass="border-amber-200"
                            borderLeftClass="border-l-amber-400"
                            isDuplicate
                          />
                        ))}
                      </div>
                    ),
                  )}
                </div>
              </div>
            )}

            {groupedByTheme.length === 0 && duplicateGroups.length === 0 && (
              <p className="text-sm text-muted">
                No findings match these filters.
              </p>
            )}
          </div>
        ) : (
          <div className="card-surface overflow-hidden rounded-lg border border-border">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="w-[36%] px-3 py-2.5">Finding</th>
                    <th className="px-3 py-2.5">Kind</th>
                    <th className="px-3 py-2.5">Theme</th>
                    <th className="px-3 py-2.5">Source</th>
                    <th className="px-3 py-2.5">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFindings.map((finding) => (
                    <tr
                      key={finding.id}
                      className={`border-t border-border transition hover:bg-slate-50 ${
                        finding.status === "rejected" ? "opacity-50" : ""
                      }`}
                    >
                      <td className="px-3 py-3 align-top">
                        <div className="mb-1.5 flex flex-wrap items-center gap-1">
                          <OriginBadge origin={finding.origin} />
                          <DiscoveryBadges finding={finding} />
                          <CodingBadges finding={finding} />
                          <DataTypeBadge dataType={finding.data_type} />
                          {isNotSignificantComparison(finding) && (
                            <NotSignificantBadge />
                          )}
                          {isDescriptiveOnly(finding) && (
                            <DescriptiveOnlyBadge />
                          )}
                          {finding.duplicate_group_id && <DuplicateBadge />}
                        </div>
                        <div className="text-foreground">
                          {finding.finding_text}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <KindControl
                          runId={runId}
                          finding={finding}
                          isPending={isPending}
                          startTransition={startTransition}
                        />
                      </td>
                      <td className="px-3 py-3 align-top">
                        <ThemeCell
                          runId={runId}
                          finding={finding}
                          themes={themes}
                          onThemeAdded={(theme) =>
                            setExtraThemes((prev) => [...prev, theme])
                          }
                        />
                      </td>
                      <td className="max-w-[160px] px-3 py-3 align-top">
                        <SourceInfo
                          finding={finding}
                          viewerLoadingId={viewerLoadingId}
                          openPreview={openPreview}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 align-top">
                        <ReviewButtons
                          runId={runId}
                          finding={finding}
                          isPending={isPending}
                          startTransition={startTransition}
                          onOptimisticStatus={setOptimisticStatus}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div ref={bottomRef} />

        {/* With 140 findings in a run, the filter bar and theme pills at
            the top are the fastest way back to a specific group, but
            there was previously no way back to them short of scrolling by
            hand -- this is the standard long-list fix: a floating jump
            control, out of the way until it's needed. */}
        {filteredFindings.length > 15 && (
          <div className="fixed bottom-5 right-5 z-[1000] flex flex-col gap-1.5">
            <button
              type="button"
              onClick={scrollToTop}
              title="Back to the filters"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-white text-muted shadow-lg transition hover:border-slate-400 hover:text-foreground"
            >
              <span aria-hidden>&#8593;</span>
              <span className="sr-only">Scroll to top of findings</span>
            </button>
            <button
              type="button"
              onClick={scrollToBottom}
              title="Jump to the end of the list"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-white text-muted shadow-lg transition hover:border-slate-400 hover:text-foreground"
            >
              <span aria-hidden>&#8595;</span>
              <span className="sr-only">Scroll to bottom of findings</span>
            </button>
          </div>
        )}

        {viewerError && (
          <div className="fixed bottom-5 right-5 z-[1001] max-w-xs rounded-lg border border-danger bg-danger-light px-4 py-3 text-sm text-danger shadow-lg">
            {viewerError}
            <button
              onClick={() => setViewerError(null)}
              className="ml-2 font-medium underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {viewer && (
        <div className="w-full max-w-[460px] shrink-0">
          <DocumentPreviewPanel
            viewer={viewer}
            onClose={() => setViewer(null)}
          />
        </div>
      )}
    </div>
  );
}
