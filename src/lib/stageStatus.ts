// The status block at the top of a stage (Grant, 2026-10-23, prototype on 3001): one plain outcome
// for the stage, with each thing that needs the researcher linked to the exact item, and the
// stage's existing controls rolled up below. Pure rules, one per stage, shared by the block and its
// tests; the detail below keeps its own controls and is unchanged.
//
// Four states, worst first:
// - couldnt_check: something the stage depends on could not be read or verified. It never becomes
//   Ready, because "we do not know" is not "nothing is wrong".
// - needs_you: something only the researcher can do (accept a setup, review a suggestion, fix a
//   failed read).
// - working: the app is still doing something by itself (a file being read).
// - ready: none of the above. Caveats (flagged data checks, objectives that need work, evidence
//   gaps) can still be listed under Ready: they qualify the result, they do not block it.
//
// Every rule reads what the page already loaded; none calls a model or writes anything.

import type { AcceptanceState, ProcessingState } from "./importSources";
import type { CrosstabDatasetState } from "./crosstabEntry";

export type StageState = "ready" | "needs_you" | "working" | "couldnt_check";

/** Where an item's link goes: the exact file and tab, objective, or data file it is about. */
export type StageTarget =
  | { kind: "import_file"; documentId: string; tab?: string }
  | { kind: "objective"; id: string | null; text: string }
  | { kind: "data_file"; documentId: string }
  | { kind: "context_form" }
  /** A module's own page (Findings, Coding, ...), from a section dashboard. */
  | { kind: "section"; id: string }
  | { kind: "none" };

export type StageItem = {
  /** Stable, for React keys and tests: the subject's id and what the item is about. */
  key: string;
  state: Exclude<StageState, "ready"> | "caveat";
  text: string;
  target: StageTarget;
};

export type StageCount = { label: string; n: number; state: StageState };

export type StageStatus = {
  state: StageState;
  headline: string;
  /** Plain counts of the stage's subjects (files, objectives) by state, zero counts left out. */
  counts: StageCount[];
  /** What blocks Ready, worst first. */
  issues: StageItem[];
  /** Material qualifications that stay visible whatever the state. */
  caveats: StageItem[];
};

const ORDER: Exclude<StageState, "ready">[] = ["couldnt_check", "needs_you", "working"];

/** The stage's state: the worst state among its issues, Ready only when there are none. */
export function stageStateOf(issues: readonly StageItem[]): StageState {
  for (const s of ORDER) if (issues.some((i) => i.state === s)) return s;
  return "ready";
}

export function sortIssues(items: StageItem[]): StageItem[] {
  const rank = (s: StageItem["state"]) => (s === "caveat" ? 9 : ORDER.indexOf(s));
  // Stable: items of one state keep the order of their subjects on the page.
  return items.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it.state) - rank(b.it.state) || a.i - b.i).map((x) => x.it);
}

/** Each subject is counted once, under the worst state among its own items. */
function countSubjects(subjects: readonly string[], items: readonly (StageItem & { subject: string })[]): StageCount[] {
  const worst = new Map<string, StageState>();
  for (const s of subjects) worst.set(s, stageStateOf(items.filter((i) => i.subject === s)));
  const labels: Record<StageState, string> = { ready: "ready", needs_you: "need you", working: "in progress", couldnt_check: "could not be checked" };
  const out: StageCount[] = [];
  for (const state of ["ready", ...ORDER] as StageState[]) {
    const n = [...worst.values()].filter((v) => v === state).length;
    if (n > 0) out.push({ state, n, label: state === "ready" ? `${n} ready` : state === "needs_you" && n === 1 ? "1 needs you" : `${n} ${labels[state]}` });
  }
  return out;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- Import

export type ImportFileFacts = {
  documentId: string;
  filename: string;
  kind: string;
  processing: ProcessingState;
  acceptance: AcceptanceState;
  /** Inside a project only: the stored preview's identity could not be verified. */
  previewUnverified?: boolean;
  /** A read that failed in this page just now, with its message. */
  readError: string | null;
  /** Inside a project only: import checks flagged Check or Problem. */
  flaggedChecks?: number;
  /** Questions whose suggested links are waiting for confirmation. */
  linksToCheck: number;
};

export function importStageStatus(input: { files: readonly ImportFileFacts[]; tablesReadFailed: boolean }): StageStatus {
  const { files } = input;
  const items: (StageItem & { subject: string })[] = [];
  const add = (f: ImportFileFacts, what: string, state: StageItem["state"], text: string, tab?: string) =>
    items.push({ subject: f.documentId, key: `${f.documentId}:${what}`, state, text, target: { kind: "import_file", documentId: f.documentId, tab } });

  for (const f of files) {
    const name = f.filename;
    if (f.previewUnverified) add(f, "unverified", "couldnt_check", `Could not verify what was read from ${name}`, "preview");
    if (f.processing === "failed") add(f, "failed", "needs_you", f.readError ? `${name} could not be read: ${f.readError.replace(/\.$/, "")}` : `${name} could not be read`, "preview");
    else if (f.processing === "partly_read") add(f, "partial", "needs_you", `${name} was only partly read`, "preview");
    else if (f.processing === "reading") add(f, "reading", "working", `${name} is still being read`);
    else if (f.processing === "not_read") {
      // A brief, proposal or report is read when the project is processed, so not yet read is normal
      // there. A questionnaire or guide is read by itself on this page. Anything else with nothing
      // read from it cannot be checked, which is said rather than passed as ready.
      if (f.kind === "instrument") add(f, "reading", "working", `The questions in ${name} are being read`);
      else if (f.kind !== "evidence" && f.kind !== "report") add(f, "not_read", "couldnt_check", `Nothing has been read from ${name} yet, so it could not be checked`, "preview");
    }
    if (f.acceptance === "needs_review") add(f, "accept", "needs_you", `Accept the setup of ${name}`, "setup");
    else if (f.acceptance === "saving") add(f, "saving", "working", `The setup of ${name} is being saved`, "setup");
    if (f.linksToCheck > 0) add(f, "links", "needs_you", `Confirm the questionnaire links for ${plural(f.linksToCheck, "question", "questions")} in ${name}`, "links");
    if ((f.flaggedChecks ?? 0) > 0) add(f, "quality", "caveat", `${plural(f.flaggedChecks ?? 0, "data quality check is", "data quality checks are")} flagged in ${name}`, "quality");
  }
  if (input.tablesReadFailed) {
    items.push({ subject: "", key: "tables-read-failed", state: "couldnt_check", text: "The stored tables could not be loaded, so data files were not checked. Reload the page to try again.", target: { kind: "none" } });
  }
  if (files.length === 0) {
    items.push({ subject: "", key: "no-files", state: "needs_you", text: "Add your first file with Add files: a data file, report, brief or transcript.", target: { kind: "none" } });
  }

  const issues = sortIssues(items.filter((i) => i.state !== "caveat"));
  const caveats = items.filter((i) => i.state === "caveat");
  const state = stageStateOf(issues);
  const counts = countSubjects(files.map((f) => f.documentId), items);
  const affected = (s: StageState) => counts.find((c) => c.state === s)?.n ?? 0;
  const total = plural(files.length, "file", "files");
  const headline =
    files.length === 0
      ? "No files yet"
      : state === "ready"
        ? `${total} imported, all ready`
        : state === "couldnt_check"
          ? input.tablesReadFailed
            ? "The files could not all be checked"
            : `${plural(affected("couldnt_check"), "file", "files")} of ${files.length} could not be checked`
          : state === "needs_you"
            ? `${plural(affected("needs_you"), "file needs", "files need")} you`
            : `${plural(affected("working"), "file is", "files are")} still being read`;
  return { state, headline, counts, issues: strip(issues), caveats: strip(caveats) };
}

export function strip(items: (StageItem & { subject?: string })[]): StageItem[] {
  return items.map(({ key, state, text, target }) => ({ key, state, text, target }));
}

// ---------------------------------------------------------------- Objectives

export type ObjectiveFacts = {
  /** objective_candidates.id; null for a stated line not yet recorded as a candidate. */
  id: string | null;
  text: string;
  status: "pending" | "accepted" | "rejected";
  /** Why it has no score (objectiveQualityStatus.unscoredReasonText), or null when scored. */
  unscoredReason: string | null;
  scoreTier: "strong" | "workable" | "weak" | null;
};

export type ObjectiveStageInput = {
  objectives: readonly ObjectiveFacts[];
  /** The record of why objectives are unscored could not be read. */
  qualityStatusFailed: boolean;
  /** The scores table is missing (migration not applied). */
  scoresUnavailable: boolean;
  /** The last fill from a brief or proposal failed, newer than any that worked. */
  failedFill: { documents: string; reason: string } | null;
  /** The record of fills could not be read. */
  fillRecordFailed: boolean;
  /** The evidence check of objectives against findings. */
  coverage: { text: string; status: "resolved" | "partial" | "gap"; degraded: boolean }[];
  /** The last evidence check failed and left no result. */
  coverageError: string | null;
};

export function objectiveStageStatus(input: ObjectiveStageInput): StageStatus {
  const live = input.objectives.filter((o) => o.status !== "rejected");
  const subject = (o: ObjectiveFacts) => o.id ?? `text:${o.text}`;
  const items: (StageItem & { subject: string })[] = [];
  const target = (o: ObjectiveFacts): StageTarget => ({ kind: "objective", id: o.id, text: o.text });
  const short = (t: string) => (t.length > 70 ? `"${t.slice(0, 67).trimEnd()}..."` : `"${t}"`);

  for (const o of live) {
    const s = subject(o);
    if (o.status === "pending") items.push({ subject: s, key: `${s}:review`, state: "needs_you", text: `Review the suggested objective ${short(o.text)}`, target: target(o) });
    else if (o.unscoredReason && !input.scoresUnavailable && !input.qualityStatusFailed)
      items.push({ subject: s, key: `${s}:unscored`, state: "needs_you", text: `${short(o.text)}: ${o.unscoredReason}`, target: target(o) });
    else if (o.unscoredReason) items.push({ subject: s, key: `${s}:unscored`, state: "couldnt_check", text: `${short(o.text)} has no score, and why could not be read`, target: target(o) });
    if (o.status === "accepted" && o.scoreTier === "weak") items.push({ subject: s, key: `${s}:weak`, state: "caveat", text: `${short(o.text)} is scored Needs work`, target: target(o) });
  }
  if (input.scoresUnavailable) items.push({ subject: "", key: "scores-unavailable", state: "couldnt_check", text: "Objective scores cannot be stored yet (a database update is missing), so no objective was scored.", target: { kind: "none" } });
  else if (input.qualityStatusFailed) items.push({ subject: "", key: "status-failed", state: "couldnt_check", text: "Why some objectives are unscored could not be read. Reload the page to try again.", target: { kind: "none" } });
  if (input.fillRecordFailed) items.push({ subject: "", key: "fill-record", state: "couldnt_check", text: "Whether the last fill from a brief or proposal worked could not be read.", target: { kind: "context_form" } });
  else if (input.failedFill)
    items.push({ subject: "", key: "fill-failed", state: "needs_you", text: `Filling in from ${input.failedFill.documents} did not work: ${input.failedFill.reason.replace(/\.$/, "")}`, target: { kind: "context_form" } });
  if (live.length === 0) items.push({ subject: "", key: "none", state: "needs_you", text: "Add the business problem and your objectives, or fill them in from a brief or proposal.", target: { kind: "context_form" } });

  if (input.coverageError) items.push({ subject: "", key: "coverage-error", state: "couldnt_check", text: `The evidence check did not finish: ${input.coverageError.replace(/\.$/, "")}`, target: { kind: "none" } });
  const gaps = input.coverage.filter((c) => c.status === "gap");
  const partial = input.coverage.filter((c) => c.status === "partial");
  for (const c of gaps) items.push({ subject: "", key: `gap:${c.text}`, state: "caveat", text: `The evidence does not yet answer ${short(c.text)}`, target: { kind: "objective", id: null, text: c.text } });
  if (partial.length > 0) items.push({ subject: "", key: "partial", state: "caveat", text: `${plural(partial.length, "objective is", "objectives are")} only partly answered by the evidence`, target: { kind: "none" } });
  if (input.coverage.some((c) => c.degraded)) items.push({ subject: "", key: "degraded", state: "caveat", text: "The evidence check ran while some evidence could not be read; its conclusions may be incomplete.", target: { kind: "none" } });

  const issues = sortIssues(items.filter((i) => i.state !== "caveat"));
  const caveats = items.filter((i) => i.state === "caveat");
  const state = stageStateOf(issues);
  const counts = countSubjects(live.map(subject), items);
  const accepted = live.filter((o) => o.status === "accepted").length;
  const pending = live.length - accepted;
  const headline =
    live.length === 0
      ? "No objectives yet"
      : state === "ready"
        ? `${plural(accepted, "objective", "objectives")} set and scored`
        : state === "couldnt_check"
          ? "The objectives could not all be checked"
          : pending > 0
            ? `${plural(pending, "suggested objective is", "suggested objectives are")} waiting for you`
            : "Some objectives need you";
  return { state, headline, counts, issues: strip(issues), caveats: strip(caveats) };
}

// ---------------------------------------------------------------- Cross tabs

export type CrosstabFileFacts = {
  id: string;
  filename: string;
  state: CrosstabDatasetState;
  draftTables: number;
  committedTables: number;
};

export function crosstabStageStatus(input: { files: readonly CrosstabFileFacts[]; tablesReadFailed: boolean }): StageStatus {
  const items: (StageItem & { subject: string })[] = [];
  const workspace = input.files.filter((f) => f.state !== "aggregated");
  for (const f of workspace) {
    const s = f.id;
    if (f.state === "failed") items.push({ subject: s, key: `${s}:failed`, state: "needs_you", text: `${f.filename} could not be read. Check it in Import data.`, target: { kind: "import_file", documentId: f.id, tab: "preview" } });
    else if (f.state === "needs_setup") items.push({ subject: s, key: `${s}:setup`, state: "needs_you", text: `Accept the setup of ${f.filename} to open it here`, target: { kind: "import_file", documentId: f.id, tab: "setup" } });
    else if (f.state === "unsupported") items.push({ subject: s, key: `${s}:unsupported`, state: "caveat", text: `${f.filename} is in a format Cross tabs cannot open`, target: { kind: "import_file", documentId: f.id } });
    else if (!input.tablesReadFailed && f.draftTables > 0)
      items.push({ subject: s, key: `${s}:drafts`, state: "needs_you", text: `Commit or remove ${plural(f.draftTables, "draft table", "draft tables")} on ${f.filename}; drafts are not findings yet`, target: { kind: "data_file", documentId: f.id } });
  }
  const ready = workspace.filter((f) => f.state === "ready");
  const committed = ready.reduce((n, f) => n + f.committedTables, 0);
  if (input.tablesReadFailed) items.push({ subject: "", key: "tables-read-failed", state: "couldnt_check", text: "The saved tables could not be loaded, so drafts and committed tables could not be counted. Reload the page to try again.", target: { kind: "none" } });
  else if (ready.length > 0 && committed === 0 && !items.some((i) => i.key.endsWith(":drafts")))
    items.push({ subject: "", key: "no-tables", state: "needs_you", text: "Build a table and commit it to turn its comparisons into findings", target: { kind: "data_file", documentId: ready[0].id } });
  if (workspace.length === 0)
    items.push({
      subject: "",
      key: "no-files",
      state: "needs_you",
      text: input.files.length > 0 ? "Only aggregated tables are imported; Cross tabs needs a raw data file. Add one under Import data." : "Add a data file under Import data to build cross tabs.",
      target: { kind: "none" },
    });

  const issues = sortIssues(items.filter((i) => i.state !== "caveat"));
  const caveats = items.filter((i) => i.state === "caveat");
  const state = stageStateOf(issues);
  const counts = countSubjects(workspace.map((f) => f.id), items);
  const headline =
    workspace.length === 0
      ? "No data file to open"
      : state === "ready"
        ? `${plural(committed, "table", "tables")} committed on ${plural(ready.length, "data file", "data files")}`
        : state === "couldnt_check"
          ? "The tables could not be checked"
          : committed === 0 && ready.length > 0 && !issues.some((i) => i.key.endsWith(":drafts") || i.key.endsWith(":setup") || i.key.endsWith(":failed"))
            ? "No tables committed yet"
            : `${plural(issues.length, "thing needs", "things need")} you`;
  return { state, headline, counts, issues: strip(issues), caveats: strip(caveats) };
}
