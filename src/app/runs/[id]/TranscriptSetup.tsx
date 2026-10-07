"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { saveTranscriptSetupAction } from "@/lib/codingAnalysisActions";
import type { SegmentMode } from "@/lib/qualCoding";
import type {
  InterviewStyle,
  SetupSuggestion,
  TranscriptSetup,
} from "@/lib/transcriptSetup";

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
  "rounded-md border border-border bg-white px-2 py-1 text-xs text-foreground";

type Row = {
  documentId: string;
  filename: string;
  initial: TranscriptSetup | null;
  suggestion: SetupSuggestion | null;
  hasCoding: boolean;
  accent: { border: string; dot: string };
};

type Choice = {
  sessionType: "individual" | "focus_group" | "";
  mode: SegmentMode;
  style: InterviewStyle | "";
};

const SETUP_EVENT = "transcript-setup-saved";

const GRID =
  "grid items-start gap-x-3 gap-y-1 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,1.2fr)_7rem]";

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
  const showSuggestion = sug !== null && !confirmed;
  const note = error
    ? error
    : changedAfterCoding
      ? "Changed after coding. Run Code themes again for this file so the results match."
      : null;

  return (
    <div
      className={`my-2 space-y-1 rounded-lg border border-l-4 border-border bg-slate-50/40 px-3 py-3 ${row.accent.border}`}
    >
      <div className={GRID}>
        <p
          className="truncate text-xs font-medium text-foreground md:pt-1"
          title={row.filename}
        >
          {row.filename}
        </p>
        <select
          aria-label={`Who is in each session: ${row.filename}`}
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
        <select
          aria-label={`How the file is laid out: ${row.filename}`}
          className={`${select} w-full`}
          value={choice.mode}
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
        <select
          aria-label={`Interview style: ${row.filename}`}
          className={`${select} w-full`}
          value={choice.style}
          disabled={initial?.styleAvailable === false}
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
        <span
          className={`w-fit rounded-full px-2 py-0.5 text-[10px] font-medium md:mt-1 ${
            confirmed
              ? "bg-green-50 text-green-700"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          {pending ? "Saving..." : confirmed ? "Confirmed" : "Setup needed"}
        </span>
      </div>
      {showSuggestion && sug && (
        <p className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
          Looks like{" "}
          {sug.sessionType === "focus_group"
            ? "a focus group"
            : "individual interviews"}{" "}
          ({sug.reason}).
          <button
            type="button"
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
  if (rows.length === 0) return null;
  const waiting = rows.filter((r) => !(r.initial?.confirmed ?? false)).length;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold text-foreground">
          Before coding: transcript setup
        </h2>
        <span className="text-xs text-muted">
          {waiting === 0
            ? "All transcripts are set up."
            : `${waiting} of ${rows.length} still need setup and are skipped until then.`}
        </span>
      </div>
      <div className="rounded-xl border border-border bg-white px-4">
        <div
          className={`${GRID} hidden border-b border-border py-2 text-[11px] font-medium text-muted md:grid`}
        >
          <span>Transcript</span>
          <span>Who is in each session</span>
          <span>How the file is laid out</span>
          <span>Interview style (optional)</span>
          <span>Status</span>
        </div>
        {rows.map((r) => (
          <SetupRow key={r.documentId} runId={runId} row={r} />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        If unsure about the layout, leave it on automatic.
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
