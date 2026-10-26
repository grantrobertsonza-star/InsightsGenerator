// The Recommendations overview counts (Grant, 2026-10-21): every figure is a count of stored fields
// of the rows the review lists, rejected recommendations only under review, unknown support and
// unrecorded decisions never counted as current, and the action plan holds accepted recommendations
// on current support only, high priority first, then the stored quality score.
import { describe, expect, it } from "vitest";
import {
  ACTION_PLAN_FILTER,
  insightsWithoutRecommendationCount,
  recommendationDecisionOf,
  recommendationMatches,
  recommendationsInUseWith,
  summarizeRecommendations,
  type OverviewRecommendation,
  type RecommendationFilter,
} from "../recommendationOverview";

let seq = 0;
const rec = (p: Partial<OverviewRecommendation>): OverviewRecommendation => ({
  id: `r${++seq}`,
  synthesized_insight_headline: "Insight",
  action_text: `Action ${seq}`,
  owner_role: "Owner",
  timeline: "Q1",
  metric: "Metric",
  priority: "medium",
  source: "ai_suggested",
  status: "accepted",
  rec_quality_score: null,
  rec_quality_tier: null,
  support: { status: "current" },
  decision_state: null,
  ...p,
});

describe("summarizeRecommendations", () => {
  it("counts review, priority, quality, support and decisions, with rejected only under review", () => {
    const rows = [
      rec({ priority: "high", rec_quality_tier: "strong", rec_quality_score: 13 }),
      rec({ priority: "low", status: "pending", support: { status: "stale" }, decision_state: "earlier" }),
      rec({ priority: "high", status: "rejected", rec_quality_tier: "strong", support: { status: "invalid" } }),
      rec({ priority: "medium", support: undefined, decision_state: "unknown", rec_quality_tier: "weak" }),
      rec({ source: "researcher_authored", support: { status: "invalid" } }),
    ];
    const o = summarizeRecommendations(rows, []);
    expect(o.total).toBe(5);
    expect(o.inUse).toBe(4);
    expect(o.review).toEqual({ accepted: 3, pending: 1, rejected: 1 });
    expect(o.priority).toEqual({ high: 1, medium: 2, low: 1 });
    expect(o.quality).toEqual({ strong: 1, workable: 0, weak: 1, unscored: 2 });
    // Absent support is "not checked", never current.
    expect(o.support).toEqual({ current: 1, stale: 1, invalid: 1, unknown: 1 });
    expect(o.decision).toEqual({ current: 1, earlier: 1, unknown: 1, researcher: 1 });
    expect(o.attention).toEqual({
      pending: 1,
      supportInvalid: 1,
      supportStale: 1,
      supportUnknown: 1,
      decisionEarlier: 1,
      decisionUnknown: 1,
      insightsWithoutRecommendation: 0,
    });
  });

  it("builds the action plan from accepted recommendations on current support, high priority then quality", () => {
    const highScored = rec({ priority: "high", rec_quality_score: 11, rec_quality_tier: "workable" });
    const highBetter = rec({ priority: "high", rec_quality_score: 14, rec_quality_tier: "strong" });
    const highUnscored = rec({ priority: "high" });
    const low = rec({ priority: "low", rec_quality_score: 15 });
    const pending = rec({ priority: "high", status: "pending", rec_quality_score: 15 });
    const rejected = rec({ priority: "high", status: "rejected", rec_quality_score: 15 });
    const unknown = rec({ priority: "high", support: undefined, rec_quality_score: 15 });
    const stale = rec({ priority: "high", support: { status: "stale" }, rec_quality_score: 15 });
    const o = summarizeRecommendations([low, highScored, pending, highUnscored, rejected, unknown, stale, highBetter], []);
    expect(o.plan.map((r) => r.id)).toEqual([highBetter.id, highScored.id, highUnscored.id, low.id]);
    expect(summarizeRecommendations([low, highScored, highBetter, highUnscored], [], 2).plan).toHaveLength(2);
  });

  it("counts accepted insights with an action plan and no recommendation of any status", () => {
    const parked = [
      { id: "a", action_plan_status: "has_action" as const, has_any_recommendation: false },
      { id: "b", action_plan_status: "has_action" as const, has_any_recommendation: true },
      { id: "c", action_plan_status: "retained_no_action" as const, has_any_recommendation: false },
      // Not known whether it has one (older loader): not counted as missing.
      { id: "d", action_plan_status: "has_action" as const },
    ];
    expect(insightsWithoutRecommendationCount(parked)).toBe(1);
    expect(summarizeRecommendations([rec({})], parked).attention.insightsWithoutRecommendation).toBe(1);
  });

  it("an empty list counts nothing", () => {
    const o = summarizeRecommendations([], []);
    expect(o.total).toBe(0);
    expect(o.inUse).toBe(0);
    expect(o.plan).toEqual([]);
  });
});

describe("recommendationDecisionOf", () => {
  it("follows decisionsWrittenFor: researcher-written first, then earlier, unknown, current", () => {
    expect(recommendationDecisionOf({ source: "researcher_authored", decision_state: "earlier" })).toBe("researcher");
    expect(recommendationDecisionOf({ source: "ai_suggested", decision_state: "earlier" })).toBe("earlier");
    expect(recommendationDecisionOf({ source: "ai_suggested", decision_state: "unknown" })).toBe("unknown");
    expect(recommendationDecisionOf({ source: "ai_suggested", decision_state: null })).toBe("current");
    expect(recommendationDecisionOf({ source: "ai_suggested" })).toBe("current");
  });
});

// Codex OV-01, applied to Recommendations: each figure opens exactly the recommendations it counts.
// A mixed set across review x priority x quality x support x decision; for every figure, the IDs its
// drill-down filter opens are compared with a predicate written independently here.
describe("Recommendations overview drill-downs open exactly what they count", () => {
  const rows: OverviewRecommendation[] = [];
  let n = 0;
  for (const status of ["accepted", "pending", "rejected"] as const)
    for (const priority of ["high", "medium", "low"] as const)
      for (const tier of ["strong", "workable", "weak", null] as const)
        for (const support of ["current", "stale", "invalid", "unknown", undefined] as const)
          for (const [source, decision_state] of [["ai_suggested", null], ["ai_suggested", "earlier"], ["ai_suggested", "unknown"], ["researcher_authored", null]] as const)
            rows.push({
              id: `x${++n}`,
              synthesized_insight_headline: "I",
              action_text: `A${n}`,
              owner_role: "O",
              timeline: "T",
              metric: "M",
              priority,
              source,
              status,
              rec_quality_score: tier ? 10 : null,
              rec_quality_tier: tier,
              support: support ? { status: support } : undefined,
              decision_state,
            });
  const o = summarizeRecommendations(rows, [], 1000);
  const ids = (f: RecommendationFilter) => rows.filter((r) => recommendationMatches(r, f)).map((r) => r.id).sort();
  const expected = (pred: (r: OverviewRecommendation) => boolean) => rows.filter(pred).map((r) => r.id).sort();
  const inUse = (r: OverviewRecommendation) => r.status !== "rejected";
  const supportOf = (r: OverviewRecommendation) => (r.support ? r.support.status : "unknown");
  const decisionOf = (r: OverviewRecommendation) =>
    r.source === "researcher_authored" ? "researcher" : r.decision_state === "earlier" ? "earlier" : r.decision_state === "unknown" ? "unknown" : "current";

  it("review figures: all recommendations of that review state, rejected included under Rejected only", () => {
    for (const st of ["accepted", "pending", "rejected"] as const) {
      expect(ids({ review: st })).toEqual(expected((r) => r.status === st));
      expect(o.review[st]).toBe(expected((r) => r.status === st).length);
    }
  });

  it("in-use figures never open a rejected recommendation, and each count equals its drill-down", () => {
    for (const p of ["high", "medium", "low"] as const) {
      const want = expected((r) => inUse(r) && r.priority === p);
      expect(ids(recommendationsInUseWith({ priority: p }))).toEqual(want);
      expect(o.priority[p]).toBe(want.length);
    }
    for (const q of ["strong", "workable", "weak", "unscored"] as const) {
      const want = expected((r) => inUse(r) && (r.rec_quality_tier ?? "unscored") === q);
      expect(ids(recommendationsInUseWith({ quality: q }))).toEqual(want);
      expect(o.quality[q]).toBe(want.length);
    }
    for (const s of ["current", "stale", "invalid", "unknown"] as const) {
      const want = expected((r) => inUse(r) && supportOf(r) === s);
      expect(ids(recommendationsInUseWith({ support: s }))).toEqual(want);
      expect(o.support[s]).toBe(want.length);
    }
    for (const d of ["current", "earlier", "unknown", "researcher"] as const) {
      const want = expected((r) => inUse(r) && decisionOf(r) === d);
      expect(ids(recommendationsInUseWith({ decision: d }))).toEqual(want);
      expect(o.decision[d]).toBe(want.length);
    }
    expect(o.inUse).toBe(expected(inUse).length);
  });

  it("support not recorded is never current; the attention rows match their drill-downs", () => {
    const noSupport = rows.filter((r) => !r.support).map((r) => r.id);
    for (const id of noSupport) expect(ids(recommendationsInUseWith({ support: "current" }))).not.toContain(id);
    expect(o.attention.supportInvalid).toBe(ids(recommendationsInUseWith({ support: "invalid" })).length);
    expect(o.attention.supportUnknown).toBe(ids(recommendationsInUseWith({ support: "unknown" })).length);
    expect(o.attention.decisionEarlier).toBe(ids(recommendationsInUseWith({ decision: "earlier" })).length);
    expect(o.attention.pending).toBe(ids({ review: "pending" }).length);
  });

  it("the action plan is exactly the accepted recommendations on current support", () => {
    const want = expected((r) => r.status === "accepted" && supportOf(r) === "current");
    expect(ids(ACTION_PLAN_FILTER)).toEqual(want);
    expect(o.planTotal).toBe(want.length);
    expect(o.plan.map((r) => r.id).sort()).toEqual(want);
    expect(summarizeRecommendations(rows, [], 5).plan).toHaveLength(5);
  });
});
