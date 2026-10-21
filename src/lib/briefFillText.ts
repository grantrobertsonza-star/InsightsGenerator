import type { BriefFill } from "./briefFillRecord";
import { displayDay, displayUtcMinute } from "./displayDate";

/**
 * "Last filled from the proposal X.docx on 21 Oct 2026, 12:20 UTC (3 objectives added)." for Set
 * objectives (briefFillRecord.loadLastBriefFill). Plain and fixed-locale, so a client component can
 * use it without a hydration mismatch.
 */
export function lastFillText(fill: BriefFill): string {
  const doc = (kind: string, d: BriefFill["brief"]) => (d ? `the ${kind} ${d.filename}${d.stillImported ? "" : " (no longer imported)"}` : null);
  const docs = [doc("brief", fill.brief), doc("proposal", fill.proposal)].filter(Boolean).join(" and ");
  const what = [
    fill.objectivesAdded > 0 ? `${fill.objectivesAdded} ${fill.objectivesAdded === 1 ? "objective" : "objectives"} added` : "no new objectives",
    ...(fill.filledBusinessProblem ? ["business problem filled"] : []),
  ].join(", ");
  return `Last filled from ${docs} on ${displayDay(fill.at)}, ${displayUtcMinute(fill.at).slice(11)} (${what}).`;
}

export const LAST_FILL_UNKNOWN = "Could not load which document was last used.";
