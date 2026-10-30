/**
 * The overview that opens the Recommendations section (Grant, 2026-10-21: the same "high level
 * first, detail underneath" design as Findings and Insights). Pure counting over the rows the
 * Recommendations review already loads. Every figure is counted with `recommendationMatches` over
 * the filter its click opens, and the Review tab filters with the same function, so a figure opens
 * exactly the recommendations it counted. Nothing here scores,
 * ranks by a new combined score, or changes a record. Safe to import in client code.
 *
 * Support, quality, decision context and review stay separate judgements, as on the review cards:
 * accepting a recommendation does not make the insight behind it current, and a recommendation
 * whose support or decision context is unknown is never counted as current.
 */

export type RecommendationPriority = "high" | "medium" | "low";
export type RecommendationReview = "pending" | "accepted" | "rejected";
export type RecommendationQuality = "strong" | "workable" | "weak";
export type RecommendationSupport = "current" | "stale" | "invalid" | "unknown";
/**
 * How the recommendation relates to the business decisions now accepted, by the decisionContext.ts
 * rule as the review cards and exports state it (recommendationQualification.decisionsWrittenFor):
 * "researcher" for one the researcher wrote (no generated decision context to compare), "current"
 * for a generated one written for the decisions in force, "earlier" when they have changed since,
 * "unknown" when no context was recorded.
 */
export type RecommendationDecision = "current" | "earlier" | "unknown" | "researcher";

export type OverviewRecommendation = {
  id: string;
  synthesized_insight_headline: string;
  action_text: string;
  owner_role: string;
  timeline: string;
  metric: string;
  priority: RecommendationPriority;
  source: "researcher_authored" | "ai_suggested";
  status: RecommendationReview;
  rec_quality_score?: number | null;
  rec_quality_tier?: RecommendationQuality | null;
  /** Inherited from the recommendation's insight (supportStatus.ts); absent means not checked. */
  support?: { status: RecommendationSupport };
  decision_state?: "earlier" | "unknown" | null;
};

/** The parts of an insight in the reserve that the overview counts (SynthesizedRecommendationsReview). */
export type OverviewParkedInsight = {
  id: string;
  action_plan_status: "has_action" | "retained_no_action";
  has_any_recommendation?: boolean;
};

export function recommendationSupportOf(r: Pick<OverviewRecommendation, "support">): RecommendationSupport {
  return r.support?.status ?? "unknown";
}

export function recommendationDecisionOf(r: Pick<OverviewRecommendation, "source" | "decision_state">): RecommendationDecision {
  if (r.source !== "ai_suggested") return "researcher";
  if (r.decision_state === "earlier") return "earlier";
  if (r.decision_state === "unknown") return "unknown";
  return "current";
}

export const RECOMMENDATION_SUPPORT_LABEL: Record<RecommendationSupport, string> = {
  current: "Support current",
  stale: "Support changed",
  invalid: "Support no longer valid",
  unknown: "Support not checked",
};

export const RECOMMENDATION_QUALITY_LABEL: Record<RecommendationQuality, string> = {
  strong: "Strong",
  workable: "Workable",
  weak: "Needs work",
};

export type RecommendationsOverview = {
  total: number;
  review: Record<RecommendationReview, number>;
  /** Counted over recommendations in use (not rejected), so the tiles describe what could reach a report. */
  inUse: number;
  priority: Record<RecommendationPriority, number>;
  quality: Record<RecommendationQuality | "unscored", number>;
  support: Record<RecommendationSupport, number>;
  decision: Record<RecommendationDecision, number>;
  /** Accepted, support current; high priority first, then the stored quality score; at most `limit`. */
  plan: OverviewRecommendation[];
  /** How many recommendations ACTION_PLAN_FILTER matches; `plan` shows the first `limit` of them. */
  planTotal: number;
  attention: {
    pending: number;
    supportInvalid: number;
    supportStale: number;
    supportUnknown: number;
    decisionEarlier: number;
    decisionUnknown: number;
    /** Accepted insights with an action plan but no recommendation of any status (REC-002). */
    insightsWithoutRecommendation: number;
  };
};

/**
 * REC-002: accepted insights the synthesizer gave an action plan but that have no recommendation at
 * all, which is what a partial or failed generation run leaves behind. The one definition, used by
 * the overview and by the review's "Incomplete" notice.
 */
export function insightsWithoutRecommendationCount(parked: OverviewParkedInsight[]): number {
  return parked.filter((p) => p.action_plan_status === "has_action" && p.has_any_recommendation === false).length;
}

/**
 * What the Recommendations review shows. The overview counts each figure with
 * `recommendationMatches` and the filter that figure opens, and the review lists with the same
 * function, so a figure always opens the recommendations it counted (Codex OV-01, applied here as on
 * the Insights overview). `inUse` is the overview's "in use": not rejected, so pending and accepted.
 */
export type RecommendationFilter = {
  review?: RecommendationReview;
  inUse?: boolean;
  priority?: RecommendationPriority;
  quality?: RecommendationQuality | "unscored";
  support?: RecommendationSupport;
  decision?: RecommendationDecision;
};

export const RECOMMENDATION_SUPPORT_STATES: RecommendationSupport[] = ["current", "stale", "invalid", "unknown"];
export const RECOMMENDATION_QUALITY_STATES = ["strong", "workable", "weak", "unscored"] as const;
export const RECOMMENDATION_DECISION_STATES: RecommendationDecision[] = ["current", "earlier", "unknown", "researcher"];
const PRIORITIES: RecommendationPriority[] = ["high", "medium", "low"];

export function recommendationQualityOf(r: Pick<OverviewRecommendation, "rec_quality_tier">): RecommendationQuality | "unscored" {
  return r.rec_quality_tier ?? "unscored";
}

export function recommendationMatches(
  r: Pick<OverviewRecommendation, "status" | "priority" | "rec_quality_tier" | "support" | "source" | "decision_state">,
  f: RecommendationFilter,
): boolean {
  if (f.review && r.status !== f.review) return false;
  if (f.inUse && r.status === "rejected") return false;
  if (f.priority && r.priority !== f.priority) return false;
  if (f.quality && recommendationQualityOf(r) !== f.quality) return false;
  if (f.support && recommendationSupportOf(r) !== f.support) return false;
  if (f.decision && recommendationDecisionOf(r) !== f.decision) return false;
  return true;
}

/** The filter behind each in-use figure of the overview: in use, plus the one state counted. */
export const recommendationsInUseWith = (f: RecommendationFilter): RecommendationFilter => ({ inUse: true, ...f });
/** The action plan: accepted (a reviewed decision to act) and resting on current support. */
export const ACTION_PLAN_FILTER: RecommendationFilter = { review: "accepted", support: "current" };

const PRIORITY_ORDER: Record<RecommendationPriority, number> = { high: 0, medium: 1, low: 2 };

export function summarizeRecommendations(
  recommendations: OverviewRecommendation[],
  parkedInsights: OverviewParkedInsight[],
  limit = 5,
): RecommendationsOverview {
  // Each figure is the number of recommendations its own drill-down filter matches. Rejected ones are
  // out of use: counted under review only, so the other tiles describe what could reach a report.
  const count = (f: RecommendationFilter) => recommendations.filter((r) => recommendationMatches(r, f)).length;
  const byState = <K extends string>(states: readonly K[], key: keyof RecommendationFilter) =>
    Object.fromEntries(states.map((st) => [st, count(recommendationsInUseWith({ [key]: st } as RecommendationFilter))])) as Record<K, number>;
  const review = { pending: count({ review: "pending" }), accepted: count({ review: "accepted" }), rejected: count({ review: "rejected" }) };
  const priority = byState(PRIORITIES, "priority");
  const quality = byState(RECOMMENDATION_QUALITY_STATES, "quality");
  const support = byState(RECOMMENDATION_SUPPORT_STATES, "support");
  const decision = byState(RECOMMENDATION_DECISION_STATES, "decision");
  // Ordered by the stored priority, then the stored quality score (no new combined score); an
  // unscored recommendation is never placed above a scored one of the same priority.
  const planAll = recommendations.filter((r) => recommendationMatches(r, ACTION_PLAN_FILTER));
  const plan = [...planAll]
    .sort(
      (a, b) =>
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
        (b.rec_quality_score ?? -1) - (a.rec_quality_score ?? -1) ||
        a.action_text.localeCompare(b.action_text),
    )
    .slice(0, limit);
  return {
    total: recommendations.length,
    review,
    inUse: count({ inUse: true }),
    priority,
    quality,
    support,
    decision,
    plan,
    planTotal: planAll.length,
    attention: {
      pending: review.pending,
      supportInvalid: support.invalid,
      supportStale: support.stale,
      supportUnknown: support.unknown,
      decisionEarlier: decision.earlier,
      decisionUnknown: decision.unknown,
      insightsWithoutRecommendation: insightsWithoutRecommendationCount(parkedInsights),
    },
  };
}
