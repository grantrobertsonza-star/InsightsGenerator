"use client";

import { useMemo, useState, type ComponentProps, type ReactNode } from "react";
import SynthesizedRecommendationsReview, { type RecommendationsReviewStart } from "./SynthesizedRecommendationsReview";
import { AttentionRow, StatTile, WorkspaceTabs } from "./OverviewTiles";
import {
  ACTION_PLAN_FILTER,
  RECOMMENDATION_QUALITY_LABEL,
  recommendationsInUseWith as inUse,
  summarizeRecommendations,
} from "@/lib/recommendationOverview";

type Tab = "overview" | "review";
type ReviewProps = ComponentProps<typeof SynthesizedRecommendationsReview>;

const PRIORITY_CLASS: Record<string, string> = {
  high: "bg-rose-50 text-rose-700",
  medium: "bg-amber-50 text-amber-800",
  low: "bg-slate-100 text-slate-700",
};
// The schema requires a priority; a value outside it is shown as unset rather than breaking the row.
const priorityLabel = (p: string | null | undefined) => (p ? `${p[0].toUpperCase()}${p.slice(1)} priority` : "Priority not set");

/**
 * The Recommendations section (Grant, 2026-10-21): an overview first, then the existing review
 * screen, as Findings and Insights do. The overview counts the recommendations the Review tab lists
 * (lib/recommendationOverview.summarizeRecommendations): how they were reviewed, their priority, their
 * stored quality, whether the insight behind each still rests on current support, and whether each
 * was written for the business decisions now accepted. These stay separate judgements; no combined
 * score is made. The action plan lists accepted recommendations on current support, high priority
 * first. Every figure opens the Review tab filtered, or with that recommendation selected; the review
 * stays mounted while the overview shows, so an edit in progress is not lost.
 */
export default function RecommendationsWorkspace({
  toolbar,
  ...review
}: Omit<ReviewProps, "request"> & {
  /** The recommendation exports, rendered on the server, above the review. */
  toolbar: ReactNode;
}) {
  const { recommendations, parkedInsights } = review;
  const [tab, setTab] = useState<Tab>("overview");
  const [request, setRequest] = useState<{ start: RecommendationsReviewStart; n: number }>({ start: {}, n: 0 });
  const o = useMemo(() => summarizeRecommendations(recommendations, parkedInsights), [recommendations, parkedInsights]);
  const open = (start: RecommendationsReviewStart) => {
    setRequest((r) => ({ start, n: r.n + 1 }));
    setTab("review");
  };

  // Nothing to summarise yet: the review as it was (it explains what is missing), and no tabs.
  if (recommendations.length === 0) {
    return (
      <div className="flex flex-col gap-4" data-testid="recommendations-workspace">
        {toolbar}
        <SynthesizedRecommendationsReview {...review} />
      </div>
    );
  }

  const a = o.attention;
  const attentionTotal = a.pending + a.supportInvalid + a.supportStale + a.supportUnknown + a.decisionEarlier + a.decisionUnknown + a.insightsWithoutRecommendation;

  return (
    <div className="flex flex-col gap-4" data-testid="recommendations-workspace">
      <WorkspaceTabs
        label="Recommendations views"
        testId="rec-tab"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "review", label: `Recommendations (${recommendations.length})` },
        ]}
      />

      {tab === "overview" && (
        // OV-04: everything shrinks to the workspace, which the sidebar can leave very narrow; long
        // words break rather than push the page sideways.
        <div className="flex min-w-0 flex-col gap-4 rounded-2xl bg-slate-100 p-3 [overflow-wrap:anywhere] sm:p-5" data-testid="recommendations-overview">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr))]">
            <StatTile
              title="Researcher review"
              total={`${o.total} recommendations`}
              headline={o.review.accepted}
              headlineLabel="accepted"
              testId="ro-review"
              segments={[
                { key: "accepted", label: "Accepted", count: o.review.accepted, color: "bg-blue-800", onOpen: () => open({ review: "accepted" }) },
                { key: "pending", label: "Not yet reviewed", count: o.review.pending, color: "bg-blue-300", onOpen: () => open({ review: "pending" }) },
                { key: "rejected", label: "Rejected", count: o.review.rejected, color: "bg-slate-500", onOpen: () => open({ review: "rejected" }) },
              ]}
            />
            <StatTile
              title="Priority"
              total={`${o.inUse} in use`}
              headline={o.priority.high}
              headlineLabel="high priority"
              testId="ro-priority"
              segments={[
                { key: "high", label: "High", count: o.priority.high, color: "bg-rose-700", onOpen: () => open(inUse({ priority: "high" })) },
                { key: "medium", label: "Medium", count: o.priority.medium, color: "bg-amber-400", onOpen: () => open(inUse({ priority: "medium" })) },
                { key: "low", label: "Low", count: o.priority.low, color: "bg-slate-300", onOpen: () => open(inUse({ priority: "low" })) },
              ]}
            />
            <StatTile
              title="Recommendation quality"
              total={`${o.inUse - o.quality.unscored} of ${o.inUse} scored`}
              headline={o.quality.strong}
              headlineLabel="strong"
              testId="ro-quality"
              segments={[
                { key: "strong", label: RECOMMENDATION_QUALITY_LABEL.strong, count: o.quality.strong, color: "bg-blue-800", onOpen: () => open(inUse({ quality: "strong" })) },
                { key: "workable", label: RECOMMENDATION_QUALITY_LABEL.workable, count: o.quality.workable, color: "bg-blue-400", onOpen: () => open(inUse({ quality: "workable" })) },
                { key: "weak", label: RECOMMENDATION_QUALITY_LABEL.weak, count: o.quality.weak, color: "bg-blue-200", onOpen: () => open(inUse({ quality: "weak" })) },
                { key: "unscored", label: "Not scored", count: o.quality.unscored, color: "bg-slate-200", onOpen: () => open(inUse({ quality: "unscored" })) },
              ]}
            />
            <StatTile
              title="Evidence health"
              total="of the insight behind each"
              headline={o.support.current}
              headlineLabel="rest on current support"
              testId="ro-support"
              segments={[
                { key: "current", label: "Current", count: o.support.current, color: "bg-teal-700", onOpen: () => open(inUse({ support: "current" })) },
                { key: "stale", label: "Changed", count: o.support.stale, color: "bg-amber-400", onOpen: () => open(inUse({ support: "stale" })) },
                { key: "invalid", label: "No longer valid", count: o.support.invalid, color: "bg-rose-700", onOpen: () => open(inUse({ support: "invalid" })) },
                { key: "unknown", label: "Not checked", count: o.support.unknown, color: "bg-slate-300", onOpen: () => open(inUse({ support: "unknown" })) },
              ]}
            />
            <StatTile
              title="Business decisions"
              total="what each was written for"
              headline={o.decision.current}
              headlineLabel="written for the current decisions"
              testId="ro-decision"
              segments={[
                { key: "current", label: "Current", count: o.decision.current, color: "bg-teal-700", onOpen: () => open(inUse({ decision: "current" })) },
                { key: "earlier", label: "Earlier decisions", count: o.decision.earlier, color: "bg-amber-400", onOpen: () => open(inUse({ decision: "earlier" })) },
                { key: "unknown", label: "Not recorded", count: o.decision.unknown, color: "bg-slate-300", onOpen: () => open(inUse({ decision: "unknown" })) },
                { key: "researcher", label: "By the researcher", count: o.decision.researcher, color: "bg-blue-200", onOpen: () => open(inUse({ decision: "researcher" })) },
              ]}
            />
          </div>

          <div className="flex flex-wrap gap-4">
            <section className="flex min-w-0 flex-[999_1_min(100%,35rem)] flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" aria-labelledby="ro-plan-h">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="ro-plan-h" className="text-base font-semibold text-foreground">Action plan</h3>
                <span className="text-xs text-slate-600">Accepted, on current support, high priority first</span>
              </div>
              {o.plan.length === 0 ? (
                <p className="text-sm text-slate-600">No accepted recommendation rests on current support yet. Check the ones listed under Needs a decision.</p>
              ) : (
                <ol className="flex flex-col gap-2" data-testid="ro-plan">
                  {o.plan.map((r, n) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => open({ selectedId: r.id })}
                        data-recommendation-id={r.id}
                        className="flex w-full items-start gap-3 rounded-lg border border-slate-200 p-3 text-left hover:border-slate-400"
                      >
                        <span className="text-xl font-bold text-slate-400">{String(n + 1).padStart(2, "0")}</span>
                        {/* The action takes the full width; owner, timing and measure wrap below it. */}
                        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <span className="text-sm font-semibold leading-snug text-foreground">{r.action_text || "Action not written"}</span>
                          {r.synthesized_insight_headline && <span className="line-clamp-2 text-xs text-slate-600">{`From: ${r.synthesized_insight_headline}`}</span>}
                          <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-700">
                            <span><span className="text-slate-500">Owner </span>{r.owner_role || "Not set"}</span>
                            <span><span className="text-slate-500">When </span>{r.timeline || "Not set"}</span>
                            <span className="min-w-0"><span className="text-slate-500">Measure </span>{r.metric || "Not set"}</span>
                          </span>
                          <span className="flex flex-wrap gap-1.5 text-[11px]">
                            <span className={`rounded-full px-2 py-0.5 font-medium ${PRIORITY_CLASS[r.priority ?? ""] ?? "bg-slate-100 text-slate-700"}`}>{priorityLabel(r.priority)}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                              {r.rec_quality_tier ? `${RECOMMENDATION_QUALITY_LABEL[r.rec_quality_tier]}${r.rec_quality_score != null ? ` · ${r.rec_quality_score}` : ""}` : "Not scored"}
                            </span>
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {o.planTotal > o.plan.length && (
                  <button type="button" onClick={() => open(ACTION_PLAN_FILTER)} className="text-sm font-semibold text-primary hover:underline" data-testid="ro-plan-all">
                    {`All ${o.planTotal} in the action plan`}
                  </button>
                )}
                <button type="button" onClick={() => open({})} className="text-sm font-semibold text-primary hover:underline">
                  {`All ${recommendations.length} recommendations`}
                </button>
              </div>
            </section>

            <section className="flex min-w-0 flex-[1_1_min(100%,20rem)] flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" aria-labelledby="ro-attention-h">
              <h3 id="ro-attention-h" className="text-base font-semibold text-foreground">Needs a decision</h3>
              <p className="text-xs text-slate-600">Before anything goes into the report or deck.</p>
              {attentionTotal === 0 ? (
                <p className="text-sm text-slate-600">Every recommendation in use is reviewed, rests on current support and was written for the current decisions.</p>
              ) : (
                <div className="flex flex-col gap-2" data-testid="ro-attention">
                  {a.supportInvalid > 0 && <AttentionRow testId="ro-attention-invalid" tone="rose" count={a.supportInvalid} title="Rest on support that is no longer valid" detail="A finding behind the insight was rejected, or its source changed." onOpen={() => open(inUse({ support: "invalid" }))} />}
                  {a.supportStale > 0 && <AttentionRow testId="ro-attention-stale" tone="amber" count={a.supportStale} title="Support has changed since they were written" onOpen={() => open(inUse({ support: "stale" }))} />}
                  {a.decisionEarlier > 0 && <AttentionRow testId="ro-attention-earlier" tone="amber" count={a.decisionEarlier} title="Written for earlier business decisions" detail="The accepted decisions have changed since." onOpen={() => open(inUse({ decision: "earlier" }))} />}
                  {a.pending > 0 && <AttentionRow testId="ro-attention-pending" tone="orange" count={a.pending} title="Not yet reviewed" onOpen={() => open({ review: "pending" })} />}
                  {a.supportUnknown > 0 && <AttentionRow testId="ro-attention-unknown" tone="slate" count={a.supportUnknown} title="Support could not be checked" onOpen={() => open(inUse({ support: "unknown" }))} />}
                  {a.decisionUnknown > 0 && <AttentionRow testId="ro-attention-decision-unknown" tone="slate" count={a.decisionUnknown} title="Decisions they were written for not recorded" onOpen={() => open(inUse({ decision: "unknown" }))} />}
                  {a.insightsWithoutRecommendation > 0 && (
                    <AttentionRow
                      testId="ro-attention-missing"
                      tone="slate"
                      count={a.insightsWithoutRecommendation}
                      title="Accepted insights with no recommendation yet"
                      detail="Usually part of a generation run that failed. Opens the full list, where the reserve on the right offers to generate them."
                      onOpen={() => open({})}
                    />
                  )}
                </div>
              )}
            </section>
          </div>
          <p className="text-xs text-slate-600">
            Review, priority, quality, support and decisions are separate judgements: accepting a recommendation does not make the insight behind it current, and no combined score is shown.
          </p>
        </div>
      )}

      <div className={tab === "review" ? "flex flex-col gap-4" : "hidden"} role="tabpanel" aria-label="Recommendations">
        {toolbar}
        <SynthesizedRecommendationsReview {...review} request={request} />
      </div>
    </div>
  );
}
