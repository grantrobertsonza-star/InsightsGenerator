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
  /** Questionnaires and guides: the latest read failed and no later read finished (InstrumentSummary.readFailure). */
  instrumentReadFailed?: boolean;
};

export const PROCESSING_LABEL: Record<ProcessingState, string> = {
  read: "Read",
  partly_read: "Partly read",
  reading: "Reading",
  failed: "Read failed",
  not_read: "Not read yet",
};

/**
 * What a file's processing state is called on screen. For a transcript, a partial state is about
 * its coding, not its reading (ANA-QUAL-001: at least one coding batch came back without a decision
 * for every passage; the text itself was read in full), so it is called "Coding incomplete" there.
 */
export function processingLabel(state: ProcessingState, kind: string): string {
  return state === "partly_read" && kind === "transcript" ? "Coding incomplete" : PROCESSING_LABEL[state];
}

/** What a transcript with incomplete coding needs, said beside its status. */
export const TRANSCRIPT_CODING_INCOMPLETE_HELP =
  "Some passages of this transcript were not coded, so findings from it may be missing them. Open Coding and run Code themes again for this file.";

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
  // A failed latest read is "Read failed", not "Not read yet": the read ran, and its reason is on the card.
  if (f.kind === "instrument") return f.instrumentReadFailed && !f.instrumentRead ? "failed" : f.instrumentRead ? "read" : "not_read";
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
    case "technical":
      return "Technical document";
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

const INSTRUMENT_LABEL: Record<string, string> = { questionnaire: "Questionnaire", interview_guide: "Interview guide", focus_group_guide: "Focus group guide", codebook: "Codebook" };

// ---------------------------------------------------------------- type groups and sorting

/**
 * Which side of the study a source belongs to, for the type filter's "All quantitative files" and
 * "All qualitative files" (Grant, 2026-10-20). Quantitative: data files, aggregated tables,
 * statistical output, survey questionnaires and codebooks. Qualitative: transcripts and interview or focus
 * group guides. Briefs, proposals and reports are context for either, so they are in neither group.
 * A questionnaire or guide with no recorded type is in neither, rather than guessed.
 */
export type SourceGroup = "quant" | "qual" | "context";
export function sourceGroup(kind: string, instrumentType?: string | null): SourceGroup {
  if (kind === "table" || kind === "output") return "quant";
  if (kind === "transcript") return "qual";
  if (kind === "instrument") return instrumentType === "questionnaire" || instrumentType === "codebook" ? "quant" : instrumentType === "interview_guide" || instrumentType === "focus_group_guide" ? "qual" : "context";
  return "context";
}

export const TYPE_GROUP_FILTERS = [
  { id: "group:quant", label: "All quantitative files" },
  { id: "group:qual", label: "All qualitative files" },
] as const;

/** The type filter: "all", a group ("group:quant", "group:qual"), or one type's label. */
export function matchesTypeFilter(filter: string, s: { kindLabel: string; group: SourceGroup }): boolean {
  if (filter === "all") return true;
  if (filter === "group:quant") return s.group === "quant";
  if (filter === "group:qual") return s.group === "qual";
  return s.kindLabel === filter;
}

export const SOURCE_SORTS = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "type", label: "Type" },
  { id: "name", label: "Name" },
] as const;
export type SourceSort = (typeof SOURCE_SORTS)[number]["id"];

// Types in the Add files panel's order (uploadPurposes.ts), the joint names beside their parts.
const TYPE_ORDER = [
  "Brief",
  "Proposal",
  "Brief and proposal",
  "Brief or proposal",
  "Technical document",
  "Raw data",
  "Aggregated tables",
  "Statistical output",
  "Qualitative data",
  "Report",
  "Questionnaire",
  "Interview guide",
  "Focus group guide",
  "Questionnaire or guide",
];

/**
 * The list in the chosen order. By date, a source with no upload time (a statistical output set)
 * goes last either way. By type, the Add files panel's order, newest first within a type; a type
 * not listed there goes after those that are. By name, alphabetical with numbers in number order
 * ("Wave 2" before "Wave 10"). Ties keep the order the list came in.
 */
export function sortSources<T extends { filename: string; kindLabel: string; uploadedAt?: string }>(rows: readonly T[], order: SourceSort): T[] {
  const time = (r: T) => (r.uploadedAt ? Date.parse(r.uploadedAt) : Number.NaN);
  const byDate = (dir: 1 | -1) => (a: T, b: T) => {
    const ta = time(a);
    const tb = time(b);
    if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.isNaN(ta) === Number.isNaN(tb) ? 0 : Number.isNaN(ta) ? 1 : -1;
    return dir * (ta - tb);
  };
  const rank = (r: T) => {
    const i = TYPE_ORDER.indexOf(r.kindLabel);
    return i < 0 ? TYPE_ORDER.length : i;
  };
  const cmp =
    order === "newest"
      ? byDate(-1)
      : order === "oldest"
        ? byDate(1)
        : order === "type"
          ? (a: T, b: T) => rank(a) - rank(b) || byDate(-1)(a, b)
          : (a: T, b: T) => a.filename.localeCompare(b.filename, "en", { numeric: true, sensitivity: "base" });
  return rows.map((r, i) => [r, i] as const).sort(([a, i], [b, j]) => cmp(a, b) || i - j).map(([r]) => r);
}
