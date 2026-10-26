// FND-001 / REP-OUT-001: the support line shown above a stored narrative.
//
// The narrative inherits the worst support status of the distinct insights its pillars cite, so
// the heading stays the strongest warning. The sentence underneath counts each status for what
// it is. "Unknown" means the support could not be checked (for example, an insight drafted before
// support snapshots existed). It is not evidence of a change, so an unknown insight is never
// counted as changed or removed. A cited insight that no longer exists counts as no longer valid.
import {
  SUPPORT_STATUS_LABEL,
  inheritSupport,
  type InsightSupport,
  type SupportStatus,
} from "./supportStatusShared";

export type NarrativeSupportSummary = {
  status: Exclude<SupportStatus, "current">;
  heading: string;
  sentence: string;
  counts: Record<SupportStatus, number>;
  total: number;
  /** The per-status counts in words ("1 is no longer valid and 1 is current"). */
  countsText: string;
};

const MISSING_INSIGHT: InsightSupport = {
  status: "invalid",
  reasons: [{ kind: "no_sources", findingId: null, findingText: null }],
};

// Order is fixed (strongest first) so the sentence reads the same way every time.
const PHRASES: Record<SupportStatus, (n: number) => string> = {
  invalid: (n) => `${n} ${n === 1 ? "is" : "are"} no longer valid`,
  stale: (n) => `${n} ${n === 1 ? "has" : "have"} changed since ${n === 1 ? "it was" : "they were"} drafted`,
  unknown: (n) => `${n} could not be checked for changes`,
  current: (n) => `${n} ${n === 1 ? "is" : "are"} current`,
};
const ORDER: SupportStatus[] = ["invalid", "stale", "unknown", "current"];

function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Null when every cited insight is current (no banner). */
export function summariseNarrativeSupport(
  insightIds: string[],
  supportById: Record<string, InsightSupport | undefined>,
): NarrativeSupportSummary | null {
  const distinct = [...new Set(insightIds)];
  const supports = distinct.map((id) => supportById[id] ?? MISSING_INSIGHT);
  const inherited = inheritSupport(supports);
  if (inherited.status === "current") return null;

  const counts: Record<SupportStatus, number> = { current: 0, stale: 0, invalid: 0, unknown: 0 };
  for (const support of supports) counts[support.status] += 1;

  const parts = ORDER.filter((status) => counts[status] > 0).map((status) => PHRASES[status](counts[status]));
  const noun = distinct.length === 1 ? "insight" : "insights";
  const consequence =
    counts.invalid > 0 || counts.stale > 0
      ? "Exports list or qualify the affected insights; regenerate to update the framing."
      : "Exports note this.";

  return {
    status: inherited.status,
    heading: SUPPORT_STATUS_LABEL[inherited.status],
    sentence: `Of the ${distinct.length} ${noun} this narrative uses, ${joinParts(parts)}. ${consequence}`,
    counts,
    total: distinct.length,
    countsText: joinParts(parts),
  };
}

/**
 * The qualification printed BESIDE the narrative's saved framing (executive summary, governing
 * thought, SCQA answer, the argument map) when the insights it was written from no longer all have
 * current support. The framing itself is shown exactly as it was saved - it is never rewritten
 * here - so the note says what changed and how to update it. Null when every cited insight is
 * current. Uses the same count as the narrative's support line (summariseNarrativeSupport), so the
 * app and both exports state the same numbers.
 */
export function narrativeFramingQualification(
  insightIds: string[],
  supportById: Record<string, InsightSupport | undefined>,
): string | null {
  const summary = summariseNarrativeSupport(insightIds, supportById);
  if (!summary) return null;
  const what =
    summary.status === "unknown"
      ? "could not be checked against the current evidence"
      : "was written before a change to the evidence it rests on";
  return (
    `${summary.heading}: this framing ${what} and is shown as it was generated. ` +
    `Of the ${summary.total} ${summary.total === 1 ? "insight" : "insights"} it uses, ` +
    `${summary.countsText}. ` +
    "Regenerate the report to update it."
  );
}
