/**
 * The Insights report overview (Grant, 2026-10-21): what the deck and the Word report will be built
 * from, and what is holding them back. Pure counting over the rows the run page already loads, so
 * every number is a count of records the Insights or Recommendations section shows. Nothing here
 * changes what the exports do; it reports their existing rules:
 *
 * - The exports use accepted synthesized insights and the accepted recommendations whose insight is
 *   accepted (story/export and story/export-docx routes).
 * - An insight whose support is no longer valid is left out of both exports with the reason, and so
 *   is every recommendation built on it (a recommendation inherits its insight's support). Changed or
 *   not-checked support is included with a qualification.
 * - The saved narrative cites insights by id per pillar. Its support counts use the same rule as the
 *   narrative's own support line (narrativeSupportSummary.summariseNarrativeSupport): a cited insight
 *   that is no longer accepted, or no longer exists, counts as no longer valid.
 *
 * What cannot be established from stored data is reported as not checked: insights and
 * recommendations carry no edited-at time to compare with the narrative's generated_at, and the
 * narrative records no decision statement (decisionContext.ts), so "the narrative is up to date
 * with its inputs" is never claimed. Safe to import in client code.
 */
import { summariseNarrativeSupport } from "./narrativeSupportSummary";
import type { FigureStatus } from "./numberTrace";
import type { InsightSupport, SupportStatus } from "./supportStatusShared";

export type ReadinessInsight = {
  id: string;
  /** Synthesized insights are in use (accepted) until a researcher rejects them. */
  review_status: "accepted" | "rejected";
  support: InsightSupport;
};

export type ReadinessRecommendation = {
  id: string;
  status: "pending" | "accepted" | "rejected";
  synthesized_insight_id: string;
};

export type ReadinessNarrative = {
  /** As stored: the database driver hands a timestamptz to the page as a Date, a JSON path as a string. */
  generated_at: string | Date | null;
  pillars: { insight_ids: string[]; insight_overflow_count: number }[];
};

export type SupportCounts = Record<SupportStatus, number>;

export type ReportReadiness = {
  insights: {
    accepted: number;
    rejected: number;
    /** Support of the accepted insights. */
    support: SupportCounts;
    /** Accepted insights the exports include (all but no longer valid). */
    included: number;
  };
  recommendations: {
    /** Accepted recommendations whose insight is accepted: the ones the exports consider. */
    accepted: number;
    pending: number;
    /** Accepted recommendations whose insight is not accepted; the exports never use them. */
    onUnacceptedInsight: number;
    /** Inherited from each recommendation's insight. */
    support: SupportCounts;
    included: number;
  };
  narrative: null | {
    /** "2026-10-21 08:15 UTC", or null when the stored value is missing or not a date. */
    generatedAt: string | null;
    /** Distinct insights its pillars cite. */
    cited: number;
    /** The same counts the narrative's support line states. */
    support: SupportCounts;
    /** Accepted, still-included insights the narrative does not cite. */
    notCited: number;
    /** Insights the model placed in a pillar beyond the per-pillar cap. */
    overflow: number;
    pillars: number;
  };
  /** The stored figure check of the narrative; null when none is stored or the checks did not load. */
  narrativeFigures: FigureStatus | null;
};

const zero = (): SupportCounts => ({ current: 0, stale: 0, invalid: 0, unknown: 0 });

export function summarizeReportReadiness(
  insights: ReadinessInsight[],
  recommendations: ReadinessRecommendation[],
  narrative: ReadinessNarrative | null,
  narrativeFigures: FigureStatus | null,
): ReportReadiness {
  const byId = new Map(insights.map((i) => [i.id, i]));
  const accepted = insights.filter((i) => i.review_status === "accepted");
  const insightSupport = zero();
  for (const i of accepted) insightSupport[i.support.status] += 1;

  const recSupport = zero();
  let recAccepted = 0;
  let onUnaccepted = 0;
  for (const r of recommendations) {
    if (r.status !== "accepted") continue;
    const anchor = byId.get(r.synthesized_insight_id);
    if (!anchor || anchor.review_status !== "accepted") {
      onUnaccepted += 1;
      continue;
    }
    recAccepted += 1;
    recSupport[anchor.support.status] += 1;
  }

  let narrativeSummary: ReportReadiness["narrative"] = null;
  if (narrative) {
    const pillars = narrative.pillars ?? [];
    const citedIds = pillars.flatMap((p) => p.insight_ids ?? []);
    const distinct = new Set(citedIds);
    // Only accepted insights count as support for the narrative; anything else is missing.
    const supportById = Object.fromEntries(accepted.map((i) => [i.id, i.support]));
    const summary = summariseNarrativeSupport(citedIds, supportById);
    const support = summary ? summary.counts : { ...zero(), current: distinct.size };
    narrativeSummary = {
      generatedAt: formatGeneratedAt(narrative.generated_at),
      cited: distinct.size,
      support,
      notCited: accepted.filter((i) => i.support.status !== "invalid" && !distinct.has(i.id)).length,
      overflow: pillars.reduce((n, p) => n + (p.insight_overflow_count ?? 0), 0),
      pillars: pillars.length,
    };
  }

  return {
    insights: {
      accepted: accepted.length,
      rejected: insights.length - accepted.length,
      support: insightSupport,
      included: accepted.length - insightSupport.invalid,
    },
    recommendations: {
      accepted: recAccepted,
      pending: recommendations.filter((r) => r.status === "pending").length,
      onUnacceptedInsight: onUnaccepted,
      support: recSupport,
      included: recAccepted - recSupport.invalid,
    },
    narrative: narrativeSummary,
    narrativeFigures,
  };
}

/**
 * When the narrative was generated, in one fixed format so the server render and the browser's
 * hydration agree whatever the time zone. Accepts a Date or an ISO string (a timestamptz reaches the
 * page as a Date); a missing or unparseable value says so rather than throwing or inventing a date.
 */
export function formatGeneratedAt(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
