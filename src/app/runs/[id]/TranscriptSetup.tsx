"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { saveTranscriptSetupAction } from "@/lib/codingAnalysisActions";
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
import type { SegmentMode } from "@/lib/qualCoding";
import type {
  InterviewStyle,
  SetupSuggestion,
  TranscriptSetup,
} from "@/lib/transcriptSetup";
import OpenFileButton from "./OpenFileButton";

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

const select =
  "rounded-md border border-border bg-white !px-1.5 !py-0.5 !text-[11px] text-foreground";

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

type Row = {
  documentId: string;
  /** The project, for opening the stored file (OpenFileButton). */
  runId: string;
  filename: string;
  kind: string;
  kindLabel: string;
  kindBadge: string;
  uploadedAt: string;
  // For files that are not transcripts: one line saying what the app does
  // with the file, shown where the transcript set-up choices would be.
  detail: string | null;
  // Raw case-level data files get their own set-up choices.
  isRawData: boolean;
  dataSetup: DataSetup | null;
  // What was actually read from the file, for checking the import.
  preview: FilePreview | null;
  /** Questionnaires and guides that belong to this file, shown above its quality. */
  attached?: ReactNode;
  /** Those questionnaires and guides, named on this file's card. Each also has its own card in the
   *  list (Grant 2026-10-19), and its links and checks show with this file when it is selected. */
  linked?: { documentId: string; filename: string }[];
  /** What this particular file is for and its next step, at the top of the right-hand pane. */
  purpose?: ReactNode;
  // Data quality for the imported table(s), prepared on the server.
  quality?: React.ReactNode;
  initial: TranscriptSetup | null;
  suggestion: SetupSuggestion | null;
  hasCoding: boolean;
  accent: { border: string; dot: string };
  deleteAction: () => Promise<void>;
  /** GT-010: the delete confirmation for this file, naming what goes with it. */
  deleteConfirm?: string;
};

type Choice = {
  sessionType: "individual" | "focus_group" | "";
  mode: SegmentMode;
  style: InterviewStyle | "";
};

const SETUP_EVENT = "transcript-setup-saved";

const CARD =
  "flex h-full flex-col gap-3 rounded-xl border border-l-4 border-border bg-white p-4 shadow-sm";

const FileDetailContext = createContext<{
  selectedId: string | null;
  select: (id: string) => void;
  setRows: (rows: Row[]) => void;
  rows: Row[];
}>({ selectedId: null, select: () => {}, setRows: () => {}, rows: [] });

/** Holds which file is selected in the list so the right-hand pane can show its preview, questionnaire and data quality. */
export function ImportDetailProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  return (
    <FileDetailContext.Provider value={{ selectedId, select: setSelectedId, setRows, rows }}>
      {children}
    </FileDetailContext.Provider>
  );
}

/** The right-hand pane body: everything about the selected file that used to sit inside its card. */
export function SelectedFileDetail() {
  const { selectedId, rows } = useContext(FileDetailContext);
  const row = rows.find((r) => r.documentId === selectedId) ?? null;
  if (!row) {
    return <p className="text-sm text-muted">Select a file in the list to see what was read, its questionnaire and its data quality.</p>;
  }
  return (
    <div className="@container flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-foreground">{row.filename}</p>
          <p className="text-[11px] text-muted">{row.kindLabel}</p>
        </div>
        <OpenFileButton runId={row.runId} documentId={row.documentId} filename={row.filename} />
      </div>
      {row.purpose}
      <PreviewPanel preview={row.preview} docKind={row.kind} />
      {row.attached}
      {row.quality}
      {!row.preview && !row.attached && !row.quality && !row.purpose && (
        <p className="text-sm text-muted">Nothing to preview for this file yet.</p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-[11px] font-medium text-muted">{label}</span>
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

function PreviewPanel({ preview, docKind }: { preview: FilePreview | null; docKind?: string }) {
  if (!preview) return null;
  if (preview.kind === "text") {
    return (
      <details className="rounded-lg border border-border bg-slate-50 p-2 text-xs">
        <summary className="cursor-pointer select-none font-medium text-muted">
          Preview what was read
        </summary>
        {preview.length === 0 ? (
          docKind === "evidence" ? (
            <p className="mt-2 text-[11px] text-muted">
              The text of this context file has not been read yet. It is read when you process the project.
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-danger">
              No text was read from this file. It may be a scan or an unsupported layout.
            </p>
          )
        ) : (
          <>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[11px] text-foreground">
              {preview.excerpt}
            </pre>
            <p className="mt-1 text-[11px] text-muted">
              Showing the first {Math.min(preview.excerpt.length, preview.length).toLocaleString()} of{" "}
              {preview.length.toLocaleString()} characters.
            </p>
          </>
        )}
      </details>
    );
  }
  if (preview.tables.length === 0) {
    return (
      <p className="text-[11px] text-muted">
        Reading the file now. A large file can take a minute. If nothing appears, it could not be read (check the
        Tracking panel for the reason).
      </p>
    );
  }
  return (
    <details className="rounded-lg border border-border bg-slate-50 p-2 text-xs">
      <summary className="cursor-pointer select-none font-medium text-muted">
        Preview what was read{preview.tables.length > 1 ? ` (${preview.tables.length} tables)` : ""}
      </summary>
      <div className="mt-2 space-y-3">
        {preview.tables.map((t, i) => (
          <div key={i}>
            <p className="mb-1 text-[11px] font-medium text-foreground">
              {t.label}: {t.totalRows.toLocaleString()} rows, {t.totalColumns} columns
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[11px]">
                <thead>
                  <tr className="border-b border-border">
                    {t.headers.map((h) => (
                      <th key={h} className="whitespace-nowrap py-1 pr-3 font-semibold text-muted">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.rows.map((row, ri) => (
                    <tr key={ri} className="border-b border-border last:border-0">
                      {t.headers.map((h) => (
                        <td key={h} className="whitespace-nowrap py-1 pr-3 text-foreground">
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
    </details>
  );
}

function CardHeader({ row, status }: { row: Row; status: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <FileCell row={row} />
      <div className="flex shrink-0 items-center gap-2">
        {status}
        <DeleteCell row={row} />
      </div>
    </div>
  );
}

function FileCell({ row }: { row: Row }) {
  return (
    <div className="min-w-0 md:pt-0.5">
      <p className="truncate text-xs font-medium text-foreground" title={row.filename}>
        {row.filename}
      </p>
      <p className="mt-0.5 text-[11px] text-muted">
        <span className={`mr-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${row.kindBadge}`}>
          {row.kindLabel}
        </span>
        <span title={`Uploaded ${displayUtcMinute(row.uploadedAt)}`}>{displayDay(row.uploadedAt)}</span>
        <span className="ml-1.5 align-middle">
          <OpenFileButton runId={row.runId} documentId={row.documentId} filename={row.filename} />
        </span>
      </p>
      {(row.linked ?? []).map((l) => (
        <p key={l.documentId} className="mt-1 truncate text-[11px] text-slate-600" title={`${l.filename}: linked to this file. Select this file to see it.`} data-testid="linked-instrument">
          <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Linked</span>
          {l.filename}
        </p>
      ))}
    </div>
  );
}

function DeleteCell({ row }: { row: Row }) {
  return (
    <form action={row.deleteAction} className="justify-self-end">
      <DeleteDocumentButton confirmMessage={row.deleteConfirm} />
    </form>
  );
}

// A file that needs no set-up choices (report, table, quant data): same row,
// same colour bar, with a line on what the app does with it.
function PlainRow({ row }: { row: Row }) {
  return (
    <div className={`${CARD} ${row.accent.border}`}>
      <CardHeader
        row={row}
        status={
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">Accepted</span>
        }
      />
      <p className="text-[11px] text-muted">{row.detail}</p>
    </div>
  );
}

// A raw case-level data file: what a case is, how the file is laid out and
// how the data was collected. Defaults apply until changed, so nothing blocks
// the run; changing the layout takes effect the next time the file is read.
function DataSetupRow({ runId, row }: { runId: string; row: Row }) {
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

  return (
    <div className={`${CARD} ${row.accent.border}`}>
      <CardHeader
        row={row}
        status={
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${choice.accepted ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}
          >
            {pending ? "Saving..." : choice.accepted ? "Accepted" : "Needs review"}
          </span>
        }
      />
      <div className="flex flex-col gap-2">
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
          <p className="col-span-2 mt-1 text-[10px] text-muted">
            Label this file as one wave of a tracking study (same questionnaire, repeated over time) to compare it with
            other waves from the Analytics tool on this file, under Wave tracking.
          </p>
        </Field>
      </div>
      <LoadingHint ready={ready} />
      {row.detail && <p className="text-[11px] text-muted">{row.detail}</p>}
      {layoutChanged && !error && (
        <p className="text-[11px] text-muted">
          Layout changed. Reading the file again the new way, then the preview and quality checks update.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="max-w-md text-[11px] text-muted">
          {choice.accepted
            ? autoAccepted
              ? "Accepted on import. Open Analysis, Cross tabs to start building tables. If you change the structure above, you will be asked to accept again."
              : "Accepted. Open Analysis, Cross tabs to start building tables."
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

function SetupRow({ runId, row }: { runId: string; row: Row }) {
  const { initial } = row;
  const wasConfirmed = initial?.confirmed ?? false;
  const [choice, setChoice] = useState<Choice>({
    sessionType: wasConfirmed ? (initial?.sessionType ?? "") : "",
    mode: initial?.mode ?? "auto",
    style: initial?.style ?? "",
  });
  const [confirmed, setConfirmed] = useState(wasConfirmed);
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
    if (wasConfirmed || autoRan.current) return;
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
  const note = error
    ? error
    : changedAfterCoding
      ? "Changed after coding. Run Code themes again for this file so the results match."
      : null;

  return (
    <div className={`${CARD} ${row.accent.border}`}>
      <CardHeader
        row={row}
        status={
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              confirmed ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {pending ? "Saving..." : confirmed ? "Accepted" : "Needs review"}
          </span>
        }
      />
      <div className="flex flex-col gap-2">
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
      {note && (
        <p className={`text-[11px] ${error ? "text-danger" : "text-muted"}`}>
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * One grid, in its own panel above the documents, to say what each transcript
 * is before anything is coded. Coding is held back for a transcript until it
 * is set up.
 */
export default function TranscriptSetupTable({
  runId,
  rows,
}: {
  runId: string;
  rows: Row[];
}) {
  const { selectedId, select, setRows } = useContext(FileDetailContext);
  useEffect(() => {
    setRows(rows);
    if (!selectedId && rows.length > 0) select(rows[0].documentId);
  }, [rows, selectedId, select, setRows]);
  if (rows.length === 0) return null;
  const transcriptRows = rows.filter((r) => r.kind === "transcript");
  const waiting = transcriptRows.filter((r) => !(r.initial?.confirmed ?? false)).length;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">
          Your files ({rows.length})
        </h2>
        <span className="text-xs text-muted">
          {transcriptRows.length === 0
            ? ""
            : waiting === 0
              ? "All transcripts are set up."
              : `${waiting} of ${transcriptRows.length} transcripts still need setup and are skipped until then.`}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
        {rows.map((r) => (
          <div
            key={r.documentId}
            onClick={() => select(r.documentId)}
            className={`cursor-pointer rounded-xl ${selectedId === r.documentId ? "ring-2 ring-primary/50" : ""}`}
          >
            {r.kind === "transcript" ? (
              <SetupRow runId={runId} row={r} />
            ) : r.isRawData ? (
              <DataSetupRow runId={runId} row={r} />
            ) : (
              <PlainRow row={r} />
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        The colour bar on each card matches each file&apos;s card under Analysis (Cross tabs, Coding or Reports and decks). For transcripts, if
        unsure about the layout, leave it on automatic.
      </p>
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
        sessionType: "individual" | "focus_group";
        mode: SegmentMode;
      };
      if (d.documentId !== documentId) return;
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
          ? `Setup: ${summary}. Change it under "Before coding" above.`
          : 'Setup needed: choose who is in each session under "Before coding" above.'}
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
