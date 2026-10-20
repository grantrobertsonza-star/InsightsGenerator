// The Import screen's source list (Grant, 2026-10-20, from his Sources prototype): what each file's
// status chips say and which files the list's state filter keeps. Pure rules, shared by the list,
// the selected-source header and their tests.
//
// Processing (was the file read?) and acceptance (has the researcher accepted its setup?) are kept
// as two separate states, because a file can be read and still need review, and a brief or report
// has no acceptance step at all. Neither says anything about the file's research quality.

/** documents.processing_status (migrations 0079 and later); null before 0079 or before processing. */
export type StoredProcessingStatus = "ready" | "incomplete" | "failed" | null;

export type ProcessingState = "read" | "partly_read" | "reading" | "failed" | "not_read";

export type ProcessingFacts = {
  kind: string;
  processingStatus: StoredProcessingStatus;
  /** What the page has of the read: tables stored (with how many), extracted text (with its length), or nothing. */
  preview: { kind: "tables"; count: number } | { kind: "text"; length: number } | null;
  /** Questionnaires and guides: their questions have been read. */
  instrumentRead?: boolean;
};

export const PROCESSING_LABEL: Record<ProcessingState, string> = {
  read: "Read",
  partly_read: "Partly read",
  reading: "Reading",
  failed: "Read failed",
  not_read: "Not read yet",
};

/**
 * Whether a file was read, from the strongest evidence first: a stored failure or partial read
 * outranks anything previewed (the preview may be from an earlier, successful read). After that,
 * what was actually stored decides: a data file with no tables is still being read; a text file
 * with no text was read and gave nothing, which is a failure unless it is a context file that is
 * only read when the project is processed.
 */
export function processingState(f: ProcessingFacts): ProcessingState {
  if (f.processingStatus === "failed") return "failed";
  if (f.processingStatus === "incomplete") return "partly_read";
  if (f.kind === "output") return "read";
  if (f.kind === "instrument") return f.instrumentRead ? "read" : "not_read";
  if (!f.preview) return f.processingStatus === "ready" ? "read" : "not_read";
  if (f.preview.kind === "tables") return f.preview.count > 0 ? "read" : "reading";
  if (f.preview.length > 0) return "read";
  return f.kind === "evidence" ? "not_read" : "failed";
}

export type AcceptanceState = "accepted" | "needs_review" | "saving" | "none";

export const ACCEPTANCE_LABEL: Record<AcceptanceState, string> = {
  accepted: "Accepted",
  needs_review: "Needs review",
  saving: "Saving...",
  none: "No acceptance step",
};

export const SOURCE_STATE_FILTERS = [
  { id: "all", label: "All states" },
  { id: "attention", label: "Needs attention" },
  { id: "accepted", label: "Accepted" },
  { id: "review", label: "Needs review" },
  { id: "processing", label: "Processing" },
  { id: "failed", label: "Read failed" },
] as const;
export type SourceStateFilter = (typeof SOURCE_STATE_FILTERS)[number]["id"];

/**
 * "Needs attention" gathers what a researcher should look at before relying on the file: a failed
 * or partial read, and a preview whose identity could not be verified. A file that only needs its
 * setup accepted is under "Needs review" instead, so the two filters do not hide each other.
 */
export function needsAttention(processing: ProcessingState, previewUnverified: boolean): boolean {
  return processing === "failed" || processing === "partly_read" || previewUnverified;
}

export function matchesStateFilter(
  filter: SourceStateFilter,
  s: { processing: ProcessingState; acceptance: AcceptanceState; previewUnverified: boolean },
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "attention":
      return needsAttention(s.processing, s.previewUnverified);
    case "accepted":
      return s.acceptance === "accepted";
    case "review":
      return s.acceptance === "needs_review";
    case "processing":
      return s.processing === "reading";
    case "failed":
      return s.processing === "failed";
  }
}

/** Search matches the file name and its wave, ignoring case. */
export function matchesSearch(needle: string, s: { filename: string; wave: string | null }): boolean {
  const n = needle.trim().toLowerCase();
  return n === "" || `${s.filename} ${s.wave ?? ""}`.toLowerCase().includes(n);
}

/** The short tag on a file's icon: its extension, or SET for a statistical output set. */
export function fileTag(filename: string, kind: string): string {
  if (kind === "output") return "SET";
  const dot = filename.lastIndexOf(".");
  return dot < 0 || dot === filename.length - 1 ? "FILE" : filename.slice(dot + 1).toUpperCase().slice(0, 4);
}

/**
 * A source's type in the list and its type filter, in the Add files panel's words (uploadPurposes.ts)
 * where the stored kind allows: a stored "table" is raw data or aggregated tables by how it was read.
 * Briefs and proposals are both stored as context ("evidence"); their Research quality roles (recorded
 * at upload, changeable in Research quality) say which. `roles` undefined means the roles could not be
 * read, and a context file with no brief or proposal role is named for both, rather than guessed.
 * A questionnaire or guide is named by its stored type; with none recorded it keeps the joint name.
 */
export function sourceTypeLabel(kind: string, ingestionType: string | null, roles?: readonly string[], instrumentType?: string | null): string {
  switch (kind) {
    case "table":
      return ingestionType === "raw" ? "Raw data" : "Aggregated tables";
    case "transcript":
      return "Qualitative data";
    case "report":
      return "Report";
    case "evidence": {
      const brief = roles?.includes("brief") ?? false;
      const proposal = roles?.includes("proposal") ?? false;
      return brief && proposal ? "Brief and proposal" : brief ? "Brief" : proposal ? "Proposal" : "Brief or proposal";
    }
    case "instrument":
      // Named by the type it was added as (Grant, 2026-10-20: three types in Add files).
      return INSTRUMENT_LABEL[instrumentType ?? ""] ?? "Questionnaire or guide";
    case "output":
      return "Statistical output";
    default:
      return kind;
  }
}

/** How many of a file's checks are flagged Check or Problem (warn or fail), for its tab's count. */
export function flaggedChecks(checks: readonly { status: string }[]): number {
  return checks.filter((c) => c.status === "warn" || c.status === "fail").length;
}

const INSTRUMENT_LABEL: Record<string, string> = { questionnaire: "Questionnaire", interview_guide: "Interview guide", focus_group_guide: "Focus group guide" };
