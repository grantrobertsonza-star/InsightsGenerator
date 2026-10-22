import type { BriefFill } from "./briefFillRecord";
import { displayDay, displayUtcMinute } from "./displayDate";

/**
 * "Last filled from the proposal X.docx on 21 Oct 2026, 12:20 UTC (3 objectives added)." for Set
 * objectives (briefFillRecord.loadLastBriefFill). Plain and fixed-locale, so a client component can
 * use it without a hydration mismatch.
 */
export function lastFillText(fill: BriefFill, opts: { previous?: boolean } = {}): string {
  const doc = (kind: string, d: BriefFill["brief"]) => (d ? `the ${kind} ${d.filename}${d.stillImported ? "" : " (no longer imported)"}` : null);
  const docs = [doc("brief", fill.brief), doc("proposal", fill.proposal)].filter(Boolean).join(" and ");
  const what = [
    fill.objectivesAdded > 0 ? `${fill.objectivesAdded} ${fill.objectivesAdded === 1 ? "objective" : "objectives"} added` : "no new objectives",
    ...(fill.importedBefore > 0 ? [`${fill.importedBefore} imported earlier not added again`] : []),
    ...(fill.suggestionsAdded > 0 ? [`${fill.suggestionsAdded} new ${fill.suggestionsAdded === 1 ? "line" : "lines"} suggested for review`] : []),
    ...(fill.filledBusinessProblem ? ["business problem filled"] : []),
  ].join(", ");
  // After a failed fill the record is the previous successful one, and says so (GT500-F02).
  return `${opts.previous ? "The last successful fill was" : "Last filled"} from ${docs} on ${displayDay(fill.at)}, ${displayUtcMinute(fill.at).slice(11)} (${what}).`;
}

export const LAST_FILL_UNKNOWN = "Could not load which document was last used.";

/** What Set objectives says about a requested fill that did not happen (GT500-F02). */
export function failedFillText(failure: { documents: string; reason: string }): string {
  return `The fill from ${failure.documents} did not happen: ${failure.reason.replace(/\.$/, "")}. What you typed was saved. Use Try the fill again, or choose the document again and save.`;
}

/** Shown when the failure could not even be recorded, so a reload will not show it. */
export const FAILED_FILL_NOT_RECORDED = "This failure could not be recorded, so it will not show after a reload.";

export const FAILED_FILL_UNKNOWN = "Could not check whether the last fill from a document succeeded.";

/**
 * Objectives a deliberate re-read of an already used document adds are suggestions waiting on Review
 * (Grant, 2026-10-22), never accepted. Their rationale starts with this prefix, which is how Review
 * recognises them; ordinary fills keep "Added from" (briefFillRecord.sourceLabelFromRationale).
 */
export const REREAD_RATIONALE_PREFIX = "Suggested on re-reading";

export function rereadRationale(brief: string | null, proposal: string | null): string {
  const docs = [brief ? `the brief "${brief}"` : null, proposal ? `the proposal "${proposal}"` : null].filter(Boolean).join(" and ");
  return `${REREAD_RATIONALE_PREFIX} ${docs || "the chosen document"}`;
}

export function isRereadSuggestion(rationale: string | null | undefined): boolean {
  return typeof rationale === "string" && rationale.startsWith(REREAD_RATIONALE_PREFIX);
}

/** What Set objectives says when the chosen document already filled this project (Grant, 2026-10-22). */
export function alreadyFilledText(already: { documents: string; at: string; objectivesFromIt: number }): string {
  const n = already.objectivesFromIt;
  return `Already filled from ${already.documents} on ${displayDay(already.at)}; ${n} ${n === 1 ? "objective" : "objectives"} came from it, so it was not read again and nothing was added. What you typed was saved. To check it for anything new, use Read it again: new lines come in as suggestions on Review objectives.`;
}
