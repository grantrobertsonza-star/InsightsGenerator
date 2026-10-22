"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { saveTranscriptSetupAction, withdrawTranscriptSetupAction } from "@/lib/codingAnalysisActions";
import DeleteDocumentButton from "@/app/DeleteDocumentButton";
import { readDataFileAction, saveDataSetupAction } from "@/lib/dataSetupActions";
import { displayDay, displayUtcMinute } from "@/lib/displayDate";
import { useHydrated } from "@/app/useHydrated";
import {
  DEFAULT_DATA_SETUP,
  LAYOUT_LABEL,
  METHOD_LABEL,
  UNIT_LABEL,
  type DataSetup,
} from "@/lib/dataSetupShared";
import {
  ACCEPTANCE_LABEL,
  PROCESSING_LABEL,
  SOURCE_STATE_FILTERS,
  fileTag,
  matchesSearch,
  matchesStateFilter,
  matchesTypeFilter,
  sortSources,
  SOURCE_SORTS,
  TYPE_GROUP_FILTERS,
  type SourceGroup,
  type SourceSort,
  processingState,
  type AcceptanceState,
  type ProcessingState,
  type SourceStateFilter,
  type StoredProcessingStatus,
} from "@/lib/importSources";
import type { SegmentMode } from "@/lib/qualCoding";
import type {
  InterviewStyle,
  SetupSuggestion,
  TranscriptSetup,
} from "@/lib/transcriptSetup";
import OpenFileButton from "./OpenFileButton";
import { Pane } from "./ThreePane";

export const SESSION_LABEL = {
  individual: "One person at a time (individual interviews)",
  focus_group: "Several people together (focus groups)",
};

export const STYLE_LABEL: Record<InterviewStyle, string> = {
  unstructured: "Unstructured (open conversation, no fixed guide)",
  semi_structured: "Semi-structured (a guide, with room to follow up)",
  structured: "Structured (same questions in the same order)",
};

export const MODE_LABEL: Record<SegmentMode, string> = {
  auto: "Work it out automatically",
  labels: 'Speakers are labelled ("Name: ...")',
  headings: 'Headings mark each respondent ("Interview 1")',
  sessions:
    'Several interviews or groups in one file ("FOCUS GROUP 1: ...", "U01: ...")',
  paragraphs: "Each paragraph is one respondent",
  none: "No structure: unlabelled paragraphs",
};

// The section's body size (text-xs), so a choice never reads larger than its heading (Grant, 2026-10-22).
const select = "w-full rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs text-foreground disabled:opacity-60";
const FIELDS = "grid grid-cols-1 gap-4 @2xl:grid-cols-2";

type FilePreview =
  | {
      kind: "tables";
      tables: {
        label: string;
        headers: string[];
        totalColumns: number;
        rows: Record<string, string | number | null>[];
        totalRows: number;
      }[];
    }
  | { kind: "text"; excerpt: string; length: number };

/** One tab of the selected source after Preview and Setup, prepared on the server (Variables, Data quality, ...). */
export type SourcePanel = {
  id: string;
  label: string;
  node: ReactNode;
  /** A count beside the tab's name (flagged checks, links to confirm), with what it counts. */
  badge?: { text: string; title: string };
};

export type SourceRow = {
  documentId: string;
  /** The project, for opening the stored file (OpenFileButton). */
  runId: string;
  filename: string;
  kind: string;
  kindLabel: string;
  /** Absent for a statistical output set, which has no single upload time. */
  uploadedAt?: string;
  // Raw case-level data files get their own set-up choices.
  isRawData: boolean;
  dataSetup: DataSetup | null;
  // What was actually read from the file, for checking the import.
  preview: FilePreview | null;
  /** documents.processing_status: a stored failed or partial read. */
  processingStatus: StoredProcessingStatus;
  /** Questionnaires and guides: their questions have been read. */
  instrumentRead?: boolean;
  /** The stored preview's identity could not be verified; its Preview tab says why. */
  previewUnverified?: boolean;
  /** Questionnaires and guides that belong to this file, named in the list (each also has its own row). */
  linked?: { documentId: string; filename: string }[];
  /** For a questionnaire or guide: the file it is linked to, named in the list. */
  linkedTo?: string | null;
  /** One line on what the app does with this file, under its name in the header. */
  purposeText?: string;
  /** The file's next step (Open Crosstabs and Open Analytics, Open Coding, ...), beside View original. */
  nextStep?: ReactNode;
  /** The file's colour bar (a border-l class), matching its card under Analysis, as the earlier cards had. */
  accent?: string;
  /** Work this source starts by itself on Import, whichever source is selected (a questionnaire's first read). */
  autoWork?: ReactNode;
  /** Quantitative, qualitative or context (importSources.sourceGroup), for the type filter's groups. */
  typeGroup?: SourceGroup;
  /** The tabs after Preview and Setup, in order. */
  panels: SourcePanel[];
  initial: TranscriptSetup | null;
  /** Transcripts: migration 0107 is applied, so the wave and Undo accept can be saved. */
  waveAvailable?: boolean;
  suggestion: SetupSuggestion | null;
  hasCoding: boolean;
  /** Absent where the source is removed from inside its own tab (a statistical output set). */
  deleteAction?: () => Promise<void>;
  /** GT-010: the delete confirmation for this file, naming what goes with it. */
  deleteConfirm?: string;
};

type Choice = {
  sessionType: "individual" | "focus_group" | "";
  mode: SegmentMode;
  style: InterviewStyle | "";
};

const SETUP_EVENT = "transcript-setup-saved";

type Row = SourceRow;

const hasSetup = (r: Row) => r.isRawData || r.kind === "transcript";

/** A setup form's live state, reported up so the list and the header show it without a reload. */
type SetupReport = { acceptance: AcceptanceState; wave: string | null; readError?: string | null };

const FileDetailContext = createContext<{
  selectedId: string | null;
  select: (id: string) => void;
  rows: Row[];
  tab: string;
  setTab: (tab: string) => void;
  reports: Record<string, SetupReport>;
  report: (documentId: string, r: SetupReport) => void;
}>({ selectedId: null, select: () => {}, rows: [], tab: "preview", setTab: () => {}, reports: {}, report: () => {} });

/**
 * Holds the project's sources (prepared on the server), which one is selected, its open tab and each
 * setup form's live state, shared by the list and the detail. The sources come in as a prop, so the
 * first (server) render already has the list and the selected source; the first source is selected
 * until another is chosen, and again if the chosen one is deleted.
 */
export function ImportDetailProvider({ rows, children }: { rows: Row[]; children: ReactNode }) {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [tab, setTab] = useState("preview");
  const [reports, setReports] = useState<Record<string, SetupReport>>({});
  const report = useCallback((documentId: string, r: SetupReport) => {
    setReports((all) => {
      const was = all[documentId];
      return was && was.acceptance === r.acceptance && was.wave === r.wave && (was.readError ?? null) === (r.readError ?? null) ? all : { ...all, [documentId]: r };
    });
  }, []);
  const selectedId = rows.some((r) => r.documentId === chosenId) ? chosenId : (rows[0]?.documentId ?? null);
  return (
    <FileDetailContext.Provider value={{ selectedId, select: setChosenId, rows, tab, setTab, reports, report }}>
      {children}
    </FileDetailContext.Provider>
  );
}

/** Selects a source in the Import list, as clicking its row does (used to jump from a data file to its questionnaire). */
export function useSelectImportFile(): (documentId: string) => void {
  return useContext(FileDetailContext).select;
}

function useReportSetup(documentId: string, acceptance: AcceptanceState, wave: string | null, readError: string | null = null) {
  const { report } = useContext(FileDetailContext);
  useEffect(() => report(documentId, { acceptance, wave, readError }), [report, documentId, acceptance, wave, readError]);
}

/** The acceptance shown before a setup form has reported (and for files with no setup step). */
function initialAcceptance(r: Row): AcceptanceState {
  if (r.isRawData) return r.dataSetup?.accepted === false ? "needs_review" : r.dataSetup ? "accepted" : "saving";
  if (r.kind === "transcript") return r.initial?.confirmed ? "accepted" : r.initial?.withdrawn ? "needs_review" : "saving";
  return "none";
}

function sourceStateOf(r: Row, reported: SetupReport | undefined) {
  const acceptance = hasSetup(r) ? (reported?.acceptance ?? initialAcceptance(r)) : "none";
  const wave = reported ? reported.wave : r.isRawData ? (r.dataSetup?.wave ?? null) : r.kind === "transcript" ? (r.initial?.wave ?? null) : null;
  // A read that failed just now, in this page (the setup form's read on import), is a failed read
  // even before the stored status catches up.
  const processing: ProcessingState = reported?.readError
    ? "failed"
    : processingState({
        kind: r.kind,
        processingStatus: r.processingStatus,
        preview: r.preview ? (r.preview.kind === "tables" ? { kind: "tables", count: r.preview.tables.length } : { kind: "text", length: r.preview.length }) : null,
        instrumentRead: r.instrumentRead,
      });
  return { acceptance, wave, processing, previewUnverified: r.previewUnverified ?? false, readError: reported?.readError ?? null };
}

function useSourceState(r: Row) {
  const { reports } = useContext(FileDetailContext);
  return sourceStateOf(r, reports[r.documentId]);
}

/** Whether the list's search and filters keep a source. */
function keptByFilters(r: Row, s: ReturnType<typeof sourceStateOf>, needle: string, role: string, state: SourceStateFilter) {
  return matchesSearch(needle, { filename: r.filename, wave: s.wave }) && matchesTypeFilter(role, { kindLabel: r.kindLabel, group: r.typeGroup ?? "context" }) && matchesStateFilter(state, s);
}

const TONE = {
  plain: "bg-slate-100 text-slate-600",
  green: "bg-green-50 text-green-700",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
  blue: "bg-sky-50 text-sky-800",
};
function Chip({ tone, children, testId }: { tone: keyof typeof TONE; children: ReactNode; testId?: string }) {
  return (
    <span data-testid={testId} className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}
const processingTone = (p: ProcessingState): keyof typeof TONE => (p === "failed" ? "red" : p === "partly_read" ? "amber" : p === "reading" ? "blue" : "plain");
const acceptanceTone = (a: AcceptanceState): keyof typeof TONE => (a === "accepted" ? "green" : a === "needs_review" ? "amber" : "plain");

// ---------------------------------------------------------------- the selected source

function tabsFor(r: Row): { id: string; label: string; badge?: SourcePanel["badge"] }[] {
  const tabs: { id: string; label: string; badge?: SourcePanel["badge"] }[] = [];
  if (r.preview) tabs.push({ id: "preview", label: "Preview" });
  if (hasSetup(r)) tabs.push({ id: "setup", label: "Setup" });
  for (const p of r.panels) tabs.push({ id: p.id, label: p.label, badge: p.badge });
  return tabs;
}

/**
 * The right-hand pane (Grant, 2026-10-20, from his Sources prototype): the selected source's name,
 * type, upload date and wave, its processing and setup states, View original and its next step, then
 * one tab per part of the file (Preview, Setup, Variables, Data quality, Questionnaire links, ...),
 * as its type has them. The open tab is kept when another source is selected, where that source has it.
 *
 * Every raw data file's and transcript's setup form is rendered here, hidden unless it is the
 * selected source's open Setup tab: the forms save on import and read the file on import, and keep an
 * edit in progress, so they cannot wait for their tab to be opened. The selected source's other tabs
 * are all mounted (hidden when not open), as its stacked blocks were before.
 */
export function SelectedFileDetail() {
  const { selectedId, rows, tab, setTab } = useContext(FileDetailContext);
  const row = rows.find((r) => r.documentId === selectedId) ?? null;
  const setupRows = rows.filter(hasSetup);
  const tabs = row ? tabsFor(row) : [];
  const active = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? null);
  return (
    <div className="@container flex flex-col">
      {row ? <SourceHeader row={row} /> : <p className="p-5 text-sm text-muted">Select a source in the list to see what was read, its setup and its data quality.</p>}
      {row && tabs.length > 0 && (
        <div role="tablist" aria-label="Parts of the selected source" className="flex flex-wrap gap-x-6 border-b border-border px-5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`source-tab-${t.id}`}
              aria-selected={active === t.id}
              onClick={() => setTab(t.id)}
              title={t.badge?.title}
              aria-describedby={t.badge ? `source-tab-${t.id}-count` : undefined}
              className={`-mb-px flex items-center gap-1.5 border-b-2 py-2.5 text-sm font-medium ${active === t.id ? "border-primary text-primary" : "border-transparent text-muted hover:text-foreground"}`}
            >
              {t.label}
              {/* Hidden from the tab's name, so "Data quality" stays its name; given as its description instead. */}
              {t.badge && (
                <span id={`source-tab-${t.id}-count`} aria-hidden="true" className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800" data-testid="source-tab-count">
                  {t.badge.text}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {/* Each source's own start-up work (InstrumentAutoRead), for every source, not only the selected one. */}
      <div className="hidden">
        {rows.map((r) => (r.autoWork ? <span key={r.documentId}>{r.autoWork}</span> : null))}
      </div>
      <div className="p-5">
        {row?.preview && (
          <div role="tabpanel" aria-labelledby="source-tab-preview" className={active === "preview" ? "" : "hidden"}>
            <PreviewPanel preview={row.preview} docKind={row.kind} />
          </div>
        )}
        <div role="tabpanel" aria-labelledby="source-tab-setup" className={row && active === "setup" ? "" : "hidden"}>
          {setupRows.map((r) => (
            <div key={r.documentId} className={r.documentId === row?.documentId ? "" : "hidden"}>
              {r.kind === "transcript" ? <TranscriptSetupForm runId={r.runId} row={r} /> : <DataSetupForm runId={r.runId} row={r} />}
            </div>
          ))}
        </div>
        {row?.panels.map((p) => (
          <div key={`${row.documentId}:${p.id}`} role="tabpanel" aria-labelledby={`source-tab-${p.id}`} className={active === p.id ? "flex flex-col gap-3" : "hidden"}>
            {p.node}
          </div>
        ))}
        {row && tabs.length === 0 && <p className="text-sm text-muted">Nothing to show for this file yet.</p>}
      </div>
    </div>
  );
}

function SourceHeader({ row }: { row: Row }) {
  const s = useSourceState(row);
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-4 pt-5" data-testid="selected-source">
      <div className="min-w-0">
        {/* Label, name, then type, date, wave and what the file is for, each on one line (Grant,
            2026-10-22: five lines were taking the space of three). */}
        <h3 className="flex flex-wrap items-baseline gap-x-2 break-words text-lg font-semibold text-foreground">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Selected source</span>
          <span className="min-w-0 break-words">{row.filename}</span>
        </h3>
        <p className="mt-0.5 flex max-w-3xl flex-wrap gap-x-3 text-xs text-muted">
          <span className="font-medium text-foreground">{row.kindLabel}</span>
          {row.uploadedAt && <span title={displayUtcMinute(row.uploadedAt)}>{`Uploaded ${displayDay(row.uploadedAt)}`}</span>}
          {s.wave && <span>{`Wave: ${s.wave}`}</span>}
          {row.purposeText && <span data-testid="file-purpose-text">{row.purposeText}</span>}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip tone={processingTone(s.processing)} testId="source-processing">{`Processing: ${PROCESSING_LABEL[s.processing]}`}</Chip>
          <Chip tone={acceptanceTone(s.acceptance)} testId="source-acceptance">
            {s.acceptance === "none" ? ACCEPTANCE_LABEL.none : `Setup: ${ACCEPTANCE_LABEL[s.acceptance]}`}
          </Chip>
          {s.previewUnverified && <Chip tone="amber">Preview not verified</Chip>}
        </div>
        {s.readError && (
          <p role="alert" className="mt-2 max-w-2xl rounded-lg border border-danger bg-danger-light px-3 py-2 text-xs text-danger">
            {`Could not read this file: ${s.readError}`}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2" data-testid="file-purpose">
        {row.kind !== "output" && (
          <OpenFileButton
            runId={row.runId}
            documentId={row.documentId}
            filename={row.filename}
            label="View original"
            mode="download"
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-foreground hover:border-slate-400 disabled:opacity-50"
          />
        )}
        {row.nextStep}
      </div>
    </div>
  );
}

function PreviewPanel({ preview, docKind }: { preview: FilePreview; docKind?: string }) {
  if (preview.kind === "text") {
    return (
      <div className="flex flex-col gap-2 text-xs">
        <h4 className="text-sm font-semibold text-foreground">Preview imported file</h4>
        {preview.length === 0 ? (
          docKind === "evidence" ? (
            <p className="text-muted">The text of this context file has not been read yet. It is read when you process the project.</p>
          ) : (
            <p className="text-danger">No text was read from this file. It may be a scan or an unsupported layout.</p>
          )
        ) : (
          <>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-slate-50 p-3 text-xs text-foreground">
              {preview.excerpt}
            </pre>
            <p className="text-[11px] text-muted">
              Showing the first {Math.min(preview.excerpt.length, preview.length).toLocaleString()} of {preview.length.toLocaleString()} characters, as extracted from the file.
            </p>
          </>
        )}
      </div>
    );
  }
  if (preview.tables.length === 0) {
    return (
      <p className="text-xs text-muted">
        Reading the file now. A large file can take a minute. If nothing appears, it could not be read (check the Tracking panel for the reason).
      </p>
    );
  }
  const first = preview.tables[0];
  return (
    <div className="flex flex-col gap-3 text-xs">
      <h4 className="text-sm font-semibold text-foreground">Preview imported file</h4>
      <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
        {[
          [first.totalRows.toLocaleString(), preview.tables.length > 1 ? "Rows in the first table" : "Rows"],
          [first.totalColumns.toLocaleString(), "Columns"],
          [preview.tables.length.toLocaleString(), preview.tables.length === 1 ? "Table" : "Tables"],
        ].map(([n, l]) => (
          <div key={l} className="border-b border-border pb-2">
            <p className="text-lg font-semibold text-foreground">{n}</p>
            <p className="text-[11px] text-muted">{l}</p>
          </div>
        ))}
      </div>
      {preview.tables.map((t, i) => (
        <div key={i}>
          <p className="mb-1 text-[11px] font-medium text-foreground">
            {t.label}: {t.totalRows.toLocaleString()} rows, {t.totalColumns} columns
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-slate-50">
                <tr className="border-b border-border">
                  {t.headers.map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-border last:border-0">
                    {t.headers.map((h) => (
                      <td key={h} className="whitespace-nowrap px-3 py-2 text-foreground">
                        {row[h] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-muted">
            Showing the first {t.rows.length} of {t.totalRows.toLocaleString()} rows
            {t.totalColumns > t.headers.length ? ` and ${t.headers.length} of ${t.totalColumns} columns` : ""}, as stored.
          </p>
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

// Shown while the page is still loading and the set-up controls are held (see useHydrated).
function LoadingHint({ ready }: { ready: boolean }) {
  if (ready) return null;
  return (
    <p className="text-[11px] text-muted" data-testid="setup-loading">
      Loading. The set-up options can be changed in a moment.
    </p>
  );
}

// A raw case-level data file's Setup tab: what a case is, how the file is laid out and how the data
// was collected. Defaults apply until changed, so nothing blocks the run; changing the layout takes
// effect the next time the file is read. Rendered for every raw file whether or not its tab is open
// (SelectedFileDetail), so the read-on-import and accept-on-import steps below run as soon as the
// Import screen opens, and an edit survives switching files.
function DataSetupForm({ runId, row }: { runId: string; row: Row }) {
  const [choice, setChoice] = useState<DataSetup>(row.dataSetup ?? DEFAULT_DATA_SETUP);
  const [waveText, setWaveText] = useState(row.dataSetup?.wave ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [layoutChanged, setLayoutChanged] = useState(false);
  const [autoAccepted, setAutoAccepted] = useState(false);
  const router = useRouter();
  const autoRan = useRef(false);
  const readRan = useRef(false);
  const [readError, setReadError] = useState<string | null>(null);
  // Held until React is attached: a change made before that is never saved (see useHydrated).
  const ready = useHydrated();

  // A data file is read into its table on import, so the preview and the data
  // quality appear without another step.
  const unread = row.isRawData && row.preview?.kind === "tables" && row.preview.tables.length === 0;
  useEffect(() => {
    if (!unread || readRan.current) return;
    readRan.current = true;
    void readDataFileAction(runId, row.documentId).then((r) => {
      if (r.ok) router.refresh();
      else setReadError(r.error);
    });
  }, [unread, runId, row.documentId, router]);

  // A file nobody has set up yet is accepted on import with the defaults.
  // The quality panel stays open to review; changing the structure below asks
  // for acceptance again.
  useEffect(() => {
    if (row.dataSetup !== null || autoRan.current) return;
    autoRan.current = true;
    void saveDataSetupAction(runId, row.documentId, { ...DEFAULT_DATA_SETUP, accepted: true }, { kind: "none" }).then((r) => {
      if (r.ok) {
        setChoice({ ...DEFAULT_DATA_SETUP, accepted: true });
        setAutoAccepted(true);
        router.refresh();
      } else if (r.conflict) {
        // A deliberate edit (or another tab) already set this file up since the page
        // loaded - don't let this default-on-first-view save stomp it; just pick up
        // whatever is actually there now.
        router.refresh();
      }
    });
  }, [row.dataSetup, row.documentId, runId, router]);

  // Keep the wave box in step when the saved choice's wave changes (a save, a conflict reload).
  // Adjusted during render when the source value changes, the pattern React recommends over an
  // effect that sets state after rendering; typing in the box still edits waveText alone.
  const [waveSource, setWaveSource] = useState(choice.wave);
  if (choice.wave !== waveSource) {
    setWaveSource(choice.wave);
    setWaveText(choice.wave ?? "");
  }

  // Changing the structure puts the file back to "needs review": what was
  // checked is no longer what will be read.
  async function save(next: DataSetup) {
    const layoutDiffers = next.layout !== choice.layout;
    if (next.unit !== choice.unit || layoutDiffers || next.method !== choice.method) next = { ...next, accepted: false };
    const previous = choice;
    setChoice(next);
    setError(null);
    setPending(true);
    const r = await saveDataSetupAction(runId, row.documentId, next, { kind: "value", setup: previous });
    setPending(false);
    if (r.ok) {
      if (layoutDiffers) {
        // The table was built the old way: read it again with the new layout.
        setLayoutChanged(true);
        const rr = await readDataFileAction(runId, row.documentId);
        if (rr.ok) {
          setLayoutChanged(false);
          router.refresh();
        } else setReadError(rr.error);
      }
    } else if (r.conflict) {
      // This file's set-up changed elsewhere (another save still in flight, or another
      // tab) while this edit was being made. Show what's actually saved rather than the
      // edit that lost the race, so the two don't keep clobbering each other silently.
      setChoice(r.current ?? previous);
      setError("This file's set-up changed elsewhere just now; showing the latest version. Make your change again if it's still needed.");
    } else setError(r.error);
  }

  useReportSetup(row.documentId, pending ? "saving" : choice.accepted ? "accepted" : "needs_review", choice.wave ?? null, readError);

  return (
    <div className="flex flex-col gap-4" data-testid="setup-form">
      <div>
        <h4 className="text-sm font-semibold text-foreground">Data setup</h4>
        <p className="text-xs text-muted">Each change is saved as you make it.</p>
      </div>
      <div className={FIELDS}>
        <Field label="What a case is">
        <select
          aria-label={`What a case is: ${row.filename}`}
          disabled={!ready}
          className={`${select} w-full`}
          value={choice.unit}
          onChange={(e) => void save({ ...choice, unit: e.target.value as DataSetup["unit"] })}
        >
          {Object.entries(UNIT_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        </Field>
        <Field label="File layout">
        <select
          aria-label={`How the file is laid out: ${row.filename}`}
          className={`${select} w-full`}
          value={choice.layout}
          disabled={!ready}
          onChange={(e) => void save({ ...choice, layout: e.target.value as DataSetup["layout"] })}
        >
          {Object.entries(LAYOUT_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        </Field>
        <Field label="How collected">
        <select
          aria-label={`How the data was collected: ${row.filename}`}
          disabled={!ready}
          className={`${select} w-full`}
          value={choice.method}
          onChange={(e) => void save({ ...choice, method: e.target.value as DataSetup["method"] })}
        >
          {Object.entries(METHOD_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        </Field>
        <Field label="Wave (optional)">
          <input
            aria-label={`Wave: ${row.filename}`}
            disabled={!ready}
            className={`${select} w-full`}
            placeholder="e.g. Wave 1, Baseline"
            value={waveText}
            onChange={(e) => setWaveText(e.target.value)}
            onBlur={() => {
              if (waveText.trim() === (choice.wave ?? "")) return;
              void save({ ...choice, wave: waveText.trim() || null });
            }}
          />
          <p className="text-[11px] text-muted">
            Label this file as a tracking wave to compare repeated surveys using the same questionnaire. Open Analytics →
            Wave tracking.
          </p>
        </Field>
      </div>
      <LoadingHint ready={ready} />
      {layoutChanged && !error && (
        <p className="text-[11px] text-muted">
          Layout changed. Reading the file again the new way, then the preview and quality checks update.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <p className="max-w-md text-xs text-muted">
          {choice.accepted
            ? autoAccepted
              ? "Accepted on import. Open Crosstabs to start building tables. If you change the structure above, you will be asked to accept again."
              : "Accepted. Open Crosstabs to start building tables."
            : "The set-up changed. Check the structure, the preview and the data quality, then accept the data again."}
        </p>
        <button
          type="button"
          disabled={pending || !ready}
          onClick={() => void save({ ...choice, accepted: !choice.accepted })}
          className={
            choice.accepted
              ? "rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-slate-400 disabled:opacity-50"
              : "rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          }
        >
          {choice.accepted ? "Undo accept" : "Accept data"}
        </button>
      </div>
      {error && <p className="text-[11px] text-danger">{error}</p>}
      {readError && <p className="text-[11px] text-danger">Could not read this file: {readError}</p>}
    </div>
  );
}

// A transcript's Setup tab, rendered for every transcript like DataSetupForm above.
function TranscriptSetupForm({ runId, row }: { runId: string; row: Row }) {
  const { initial } = row;
  const wasConfirmed = initial?.confirmed ?? false;
  // Undone by the researcher (Undo accept): choices kept and shown, never accepted again by itself.
  const wasWithdrawn = initial?.withdrawn ?? false;
  const [choice, setChoice] = useState<Choice>({
    sessionType: wasConfirmed || wasWithdrawn ? (initial?.sessionType ?? "") : "",
    mode: initial?.mode ?? "auto",
    style: initial?.style ?? "",
  });
  const [confirmed, setConfirmed] = useState(wasConfirmed);
  const [waveText, setWaveText] = useState(initial?.wave ?? "");
  // The wave sent with every save: the last value left in the box, so a dropdown save never
  // drops it and a wave edit never needs its own request shape.
  const savedWave = useRef<string | null>(initial?.wave ?? null);
  // The same value as state, for the header and the list (a ref cannot be read while rendering).
  const [shownWave, setShownWave] = useState<string | null>(initial?.wave ?? null);
  const [changedAfterCoding, setChangedAfterCoding] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Saves go one at a time and the newest choice always wins, so the
  // dropdowns never lock while a save is in flight.
  const saving = useRef(false);
  const queued = useRef<Choice | null>(null);
  // Held until React is attached: a change made before that is never saved (see useHydrated).
  const ready = useHydrated();

  async function flush(next: Choice) {
    if (next.sessionType === "") return;
    if (saving.current) {
      queued.current = next;
      return;
    }
    saving.current = true;
    setPending(true);
    let toSave: Choice | null = next;
    while (toSave && toSave.sessionType !== "") {
      queued.current = null;
      const r = await saveTranscriptSetupAction(runId, row.documentId, {
        sessionType: toSave.sessionType,
        mode: toSave.mode,
        style: toSave.style === "" ? null : toSave.style,
        ...(row.waveAvailable ? { wave: savedWave.current } : {}),
      });
      if (r.ok) {
        setConfirmed(true);
        if (row.hasCoding) setChangedAfterCoding(true);
        window.dispatchEvent(
          new CustomEvent(SETUP_EVENT, {
            detail: {
              documentId: row.documentId,
              sessionType: toSave.sessionType,
              mode: toSave.mode,
            },
          }),
        );
      } else setError(r.error);
      toSave = queued.current;
    }
    saving.current = false;
    setPending(false);
  }

  function save(next: Choice) {
    setChoice(next);
    setError(null);
    void flush(next);
  }

  const sug = row.suggestion;
  // A transcript nobody has set up yet is accepted on import with the app's
  // best reading of it (individual interviews when it cannot tell). The
  // dropdowns stay open to change it.
  const autoRan = useRef(false);
  useEffect(() => {
    if (wasConfirmed || wasWithdrawn || autoRan.current) return;
    autoRan.current = true;
    const first: Choice = {
      sessionType: sug?.sessionType ?? "individual",
      mode: sug?.mode ?? "auto",
      style: "",
    };
    setChoice(first);
    void flush(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const showSuggestion = sug !== null && confirmed && sug.sessionType !== choice.sessionType;

  async function undoAccept() {
    setError(null);
    setPending(true);
    const r = await withdrawTranscriptSetupAction(runId, row.documentId);
    setPending(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setConfirmed(false);
    window.dispatchEvent(new CustomEvent(SETUP_EVENT, { detail: { documentId: row.documentId, withdrawn: true } }));
  }

  function acceptAgain() {
    save({ ...choice, sessionType: choice.sessionType || sug?.sessionType || "individual" });
  }
  const note = error
    ? error
    : changedAfterCoding
      ? "Changed after coding. Run Code themes again for this file so the results match."
      : null;

  useReportSetup(row.documentId, pending ? "saving" : confirmed ? "accepted" : "needs_review", shownWave);

  return (
    <div className="flex flex-col gap-4" data-testid="setup-form">
      <div>
        <h4 className="text-sm font-semibold text-foreground">Before coding</h4>
        <p className="text-xs text-muted">Each change is saved as you make it.</p>
      </div>
      <div className={FIELDS}>
        <Field label="Who is in each session">
        <select
          aria-label={`Who is in each session: ${row.filename}`}
          disabled={!ready}
          className={`${select} w-full`}
          value={choice.sessionType}
          onChange={(e) =>
            save({
              ...choice,
              sessionType: e.target.value as Choice["sessionType"],
            })
          }
        >
          <option value="" disabled>
            Choose...
          </option>
          {Object.entries(SESSION_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        </Field>
        <Field label="File layout">
        <select
          aria-label={`How the file is laid out: ${row.filename}`}
          className={`${select} w-full`}
          value={choice.mode}
          disabled={!ready}
          onChange={(e) =>
            save({ ...choice, mode: e.target.value as SegmentMode })
          }
        >
          {(Object.keys(MODE_LABEL) as SegmentMode[]).map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
        </Field>
        <Field label="Interview style">
        <select
          aria-label={`Interview style: ${row.filename}`}
          className={`${select} w-full`}
          value={choice.style}
          disabled={!ready || initial?.styleAvailable === false}
          onChange={(e) =>
            save({ ...choice, style: e.target.value as InterviewStyle | "" })
          }
        >
          <option value="">Not stated</option>
          {(Object.keys(STYLE_LABEL) as InterviewStyle[]).map((k) => (
            <option key={k} value={k}>
              {STYLE_LABEL[k]}
            </option>
          ))}
        </select>
        </Field>
        <Field label="Wave (optional)">
          <input
            aria-label={`Wave: ${row.filename}`}
            disabled={!ready || row.waveAvailable !== true}
            className={`${select} w-full`}
            placeholder="e.g. Wave 1, Baseline"
            value={waveText}
            onChange={(e) => setWaveText(e.target.value)}
            onBlur={() => {
              const next = waveText.trim() || null;
              if (next === savedWave.current) return;
              savedWave.current = next;
              setShownWave(next);
              save({ ...choice, sessionType: choice.sessionType || sug?.sessionType || "individual" });
            }}
          />
          <p className="text-[11px] text-muted">
            {row.waveAvailable === false
              ? "The wave needs database update 0107 before it can be saved."
              : "Label this transcript as a tracking wave to compare repeated interviews or groups using the same guide. Shown in Coding; themes are not yet compared across waves."}
          </p>
        </Field>
      </div>
      <LoadingHint ready={ready} />
      {showSuggestion && sug && (
        <p className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
          Looks like{" "}
          {sug.sessionType === "focus_group"
            ? "a focus group"
            : "individual interviews"}{" "}
          ({sug.reason}).
          <button
            type="button"
            disabled={!ready}
            onClick={() =>
              save({
                sessionType: sug.sessionType,
                mode: sug.mode,
                style: choice.style,
              })
            }
            className="rounded-md border border-border bg-white px-2 py-0.5 font-medium text-foreground transition hover:border-slate-400 disabled:opacity-50"
          >
            Use this
          </button>
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <p className="max-w-md text-xs text-muted">
          {confirmed
            ? "Accepted. Open Coding to code its themes. If you change the set-up above, run Code themes again for this file."
            : "Not accepted: Coding skips this transcript. Check the set-up above, then accept it."}
        </p>
        <button
          type="button"
          disabled={pending || !ready || (confirmed && row.waveAvailable !== true)}
          title={confirmed && row.waveAvailable !== true ? "Undo accept needs database update 0107" : undefined}
          onClick={() => (confirmed ? void undoAccept() : acceptAgain())}
          className={
            confirmed
              ? "rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-slate-400 disabled:opacity-50"
              : "rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          }
        >
          {confirmed ? "Undo accept" : "Accept transcript"}
        </button>
      </div>
      {note && (
        <p className={`text-[11px] ${error ? "text-danger" : "text-muted"}`}>
          {note}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the source list

/**
 * The left-hand pane (Grant, 2026-10-20, from his Sources prototype): every source in the project,
 * with a search, a type filter (one type, or every quantitative or qualitative file), a state filter
 * and a sort (newest, oldest, type, name), each row showing the file's type, its processing
 * and acceptance states, its wave and links, and a menu with View original and Delete. Selecting a row
 * shows it on the right. The filters are a view only: a hidden source keeps its setup and its state.
 */
export default function TranscriptSetupTable({ rolledUp = false }: { rolledUp?: boolean }) {
  const { selectedId, select, rows } = useContext(FileDetailContext);
  const [needle, setNeedle] = useState("");
  const [role, setRole] = useState("all");
  const [state, setState] = useState<SourceStateFilter>("all");
  const [sort, setSort] = useState<SourceSort>("newest");
  const roles = useMemo(() => [...new Set(rows.map((r) => r.kindLabel))], [rows]);
  const ordered = useMemo(() => sortSources(rows, sort), [rows, sort]);
  if (rows.length === 0) return null;
  return (
    <div className="flex min-h-0 flex-col gap-3" data-testid="source-list">
      <div id="source-list-body" className={rolledUp ? "hidden" : "flex min-h-0 flex-col gap-3"}>
      <input
        type="search"
        aria-label="Search sources"
        placeholder="Search sources..."
        value={needle}
        onChange={(e) => setNeedle(e.target.value)}
        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground"
      />
      {/* Type, state and sort on one line (Grant, 2026-10-22). */}
      <div className="grid grid-cols-3 gap-2">
        <select aria-label="Filter by type" value={role} onChange={(e) => setRole(e.target.value)} className="min-w-0 rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-foreground">
          <option value="all">All types</option>
          {/* Grant, 2026-10-20: every quantitative or every qualitative file at once. */}
          {TYPE_GROUP_FILTERS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
          <optgroup label="One type">
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </optgroup>
        </select>
        <select aria-label="Filter by state" value={state} onChange={(e) => setState(e.target.value as SourceStateFilter)} className="min-w-0 rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-foreground">
          {SOURCE_STATE_FILTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <select aria-label="Sort sources" title="Sort sources" value={sort} onChange={(e) => setSort(e.target.value as SourceSort)} className="min-w-0 rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-foreground">
          {SOURCE_SORTS.map((o) => (
            <option key={o.id} value={o.id}>
              {`Sort: ${o.label}`}
            </option>
          ))}
        </select>
      </div>
      <ul className="-mx-4 flex flex-col border-y border-border" aria-label="Sources">
        {ordered.map((r) => (
          <SourceListItem key={r.documentId} row={r} selected={selectedId === r.documentId} onSelect={() => select(r.documentId)} needle={needle} role={role} state={state} />
        ))}
      </ul>
      <EmptyFilterNote rows={rows} needle={needle} role={role} state={state} onClear={() => { setNeedle(""); setRole("all"); setState("all"); }} />
      <p className="text-[11px] text-muted">Processing (was it read) and acceptance (is its setup accepted) are separate states.</p>
      </div>
    </div>
  );
}

/**
 * The Sources pane: its header carries the count and the Roll up control (Grant, 2026-10-22: the
 * control moved up into the header and the second "7 sources" line removed). Rolled up, only the
 * header shows; the search, filters, sort and selection are kept, and are not remembered after a
 * reload.
 */
export function SourcesPane({ count }: { count: number }) {
  const [rolledUp, setRolledUp] = useState(false);
  return (
    <Pane
      side="plain"
      title="Sources"
      badge={<span className="text-xs font-medium text-muted">{`(${count})`}</span>}
      actions={
        count > 0 ? (
          <button
            type="button"
            aria-expanded={!rolledUp}
            aria-controls="source-list-body"
            onClick={() => setRolledUp((v) => !v)}
            className="rounded-md border border-border bg-white px-2 py-0.5 text-[11px] font-medium text-foreground hover:border-slate-400"
            data-testid="source-list-toggle"
          >
            {rolledUp ? "Show sources" : "Roll up"}
          </button>
        ) : null
      }
    >
      <TranscriptSetupTable rolledUp={rolledUp} />
    </Pane>
  );
}

// Each row decides for itself whether the filters keep it, because its acceptance comes from its live
// setup form (useSourceState); the note below counts the same way.
function SourceListItem({ row, selected, onSelect, needle, role, state }: { row: Row; selected: boolean; onSelect: () => void; needle: string; role: string; state: SourceStateFilter }) {
  const s = useSourceState(row);
  const shown = keptByFilters(row, s, needle, role, state);
  // Links always name the file (Grant, 2026-10-22: some rows said "1 linked document", others named
  // it): a data file or transcript names the questionnaire or guide linked to it, with a count of any
  // more; a questionnaire or guide names what it is linked to.
  const linked = row.linked ?? [];
  const links = [
    linked.length > 0 ? `Linked: ${linked[0].filename}${linked.length > 1 ? ` and ${linked.length - 1} more` : ""}` : null,
    row.linkedTo ? `Linked to ${row.linkedTo}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <li
      // Each file keeps its colour bar (the same as its card under Analysis); the selected one is
      // also filled and outlined.
      className={`${shown ? "flex" : "hidden"} items-start gap-2 border-b border-l-4 border-border py-3 pl-3 pr-4 last:border-b-0 ${row.accent ?? "border-l-slate-300"} ${selected ? "bg-primary-light ring-2 ring-inset ring-primary/50" : "hover:bg-slate-50"}`}
      data-testid="source-row"
      data-document-id={row.documentId}
      data-selected={selected ? "true" : "false"}
    >
      <button type="button" onClick={onSelect} aria-pressed={selected} aria-label={`Select ${row.filename}`} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <span aria-hidden="true" className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-white text-[9px] font-bold text-slate-600">
          {fileTag(row.filename, row.kind)}
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className={`break-words text-xs font-semibold ${selected ? "text-primary" : "text-foreground"}`} title={row.filename}>
            {row.filename}
          </span>
          {/* Type, date, wave and links on one line, then the state chips: two lines, not three. */}
          <span className="text-[11px] text-muted">
            {row.kindLabel}
            {row.uploadedAt ? ` · ${displayDay(row.uploadedAt)}` : ""}
            {s.wave ? ` · ${s.wave}` : ""}
            {links && (
              <span className="text-slate-600" data-testid="linked-instrument" title={linked.map((l) => l.filename).join(", ") || undefined}>
                {` · ${links}`}
              </span>
            )}
          </span>
          <span className="flex flex-wrap gap-1">
            <Chip tone={processingTone(s.processing)}>{PROCESSING_LABEL[s.processing]}</Chip>
            <Chip tone={acceptanceTone(s.acceptance)} testId="source-row-acceptance">{ACCEPTANCE_LABEL[s.acceptance]}</Chip>
            {/* Grant, 2026-10-22: "Needs attention" beside "Partly read" said the same thing twice. The
                read chip already says a failed or partial read; the only other cause of attention, an
                unverified preview, gets its own words. The list's Needs attention filter is unchanged. */}
            {s.previewUnverified && <Chip tone="amber">Preview not verified</Chip>}
          </span>
        </span>
      </button>
      <details className="relative shrink-0">
        <summary aria-label={`Actions for ${row.filename}`} className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-md text-muted hover:bg-slate-100 [&::-webkit-details-marker]:hidden">
          ⋯
        </summary>
        <div className="absolute right-0 z-20 mt-1 flex w-44 flex-col gap-1 rounded-lg border border-border bg-white p-2 shadow-lg">
          {row.kind !== "output" && (
            <OpenFileButton
              runId={row.runId}
              documentId={row.documentId}
              filename={row.filename}
              label="View original"
              mode="download"
              className="w-full rounded-md px-2 py-1 text-left text-xs text-foreground hover:bg-slate-50"
            />
          )}
          {row.deleteAction ? (
            <form action={row.deleteAction} className="flex items-center gap-2 px-2 py-1 text-xs text-danger">
              <DeleteDocumentButton confirmMessage={row.deleteConfirm} />
              Delete source
            </form>
          ) : (
            <p className="px-2 py-1 text-[11px] text-muted">Remove the set from its Overview tab.</p>
          )}
        </div>
      </details>
    </li>
  );
}

function EmptyFilterNote({ rows, needle, role, state, onClear }: { rows: Row[]; needle: string; role: string; state: SourceStateFilter; onClear: () => void }) {
  const { reports } = useContext(FileDetailContext);
  if (needle === "" && role === "all" && state === "all") return null;
  // Counted with the same rule SourceListItem uses, so "no matches" never contradicts the rows shown.
  const shown = rows.filter((r) => keptByFilters(r, sourceStateOf(r, reports[r.documentId]), needle, role, state)).length;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted" data-testid="source-filter-note">
      <span>{shown === 0 ? "No sources match. Change the search or the filters." : `Showing ${shown} of ${rows.length}.`}</span>
      <button type="button" onClick={onClear} className="font-medium text-primary underline">
        Clear filters
      </button>
    </div>
  );
}

/**
 * Shows the Code themes button for a file once its setup is confirmed. Listens
 * for the setup grid's saves, so unlocking needs no page reload.
 */
export function CodeGate({
  documentId,
  initialReady,
  initialSummary,
  children,
}: {
  documentId: string;
  initialReady: boolean;
  initialSummary: string | null;
  children: ReactNode;
}) {
  const [summary, setSummary] = useState<string | null>(
    initialReady ? initialSummary : null,
  );
  useEffect(() => {
    function onSaved(e: Event) {
      const d = (e as CustomEvent).detail as {
        documentId: string;
        sessionType?: "individual" | "focus_group";
        mode?: SegmentMode;
        /** Undo accept: coding waits until the transcript is accepted again. */
        withdrawn?: boolean;
      };
      if (d.documentId !== documentId) return;
      if (d.withdrawn) {
        setSummary(null);
        return;
      }
      if (!d.sessionType || !d.mode) return;
      const session = SESSION_LABEL[d.sessionType];
      const mode = MODE_LABEL[d.mode];
      setSummary(session && mode ? `${session}; ${mode}` : "saved");
    }
    window.addEventListener(SETUP_EVENT, onSaved);
    return () => window.removeEventListener(SETUP_EVENT, onSaved);
  }, [documentId]);
  return (
    <>
      <p className="text-[11px] text-muted">
        {summary
          ? `Setup: ${summary}. Change it in Sources, on the transcript's Setup tab.`
          : "Setup needed: choose who is in each session in Sources, on the transcript's Setup tab."}
      </p>
      {summary ? (
        children
      ) : (
        <button
          type="button"
          disabled
          title="Set this transcript up first"
          className="flex w-full cursor-not-allowed items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-500"
        >
          Code themes (set up first)
        </button>
      )}
    </>
  );
}
