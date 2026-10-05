"use client";

import { useState, useTransition, useRef, useEffect, type TransitionStartFunction } from "react";
import { setFindingStatus, setManyFindingStatuses, setFindingKind, setFindingTheme, setFindingNote, type FindingKind } from "@/lib/findingActions";
import { getDocumentPreviewUrl } from "@/lib/previewActions";
import type { ParsedTable } from "@/lib/parseTable";
import { EyeIcon, CheckIcon, CrossIcon, ListIcon, GridIcon } from "@/components/icons";

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
};

type Viewer =
  | { kind: "pdf"; url: string; page: number | null; title: string }
  | { kind: "table"; table: ParsedTable; title: string; highlightRowIndices: number[] };

function DocumentPreviewPanel({ viewer, onClose }: { viewer: Viewer; onClose: () => void }) {
  const highlightRef = useRef<HTMLTableRowElement | null>(null);
  const highlightSet =
    viewer.kind === "table" ? new Set(viewer.highlightRowIndices) : null;
  const firstHighlightIndex =
    viewer.kind === "table" && viewer.highlightRowIndices.length > 0
      ? Math.min(...viewer.highlightRowIndices)
      : null;

  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // Re-run whenever a different finding's preview opens, so the panel jumps
    // to the new highlighted row rather than staying scrolled where it was.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer]);

  return (
    <div className="sticky top-4 flex h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-xl border border-border bg-white shadow-lg">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-slate-50 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{viewer.title}</div>
          {viewer.kind === "pdf" && viewer.page != null && (
            <div className="mt-0.5 text-xs font-medium text-primary">Page {viewer.page}</div>
          )}
          {viewer.kind === "table" && (
            <div className="mt-0.5 text-xs font-medium text-muted">
              {viewer.table.rows.length} row{viewer.table.rows.length === 1 ? "" : "s"} &middot;{" "}
              {viewer.table.headers.length} column{viewer.table.headers.length === 1 ? "" : "s"}
              {viewer.highlightRowIndices.length > 0 && (
                <span className="ml-2 font-semibold text-amber-700">
                  &bull; {viewer.highlightRowIndices.length} row
                  {viewer.highlightRowIndices.length === 1 ? "" : "s"} behind this finding, highlighted below
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
          src={viewer.page != null ? `${viewer.url}#page=${viewer.page}` : viewer.url}
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
                    ref={rowIndex === firstHighlightIndex ? highlightRef : undefined}
                    className={`border-b border-border last:border-0 ${
                      isHighlighted ? "bg-amber-50 ring-1 ring-inset ring-amber-200" : "even:bg-slate-50/50"
                    }`}
                  >
                    {viewer.table.headers.map((header) => (
                      <td
                        key={header}
                        className={`whitespace-nowrap px-3 py-1.5 ${
                          isHighlighted ? "font-medium text-amber-900" : "text-foreground"
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
        <button type="submit" className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-white hover:bg-primary-hover">
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
        startTransition(() => setFindingTheme(runId, finding.id, e.target.value));
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

function DataTypeBadge({ dataType }: { dataType: "qualitative" | "quantitative" | null }) {
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
  { borderLeft: "border-l-blue-400", dot: "bg-blue-400", badge: "bg-blue-50 text-blue-700 ring-blue-200" },
  { borderLeft: "border-l-indigo-400", dot: "bg-indigo-400", badge: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  { borderLeft: "border-l-violet-400", dot: "bg-violet-400", badge: "bg-violet-50 text-violet-700 ring-violet-200" },
  { borderLeft: "border-l-cyan-400", dot: "bg-cyan-400", badge: "bg-cyan-50 text-cyan-700 ring-cyan-200" },
  { borderLeft: "border-l-teal-400", dot: "bg-teal-400", badge: "bg-teal-50 text-teal-700 ring-teal-200" },
  { borderLeft: "border-l-amber-400", dot: "bg-amber-400", badge: "bg-amber-50 text-amber-700 ring-amber-200" },
  { borderLeft: "border-l-fuchsia-400", dot: "bg-fuchsia-400", badge: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200" },
];
const NEUTRAL_THEME_COLOR = { borderLeft: "border-l-slate-300", dot: "bg-slate-300", badge: "bg-slate-50 text-slate-600 ring-slate-200" };

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

export default function FindingsTable({ runId, findings: findingsProp }: { runId: string; findings: Finding[] }) {
  const [isPending, startTransition] = useTransition();
  const [extraThemes, setExtraThemes] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const duplicatesRef = useRef<HTMLDivElement | null>(null);

  // The server only tells us the true status once revalidatePath round-trips,
  // and clicking Accept/Reject on several cards in quick succession can let
  // those round-trips land out of order, undoing an earlier click's visual
  // state. Layering these local overrides on top of the server data means a
  // click turns the button green immediately and keeps it that way regardless
  // of network timing; the override just falls away once it agrees with what
  // the server sends back.
  const [statusOverrides, setStatusOverrides] = useState<Record<string, Finding["status"]>>({});
  const findings = findingsProp.map((finding) =>
    statusOverrides[finding.id] ? { ...finding, status: statusOverrides[finding.id] } : finding
  );

  function setOptimisticStatus(findingId: string, status: Finding["status"]) {
    setStatusOverrides((prev) => ({ ...prev, [findingId]: status }));
  }

  function setManyOptimisticStatuses(findingIds: string[], status: Finding["status"]) {
    setStatusOverrides((prev) => {
      const next = { ...prev };
      for (const id of findingIds) next[id] = status;
      return next;
    });
  }

  function acceptAllVisible(findingIds: string[]) {
    setManyOptimisticStatuses(findingIds, "accepted");
    startTransition(() => setManyFindingStatuses(runId, findingIds, "accepted"));
  }

  function rejectAllVisible(findingIds: string[]) {
    setManyOptimisticStatuses(findingIds, "rejected");
    startTransition(() => setManyFindingStatuses(runId, findingIds, "rejected"));
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
      setViewer({ kind: "pdf", url: result.url, page: finding.source_page, title });
    }
  }

  const themes = Array.from(
    new Set([...findings.map((c) => c.theme).filter((t): t is string => Boolean(t)), ...extraThemes])
  ).sort();

  const sources = Array.from(
    new Set(findings.map((c) => c.source_filename).filter((s): s is string => Boolean(s)))
  ).sort();

  const filteredFindings = findings.filter((finding) => {
    if (sourceFilter !== ALL && finding.source_filename !== sourceFilter) return false;
    if (themeFilter !== ALL && finding.theme !== themeFilter) return false;
    if (kindFilter !== ALL && finding.finding_kind !== kindFilter) return false;
    if (statusFilter !== ALL && finding.status !== statusFilter) return false;
    if (dataTypeFilter !== ALL && finding.data_type !== dataTypeFilter) return false;
    return true;
  });

  const filtersActive =
    sourceFilter !== ALL || themeFilter !== ALL || kindFilter !== ALL || statusFilter !== ALL;

  // Findings flagged as probable duplicates of each other get pulled out into
  // their own review section rather than showing up (twice) in the normal
  // theme groups, so it reads as "these need a decision" rather than just
  // more findings.
  const duplicateFindings = filteredFindings.filter((c) => c.duplicate_group_id);
  const themeEligibleFindings = filteredFindings.filter((c) => !c.duplicate_group_id);

  const duplicateGroups = (() => {
    const groups = new Map<string, Finding[]>();
    for (const finding of duplicateFindings) {
      const key = finding.duplicate_group_id!;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(finding);
    }
    return Array.from(groups.entries()).map(([groupId, groupFindings]) => ({ groupId, findings: groupFindings }));
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
    const orderedKeys = [...themes, NO_THEME_LABEL].filter((key) => groups.has(key));
    return orderedKeys.map((theme) => ({ theme, findings: groups.get(theme)! }));
  })();

  // Counts for the clickable category strip above the list. These deliberately
  // ignore the theme filter itself (but respect the other filters) so every
  // pill keeps showing its true count even while one theme is selected,
  // rather than the other pills all collapsing to zero.
  const pillEligibleFindings = findings.filter((finding) => {
    if (sourceFilter !== ALL && finding.source_filename !== sourceFilter) return false;
    if (kindFilter !== ALL && finding.finding_kind !== kindFilter) return false;
    if (statusFilter !== ALL && finding.status !== statusFilter) return false;
    if (dataTypeFilter !== ALL && finding.data_type !== dataTypeFilter) return false;
    return true;
  });
  const pillDuplicateCount = pillEligibleFindings.filter((c) => c.duplicate_group_id).length;
  const themeCounts = (() => {
    const counts = new Map<string, number>();
    for (const finding of pillEligibleFindings) {
      if (finding.duplicate_group_id) continue;
      const key = finding.theme ?? NO_THEME_LABEL;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  })();
  const pillThemeOrder = [...themes, NO_THEME_LABEL].filter((key) => (themeCounts.get(key) ?? 0) > 0);

  function scrollToDuplicates() {
    duplicatesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
      {(pillThemeOrder.length > 0 || pillDuplicateCount > 0 || filtersActive) && (
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
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${colorFor(theme).dot}`} aria-hidden />
                  <span className="truncate">{theme}</span>
                </span>
                <span className="shrink-0 text-muted">{themeCounts.get(theme) ?? 0}</span>
              </button>
            );
          })}
          {pillDuplicateCount > 0 && (
            <button
              onClick={scrollToDuplicates}
              className="flex items-center justify-between gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium leading-none text-amber-700 transition hover:border-amber-300"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
                <span className="truncate">Possible duplicates</span>
              </span>
              <span className="shrink-0 text-amber-600">{pillDuplicateCount}</span>
            </button>
          )}
        </div>
      )}
      <div className="mb-3 inline-flex items-center gap-0.5 rounded-lg border border-border bg-white p-0.5">
        {([
          [ALL, "All evidence"],
          ["qualitative", "Qualitative"],
          ["quantitative", "Quantitative"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setDataTypeFilter(value)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              dataTypeFilter === value ? "bg-primary-light text-primary" : "text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={selectClass}>
          <option value={ALL}>All sources</option>
          {sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
        <select value={themeFilter} onChange={(e) => setThemeFilter(e.target.value)} className={selectClass}>
          <option value={ALL}>All themes</option>
          {themes.map((theme) => (
            <option key={theme} value={theme}>
              {theme}
            </option>
          ))}
        </select>
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className={selectClass}>
          <option value={ALL}>All kinds</option>
          {kindOrder.map((kind) => (
            <option key={kind} value={kind}>
              {kindLabel[kind]}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectClass}>
          <option value={ALL}>All statuses</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
        </select>
        <span className="text-xs text-muted">
          Showing {filteredFindings.length} of {findings.length}
        </span>
        {filteredFindings.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              disabled={isPending}
              onClick={() => acceptAllVisible(filteredFindings.map((c) => c.id))}
              className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-success hover:text-success"
            >
              <CheckIcon className="h-3 w-3" />
              Accept all{filtersActive ? " visible" : ""}
            </button>
            <button
              disabled={isPending}
              onClick={() => rejectAllVisible(filteredFindings.map((c) => c.id))}
              className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-danger hover:text-danger"
            >
              <CrossIcon className="h-3 w-3" />
              Reject all{filtersActive ? " visible" : ""}
            </button>
          </div>
        )}
        <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-border bg-white p-0.5">
          <button
            onClick={() => setViewMode("cards")}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
              viewMode === "cards" ? "bg-primary-light text-primary" : "text-muted hover:text-foreground"
            }`}
          >
            <GridIcon className="h-3.5 w-3.5" />
            Cards
          </button>
          <button
            onClick={() => setViewMode("table")}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
              viewMode === "table" ? "bg-primary-light text-primary" : "text-muted hover:text-foreground"
            }`}
          >
            <ListIcon className="h-3.5 w-3.5" />
            Table
          </button>
        </div>
      </div>

      {viewMode === "cards" ? (
        <div className="flex flex-col gap-7">
          {groupedByTheme.map(({ theme, findings: themeFindings }) => (
            <div key={theme}>
              <div className="mb-3 flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${colorFor(theme).dot}`} aria-hidden />
                <h3 className="text-sm font-semibold text-foreground">{theme}</h3>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${colorFor(theme).badge}`}>
                  {themeFindings.length}
                </span>
                {themeFindings.some((c) => c.status !== "accepted") && (
                  <button
                    disabled={isPending}
                    onClick={() => acceptAllVisible(themeFindings.map((c) => c.id))}
                    className="ml-1 flex items-center gap-1 rounded-lg border border-border px-2 py-0.5 text-xs font-medium text-muted transition hover:border-success hover:text-success"
                  >
                    <CheckIcon className="h-3 w-3" />
                    Accept all in theme
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                {themeFindings.map((finding) => (
                  <div
                    key={finding.id}
                    className={`card-surface flex min-w-[280px] max-w-[400px] flex-1 basis-[320px] flex-col gap-2.5 rounded-xl border border-border border-l-4 bg-white p-4 ${colorFor(theme).borderLeft} ${
                      finding.status === "rejected" ? "opacity-50" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <OriginBadge origin={finding.origin} />
                        <DataTypeBadge dataType={finding.data_type} />
                      </div>
                      <ReviewButtons runId={runId} finding={finding} isPending={isPending} startTransition={startTransition} onOptimisticStatus={setOptimisticStatus} />
                    </div>
                    <div className="max-w-prose text-sm text-foreground">{finding.finding_text}</div>
                    <NoteField runId={runId} finding={finding} />
                    <div className="mt-auto flex items-start justify-between gap-3 border-t border-border pt-2.5">
                      <div className="min-w-0 flex-1">
                        <SourceInfo finding={finding} viewerLoadingId={viewerLoadingId} openPreview={openPreview} />
                      </div>
                      <div className="shrink-0">
                        <KindControl runId={runId} finding={finding} isPending={isPending} startTransition={startTransition} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {duplicateGroups.length > 0 && (
            <div ref={duplicatesRef}>
              <div className="mb-1 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" aria-hidden />
                <h3 className="text-sm font-semibold text-foreground">Possible duplicates</h3>
                <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                  {duplicateFindings.length}
                </span>
              </div>
              <p className="mb-3 text-xs text-muted">
                These look like the same finding, stated more than once. Take a look and reject any repeats,
                the survivor will rejoin its normal theme next time this run is processed.
              </p>
              <div className="flex flex-col gap-3">
                {duplicateGroups.map(({ groupId, findings: groupFindings }) => (
                  <div key={groupId} className="flex flex-wrap gap-3 rounded-xl border border-dashed border-amber-200 bg-amber-50/30 p-3">
                    {groupFindings.map((finding) => (
                      <div
                        key={finding.id}
                        className={`card-surface flex min-w-[280px] max-w-[400px] flex-1 basis-[320px] flex-col gap-2.5 rounded-xl border border-amber-200 border-l-4 border-l-amber-400 bg-white p-4 ${
                          finding.status === "rejected" ? "opacity-50" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1">
                            <OriginBadge origin={finding.origin} />
                            <DataTypeBadge dataType={finding.data_type} />
                            <DuplicateBadge />
                          </div>
                          <ReviewButtons runId={runId} finding={finding} isPending={isPending} startTransition={startTransition} onOptimisticStatus={setOptimisticStatus} />
                        </div>
                        <div className="max-w-prose text-sm text-foreground">{finding.finding_text}</div>
                    <NoteField runId={runId} finding={finding} />
                        <div className="mt-auto flex items-start justify-between gap-3 border-t border-border pt-2.5">
                          <div className="min-w-0 flex-1">
                            <SourceInfo finding={finding} viewerLoadingId={viewerLoadingId} openPreview={openPreview} />
                          </div>
                          <div className="shrink-0">
                            <KindControl runId={runId} finding={finding} isPending={isPending} startTransition={startTransition} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {groupedByTheme.length === 0 && duplicateGroups.length === 0 && (
            <p className="text-sm text-muted">No findings match these filters.</p>
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
                        <DataTypeBadge dataType={finding.data_type} />
                        {finding.duplicate_group_id && <DuplicateBadge />}
                      </div>
                      <div className="text-foreground">{finding.finding_text}</div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <KindControl runId={runId} finding={finding} isPending={isPending} startTransition={startTransition} />
                    </td>
                    <td className="px-3 py-3 align-top">
                      <ThemeCell
                        runId={runId}
                        finding={finding}
                        themes={themes}
                        onThemeAdded={(theme) => setExtraThemes((prev) => [...prev, theme])}
                      />
                    </td>
                    <td className="max-w-[160px] px-3 py-3 align-top">
                      <SourceInfo finding={finding} viewerLoadingId={viewerLoadingId} openPreview={openPreview} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 align-top">
                      <ReviewButtons runId={runId} finding={finding} isPending={isPending} startTransition={startTransition} onOptimisticStatus={setOptimisticStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewerError && (
        <div className="fixed bottom-5 right-5 z-[1001] max-w-xs rounded-lg border border-danger bg-danger-light px-4 py-3 text-sm text-danger shadow-lg">
          {viewerError}
          <button onClick={() => setViewerError(null)} className="ml-2 font-medium underline">
            Dismiss
          </button>
        </div>
      )}
      </div>

      {viewer && (
        <div className="w-full max-w-[460px] shrink-0">
          <DocumentPreviewPanel viewer={viewer} onClose={() => setViewer(null)} />
        </div>
      )}
    </div>
  );
}
