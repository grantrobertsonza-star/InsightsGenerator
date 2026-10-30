"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { Pane, ThreePane } from "./ThreePane";
import {
  acceptSynthesizedInsight,
  rejectSynthesizedInsight,
  deleteSynthesizedInsight,
  checkStability,
} from "@/lib/synthesizedInsightActions";
import { TrashIcon } from "@/components/icons";
import type { InsightSupport } from "@/lib/supportStatusShared";
import { SupportStatusNotice } from "./SupportStatusNotice";
import { FigureCheckFor } from "./FigureCheckNotice";
import InfoDot from "@/components/InfoDot";
import { insightMatches, type CorroborationState, type InsightFilter, type QualityState } from "@/lib/evidenceOverview";

// Matches MIN_CLUSTER_SIZE in src/lib/insightSynthesizer.ts (not imported
// directly -- that file pulls in server-only dependencies this client
// component shouldn't bundle). An insight sitting right at this floor is
// one dropped finding away from losing its evidentiary basis: the cheap,
// automatic first tier of a reproducibility check, per Simoudis's (2015)
// "stable" and "reproducible" insight properties. The more expensive
// second tier, actually re-running synthesis on resamples of the accepted
// findings and checking whether the same insight survives, is a
// separate, on-demand action rather than something this badge can show.
const THIN_EVIDENCE_FLOOR = 2;

// Matches STABILITY_RESAMPLE_COUNT in src/lib/insightSynthesizer.ts (not
// imported for the same client-bundle reason as THIN_EVIDENCE_FLOOR
// above). Display copy only; the actual count lives server-side.
const STABILITY_RESAMPLE_COUNT_LABEL = "5";

type ActionPlanStatus = "has_action" | "retained_no_action";
type ConfidenceTier = "strong" | "moderate" | "exploratory";
type ReviewStatus = "accepted" | "rejected";
type QualityTier = "finding" | "partial" | "qualified";

export type SynthesizedInsightRow = {
  id: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  action_plan_status: ActionPlanStatus;
  triangulation_count: number;
  /** INS-001: distinct independent evidence sources (null = not checked, e.g. before migration
   * 0097). The confidence tier is computed from this, not from triangulation_count. */
  independent_source_count: number | null;
  source_theme_count: number;
  materiality_rationale: string | null;
  confidence_tier: ConfidenceTier | null;
  review_status: ReviewStatus;
  why_score: number | null;
  actionability_score: number | null;
  novelty_score: number | null;
  synthesis_score: number | null;
  evidentiary_score: number | null;
  quality_score: number | null;
  quality_tier: QualityTier | null;
  quality_rationale: string | null;
  // Tier-two reproducibility check (checkRunStability in
  // insightSynthesizer.ts). All three null until a researcher explicitly
  // runs "Check stability"; stays whatever the last run left until the
  // next one. testable is how many resamples had enough of this insight's
  // evidence surviving to test it at all -- a resample that drops too
  // much of a thin insight's membership doesn't count as a failure, it
  // just can't test that insight.
  stability_testable_count: number | null;
  stability_reappeared_count: number | null;
  stability_checked_at: string | null;
  source_headlines: string[];
  /** The findings behind source_headlines, by id (identity for review tools and browser checks). */
  source_finding_ids?: string[];
  // Every synthesized insight is net-new by synthesis: the report never said
  // it. This says how much of it stands on claims the report itself made, so
  // the "new" label never hides what it is built on (see
  // discoveryClassification.ts, summarizeSynthesizedProvenance).
  provenance_caption: string;
  // Report claims this insight directly contradicts. Each is rated not
  // supported for that reason.
  contradicts: { original_text: string; rationale: string }[];
  /** FND-001: whether the evidence this insight was drafted from is still what it was (see
   * supportStatusShared.ts). Separate from review_status: accepting an insight does not make its
   * sources current, and a changed source never edits or rejects the insight by itself. */
  support: InsightSupport;
};


const confidenceTierLabel: Record<ConfidenceTier, string> = {
  strong: "Strong",
  moderate: "Moderate",
  exploratory: "Exploratory",
};

const confidenceTierClass: Record<ConfidenceTier, string> = {
  strong: "bg-success-light text-success",
  moderate: "bg-amber-50 text-amber-700",
  exploratory: "bg-slate-100 text-slate-600",
};

// Describes the thresholds defined once in SQL, insight_confidence_tier() (migration 0097, INS-001;
// sources are keyed per document since 0099, so tables from one data file are one source):
// strong = 3+ independent sources across 2+ themes; moderate = 3+ independent sources, or 2+
// independent sources across 2+ themes; otherwise exploratory. Display copy only, kept here
// rather than imported so this client component doesn't pull in server-only code.
const confidenceTierDefinition: Record<ConfidenceTier, string> = {
  strong:
    "Strong confidence: at least 3 independent evidence sources spanning at least 2 distinct themes. " +
    "Several findings from the same data file (any number of its tables) or the same report count as " +
    "one source. Computed from the " +
    "evidence, not a judgment call the model makes.",
  moderate:
    "Moderate confidence: 3+ independent evidence sources, or 2+ independent sources spanning 2+ themes.",
  exploratory:
    "Exploratory confidence: fewer independent sources than that, for example several findings that all " +
    "come from one data file or one report. Worth watching, but not yet triangulated against independent evidence.",
};

const qualityTierLabel: Record<QualityTier, string> = {
  qualified: "Qualified insight",
  partial: "Partial insight",
  finding: "Finding, not insight",
};

const qualityTierClass: Record<QualityTier, string> = {
  qualified: "bg-indigo-50 text-indigo-700",
  partial: "bg-amber-50 text-amber-700",
  finding: "bg-slate-100 text-slate-600",
};

// Mirrors tierFor() in synthesizedInsightQualityScorer.ts (>=15 of 25 =
// qualified, >=12 = partial, else finding). Same display-copy-only reasoning
// as the confidence tier definitions above.
const qualityTierDefinition: Record<QualityTier, string> = {
  qualified:
    "Qualified insight: scored 15-25 of 25 across five dimensions (why, actionability, novelty, " +
    "synthesis, evidentiary fit). Names a mechanism, implies an action, and stays proportionate to its " +
    "evidence.",
  partial:
    "Partial insight: scored 12-14 of 25. Has some real insight content but is thin on one or more " +
    "dimensions, often novelty (confirms an assumption rather than sharpening it) or proportionality " +
    "(claims more than the evidence supports).",
  finding:
    "Finding, not insight: scored below 12 of 25. Reads as a restated observation rather than a genuine " +
    "insight -- no named mechanism, no clear action, or an unsupported leap from the evidence.",
};

const InsightSelection = createContext<{
  selectedId: string | null;
  select: (id: string) => void;
}>({ selectedId: null, select: () => {} });

/**
 * Shows the output of the findings->insights funnel (insightSynthesizer.ts):
 * a small number of insights built by clustering several pre-insights that
 * triangulate against each other, then reinterpreting the cluster around
 * its underlying tension, rather than the one-per-finding pre-insight list
 * above this section. confidence_tier and triangulation_count are
 * deterministic, computed in code from how many pre-insights and distinct
 * themes fed each one, not asserted by the model.
 *
 * quality_tier/quality_score is the five-dimension judgment call that used
 * to run on pre-insights (see InsightsReview.tsx) and now runs here
 * instead, via synthesizedInsightQualityScorer.ts: it judges whether the
 * synthesized insight is actually a genuine insight (names a mechanism,
 * is actionable, non-obvious, proportionate to its chain of evidence), not
 * just whether its triangulation count is high. The two axes are
 * independent, same as verdict_tier vs quality_tier was for pre-insights:
 * a strong-confidence insight (lots of corroborating pre-insights) can
 * still score "finding, not insight" if it never explains a mechanism or
 * implies an action.
 *
 * Every row arrives already review_status = 'accepted' (same
 * auto-accept-by-default convention decisions, objectives, and
 * recommendations already use): Accept/Reject below just flip that flag in
 * place, and a rejected insight stays visible, dimmed, rather than
 * disappearing, exactly like a rejected recommendation. Delete is the only
 * action that actually removes a row; it snapshots to
 * synthesized_insight_history first (synthesizedInsightArchive.ts), so
 * nothing deleted here is lost without a record, and it frees the
 * insight's member pre-insights to be picked up again by a future
 * synthesis pass.
 *
 * A pre-insight that never gets pulled into a cluster simply never shows up
 * here; it isn't an error, it just didn't triangulate with anything yet, and
 * it's still visible in the Insights (pre-insights) section above, nothing
 * is hidden or deleted.
 */
/**
 * Where the Insights overview sent the researcher (InsightsWorkspace): the same filter the overview
 * counted that figure with (lib/evidenceOverview.insightMatches), applied once, then editable here.
 */
export type InsightsReviewStart = InsightFilter & { selectedId?: string };

const QUALITY_STATE_LABEL: Record<QualityState, string> = {
  qualified: "Qualified",
  partial: "Partial",
  finding: "Finding only",
  unscored: "Not scored",
};
const CORROBORATION_LABEL: Record<CorroborationState, string> = {
  strong: "Strong, sources checked",
  moderate: "Moderate, sources checked",
  exploratory: "Exploratory, sources checked",
  unrated: "Sources checked, no tier",
  unchecked: "Sources not checked for independence",
};
type SupportFilter = "current" | "stale" | "invalid" | "unknown";
const SUPPORT_FILTERS: [SupportFilter, string][] = [
  ["current", "Current"],
  ["stale", "Changed"],
  ["invalid", "No longer valid"],
  ["unknown", "Not checked"],
];

export default function SynthesizedInsightsReview({
  runId,
  insights,
  request,
}: {
  runId: string;
  insights: SynthesizedInsightRow[];
  /**
   * Where the overview sent the researcher. Each new request (a higher `n`) replaces the filters and
   * the selection; between requests they are the researcher's own. Applied without remounting.
   */
  request?: { start: InsightsReviewStart; n: number };
}) {
  const [confidenceFilter, setConfidenceFilter] = useState<
    "all" | ConfidenceTier
  >("all");
  // "unscored" is reached from the overview's Not scored figure; the buttons below set the tiers.
  const [qualityFilter, setQualityFilter] = useState<"all" | QualityState>(
    "all",
  );
  // Independent corroboration (OV-02) is set only from the overview and shown as a removable chip;
  // the Triangulation buttons below stay a filter on the stored tier alone.
  const [corroborationFilter, setCorroborationFilter] = useState<CorroborationState | null>(null);
  const [reviewFilter, setReviewFilter] = useState<"all" | ReviewStatus>("all");
  // Support is its own filter (Grant, 2026-10-21, from the overview's evidence-health tile): which
  // insights rest on support that changed or is no longer valid, separate from review and quality.
  const [supportFilter, setSupportFilter] = useState<"all" | SupportFilter>("all");
  const [isCheckingStability, startStabilityCheck] = useTransition();
  const [stabilityError, setStabilityError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"insights" | "scores">("insights");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [appliedRequest, setAppliedRequest] = useState<number | null>(null);
  if (request && request.n !== appliedRequest) {
    setAppliedRequest(request.n);
    const st = request.start;
    setConfidenceFilter(st.confidence ?? "all");
    setQualityFilter(st.quality ?? "all");
    setReviewFilter(st.review ?? "all");
    setSupportFilter(st.support ?? "all");
    setCorroborationFilter(st.corroboration ?? null);
    setSelectedId(st.selectedId ?? null);
  }

  if (insights.length === 0) {
    return (
      <p className="text-sm text-muted">
        No synthesized insights yet. This builds from the pre-insights above
        once at least two of them triangulate around the same underlying
        pattern; a run with findings that don&apos;t yet corroborate each other
        across more than one theme may legitimately stay empty here for a while.
      </p>
    );
  }

  const strongCount = insights.filter(
    (i) => i.confidence_tier === "strong",
  ).length;
  const moderateCount = insights.filter(
    (i) => i.confidence_tier === "moderate",
  ).length;
  const exploratoryCount = insights.filter(
    (i) => i.confidence_tier === "exploratory",
  ).length;

  const qualifiedCount = insights.filter(
    (i) => i.quality_tier === "qualified",
  ).length;
  const partialCount = insights.filter(
    (i) => i.quality_tier === "partial",
  ).length;
  const findingOnlyCount = insights.filter(
    (i) => i.quality_tier === "finding",
  ).length;

  const acceptedCount = insights.filter(
    (i) => i.review_status === "accepted",
  ).length;
  const rejectedCount = insights.length - acceptedCount;

  // The same matcher the overview counts with, so a figure opened from there lists what it counted.
  const activeFilter: InsightFilter = {
    review: reviewFilter === "all" ? undefined : reviewFilter,
    support: supportFilter === "all" ? undefined : supportFilter,
    quality: qualityFilter === "all" ? undefined : qualityFilter,
    confidence: confidenceFilter === "all" ? undefined : confidenceFilter,
    corroboration: corroborationFilter ?? undefined,
  };
  const filtered = insights.filter((insight) => insightMatches(insight, activeFilter));

  function handleCheckStability() {
    setStabilityError(null);
    startStabilityCheck(async () => {
      const result = await checkStability(runId);
      if (!result.ok) {
        setStabilityError(result.error);
      }
    });
  }

  const scoredCount = insights.filter((i) => i.quality_score !== null).length;

  const selected = insights.find((i) => i.id === selectedId) ?? null;

  const tabsBar = (
      // Wraps on a narrow column rather than widening the page (same treatment as UI-GT500-01).
      <div className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-border bg-white p-0.5">
        {(
          [
            ["insights", "Insights", insights.length],
            ["scores", "Quality scores", scoredCount],
          ] as const
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            onClick={() => setActiveTab(value)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              activeTab === value
                ? "bg-primary-light text-primary"
                : "text-muted hover:text-foreground"
            }`}
          >
            {label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                activeTab === value
                  ? "bg-white text-primary"
                  : "bg-slate-100 text-muted"
              }`}
            >
              {count}
            </span>
          </button>
        ))}
      </div>

  );

  if (activeTab === "scores") {
    return (
      <div className="space-y-4">
        {tabsBar}
        <QualityScoresTable insights={insights} />
      </div>
    );
  }

  return (
    <InsightSelection.Provider
      value={{ selectedId, select: setSelectedId }}
    >
      <ThreePane
        leftOnTop
        // Its own key, so folding or resizing here leaves the other sections as they are (DESIGN-GTR-01).
        storageKey="insights-review"
        left={
          <Pane side="left" title="Filters">
          {acceptedCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-slate-50 px-4 py-3">
              <p className="max-w-2xl text-xs text-muted">
                Re-runs clustering on {STABILITY_RESAMPLE_COUNT_LABEL} random
                resamples of the evidence pool and checks whether each accepted
                insight&apos;s evidence still groups together. Costs a handful
                of extra model calls, so it only runs when you click it, never
                automatically.
                <InfoDot
                  text={
                    "Reproducibility is separate from Insight quality above: quality judges the insight's own " +
                    "wording and reasoning, reproducibility tests whether its underlying cluster of evidence " +
                    "would form again on a resampled 75% of the pool. High quality + high reproducibility is " +
                    "the strongest combination; high quality with low reproducibility is a well-argued insight " +
                    "that may rest on an incidental grouping, worth a closer look or a hedge before it goes in " +
                    "front of a decision-maker. Neither score deletes or gates an insight automatically."
                  }
                />
              </p>
              <button
                type="button"
                disabled={isCheckingStability}
                onClick={handleCheckStability}
                className="whitespace-nowrap rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-foreground transition hover:border-slate-400 disabled:opacity-60"
              >
                {isCheckingStability ? "Checking..." : "Check stability"}
              </button>
            </div>
          )}
          {stabilityError && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-danger bg-danger-light px-4 py-3 text-sm text-danger">
              <span>
                Couldn&apos;t run the stability check: {stabilityError}
              </span>
              <button
                onClick={() => setStabilityError(null)}
                className="shrink-0 font-medium underline"
              >
                Dismiss
              </button>
            </div>
          )}
          <div>
            <p className="mb-1.5 flex items-center text-xs font-semibold uppercase tracking-wide text-muted">
              Triangulation (corroborating pre-insights)
              <InfoDot
                text={
                  "How many corroborating pre-insights (and distinct themes) fed each synthesized insight, " +
                  "computed from the evidence, not asserted by the model. This is a count of the evidence " +
                  "behind an insight, separate from whether the insight is well-reasoned (see Insight quality " +
                  "below) or whether that evidence still groups the same way on a resample (see Check " +
                  "stability)."
                }
              />
            </p>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                title={confidenceTierDefinition.strong}
                onClick={() =>
                  setConfidenceFilter((f) =>
                    f === "strong" ? "all" : "strong",
                  )
                }
                className={`rounded-lg border px-3 py-2 text-left transition ${
                  confidenceFilter === "strong"
                    ? "border-success bg-success-light"
                    : "border-border bg-white hover:border-slate-300"
                }`}
              >
                <div className="text-lg font-semibold text-success">
                  {strongCount}
                </div>
                <div className="text-xs text-muted">Strong</div>
              </button>
              <button
                type="button"
                title={confidenceTierDefinition.moderate}
                onClick={() =>
                  setConfidenceFilter((f) =>
                    f === "moderate" ? "all" : "moderate",
                  )
                }
                className={`rounded-lg border px-3 py-2 text-left transition ${
                  confidenceFilter === "moderate"
                    ? "border-amber-400 bg-amber-50"
                    : "border-border bg-white hover:border-slate-300"
                }`}
              >
                <div className="text-lg font-semibold text-amber-700">
                  {moderateCount}
                </div>
                <div className="text-xs text-muted">Moderate</div>
              </button>
              <button
                type="button"
                title={confidenceTierDefinition.exploratory}
                onClick={() =>
                  setConfidenceFilter((f) =>
                    f === "exploratory" ? "all" : "exploratory",
                  )
                }
                className={`rounded-lg border px-3 py-2 text-left transition ${
                  confidenceFilter === "exploratory"
                    ? "border-slate-400 bg-slate-100"
                    : "border-border bg-white hover:border-slate-300"
                }`}
              >
                <div className="text-lg font-semibold text-slate-600">
                  {exploratoryCount}
                </div>
                <div className="text-xs text-muted">Exploratory</div>
              </button>
            </div>
          </div>

          <div>
            <p className="mb-1.5 flex items-center text-xs font-semibold uppercase tracking-wide text-muted">
              Insight quality (why / actionability / novelty / synthesis /
              evidentiary fit)
              <InfoDot
                text={
                  "A one-time AI judgment of each insight's own text (not its evidence count): does it name a " +
                  "mechanism, imply an action, say something non-obvious, genuinely reframe its cluster rather " +
                  "than restate it, and stay proportionate to its chain of evidence. Scored 1/3/5 on each of " +
                  "five dimensions, summed out of 25. Independent of triangulation and of Check stability: a " +
                  "strong-confidence insight can still score 'Finding only' here."
                }
              />
            </p>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                title={qualityTierDefinition.qualified}
                onClick={() =>
                  setQualityFilter((f) =>
                    f === "qualified" ? "all" : "qualified",
                  )
                }
                className={`rounded-lg border px-3 py-2 text-left transition ${
                  qualityFilter === "qualified"
                    ? "border-indigo-400 bg-indigo-50"
                    : "border-border bg-white hover:border-slate-300"
                }`}
              >
                <div className="text-lg font-semibold text-indigo-700">
                  {qualifiedCount}
                </div>
                <div className="text-xs text-muted">Qualified</div>
              </button>
              <button
                type="button"
                title={qualityTierDefinition.partial}
                onClick={() =>
                  setQualityFilter((f) => (f === "partial" ? "all" : "partial"))
                }
                className={`rounded-lg border px-3 py-2 text-left transition ${
                  qualityFilter === "partial"
                    ? "border-amber-400 bg-amber-50"
                    : "border-border bg-white hover:border-slate-300"
                }`}
              >
                <div className="text-lg font-semibold text-amber-700">
                  {partialCount}
                </div>
                <div className="text-xs text-muted">Partial</div>
              </button>
              <button
                type="button"
                title={qualityTierDefinition.finding}
                onClick={() =>
                  setQualityFilter((f) => (f === "finding" ? "all" : "finding"))
                }
                className={`rounded-lg border px-3 py-2 text-left transition ${
                  qualityFilter === "finding"
                    ? "border-slate-400 bg-slate-100"
                    : "border-border bg-white hover:border-slate-300"
                }`}
              >
                <div className="text-lg font-semibold text-slate-600">
                  {findingOnlyCount}
                </div>
                <div className="text-xs text-muted">Finding only</div>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5" role="group" aria-label="Support">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Support</div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setSupportFilter("all")}
                aria-pressed={supportFilter === "all"}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${supportFilter === "all" ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                All
              </button>
              {SUPPORT_FILTERS.map(([value, label]) => {
                const n = insights.filter((i) => i.support.status === value).length;
                if (n === 0 && supportFilter !== value) return null;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSupportFilter((f) => (f === value ? "all" : value))}
                    aria-pressed={supportFilter === value}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${supportFilter === value ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                  >
                    {`${label} (${n})`}
                  </button>
                );
              })}
            </div>
          </div>

          {rejectedCount > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setReviewFilter("all")}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  reviewFilter === "all"
                    ? "bg-primary text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                All ({insights.length})
              </button>
              <button
                type="button"
                onClick={() =>
                  setReviewFilter((f) =>
                    f === "accepted" ? "all" : "accepted",
                  )
                }
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  reviewFilter === "accepted"
                    ? "bg-primary text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                Accepted ({acceptedCount})
              </button>
              <button
                type="button"
                onClick={() =>
                  setReviewFilter((f) =>
                    f === "rejected" ? "all" : "rejected",
                  )
                }
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  reviewFilter === "rejected"
                    ? "bg-primary text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                Rejected ({rejectedCount})
              </button>
            </div>
          )}

          </Pane>
        }
        middle={
          <Pane
            side="middle"
            title="Insights"
            badge={
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-muted">
                {filtered.length} of {insights.length}
              </span>
            }
          >
            {tabsBar}
          {(corroborationFilter || qualityFilter === "unscored") && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="insights-overview-filters">
              {corroborationFilter && (
                <button
                  type="button"
                  onClick={() => setCorroborationFilter(null)}
                  className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
                  aria-label={`Remove filter: ${CORROBORATION_LABEL[corroborationFilter]}`}
                >
                  {`${CORROBORATION_LABEL[corroborationFilter]} ×`}
                </button>
              )}
              {qualityFilter === "unscored" && (
                <button
                  type="button"
                  onClick={() => setQualityFilter("all")}
                  className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
                  aria-label={`Remove filter: ${QUALITY_STATE_LABEL.unscored}`}
                >
                  {`${QUALITY_STATE_LABEL.unscored} ×`}
                </button>
              )}
            </div>
          )}
          {filtered.length === 0 ? (
            <p className="text-sm text-muted">
              No synthesized insights match this filter.
            </p>
          ) : (
            <div className="space-y-3">
              {filtered.map((insight) => (
                <SynthesizedInsightCard
                  key={insight.id}
                  runId={runId}
                  insight={insight}
                />
              ))}
            </div>
          )}
          </Pane>
        }
        right={
          <Pane side="right" title="Story and evidence">
            {selected ? (
              <InsightStory insight={selected} />
            ) : (
              <p className="text-sm text-muted">
                Select an insight to read its observation, tension and
                implication, and the chain of evidence behind it.
              </p>
            )}
          </Pane>
        }
      />
    </InsightSelection.Provider>
  );
}

const SCORE_COLUMNS = [
  [
    "why_score",
    "Why",
    "The Why: names a cause or driver (1 = what happened only, 3 = implied, 5 = root cause named).",
  ],
  [
    "actionability_score",
    "Action",
    "Actionability: 1 = nice to know, 3 = vague direction, 5 = dictates a clear decision.",
  ],
  [
    "novelty_score",
    "Novelty",
    "Novelty: 1 = obvious, 3 = confirms an assumption, 5 = overturns or sharpens one.",
  ],
  [
    "synthesis_score",
    "Synthesis",
    "Synthesis: 1 = one source restated, 3 = a couple of similar points combined, 5 = reframes the cluster around a new tension.",
  ],
  [
    "evidentiary_score",
    "Evidence fit",
    "Evidentiary proportionality: 1 = unsupported by the chain of evidence, 3 = asserted more confidently than it warrants, 5 = directly traceable, no leap.",
  ],
] as const;

const scoreCellClass: Record<number, string> = {
  1: "bg-slate-100 text-slate-600",
  3: "bg-amber-50 text-amber-700",
  5: "bg-indigo-50 text-indigo-700",
};

/**
 * Every synthesized insight scored across the five quality dimensions, one
 * row each: the per-dimension scores, the total out of 25, and the resulting
 * classification. Read-only view of what synthesizedInsightQualityScorer.ts
 * already stored; nothing here recomputes a score.
 */
function QualityScoresTable({
  insights,
}: {
  insights: SynthesizedInsightRow[];
}) {
  const scored = insights.filter((i) => i.quality_score !== null).length;
  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-xs text-muted">
        Each insight is scored 1, 3 or 5 on five dimensions, summed out of 25.
        15 or more is a qualified insight, 12 to 14 partial, below 12 a finding
        rather than an insight. Hover a column heading for its definition, or a
        classification for the scorer&apos;s reason.
        {scored < insights.length
          ? ` ${insights.length - scored} insight${insights.length - scored === 1 ? " is" : "s are"} not scored yet.`
          : ""}
      </p>
      <div className="overflow-x-auto rounded-xl border border-border bg-white">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-muted">
              <th className="px-3 py-2">Insight</th>
              {SCORE_COLUMNS.map(([key, label, definition]) => (
                <th
                  key={key}
                  title={definition}
                  className="px-2 py-2 text-center"
                >
                  {label}
                </th>
              ))}
              <th className="px-2 py-2 text-center">Total</th>
              <th className="px-3 py-2">Classification</th>
            </tr>
          </thead>
          <tbody>
            {insights.map((insight) => {
              const rejected = insight.review_status === "rejected";
              return (
                <tr
                  key={insight.id}
                  className={`border-b border-border last:border-0 ${rejected ? "opacity-50" : ""}`}
                >
                  <td className="max-w-sm px-3 py-2 align-top text-foreground">
                    {insight.headline}
                    {rejected ? (
                      <span className="ml-1.5 text-[10px] uppercase text-muted">
                        rejected
                      </span>
                    ) : null}
                  </td>
                  {SCORE_COLUMNS.map(([key]) => {
                    const value = insight[key];
                    return (
                      <td key={key} className="px-2 py-2 text-center align-top">
                        {value === null ? (
                          <span className="text-muted">-</span>
                        ) : (
                          <span
                            className={`inline-block min-w-6 rounded px-1.5 py-0.5 font-semibold ${scoreCellClass[value] ?? scoreCellClass[1]}`}
                          >
                            {value}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 py-2 text-center align-top font-semibold text-foreground">
                    {insight.quality_score === null
                      ? "-"
                      : `${insight.quality_score}/25`}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {insight.quality_tier ? (
                      <span
                        title={insight.quality_rationale ?? undefined}
                        className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${qualityTierClass[insight.quality_tier]}`}
                      >
                        {qualityTierLabel[insight.quality_tier]}
                      </span>
                    ) : (
                      <span className="text-muted">Not scored</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SynthesizedInsightCard({
  runId,
  insight,
}: {
  runId: string;
  insight: SynthesizedInsightRow;
}) {
  const [isPending, startTransition] = useTransition();
  // The story and evidence show in the right-hand pane for the selected insight.
  const { selectedId, select } = useContext(InsightSelection);
  const isSelected = selectedId === insight.id;
  const isRejected = insight.review_status === "rejected";

  function handleDelete() {
    if (
      !confirm(
        "Delete this synthesized insight? It will be kept in the run's history, but its member pre-insights become eligible for a future synthesis pass again.",
      )
    )
      return;
    startTransition(() => deleteSynthesizedInsight(runId, insight.id));
  }

  return (
    <div
      data-testid="synthesized-insight-card"
      data-insight-id={insight.id}
      data-review-status={insight.review_status}
      data-support-status={insight.support.status}
      data-source-finding-ids={(insight.source_finding_ids ?? []).join(" ")}
      onClick={() => select(insight.id)}
      className={`card-surface flex cursor-pointer flex-col gap-3 rounded-xl border bg-white p-4 ${isSelected ? "border-primary/50 ring-2 ring-primary/40" : "border-border"} ${isRejected ? "opacity-50" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {insight.confidence_tier ? (
            <span
              title={confidenceTierDefinition[insight.confidence_tier]}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${confidenceTierClass[insight.confidence_tier]}`}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"
                aria-hidden
              />
              {confidenceTierLabel[insight.confidence_tier]} confidence
            </span>
          ) : insight.independent_source_count === null ? (
            <span
              title="Confidence is only assigned once the insight's sources have been checked for independence (several findings from one data file or one report count as one source). Re-run synthesis to assess it."
              className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600"
            >
              Confidence not assessed
            </span>
          ) : null}
          {insight.quality_tier ? (
            <span
              title={
                insight.quality_rationale
                  ? `${qualityTierDefinition[insight.quality_tier]} For this insight: ${insight.quality_rationale}`
                  : qualityTierDefinition[insight.quality_tier]
              }
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${qualityTierClass[insight.quality_tier]}`}
            >
              {qualityTierLabel[insight.quality_tier]} &middot;{" "}
              {insight.quality_score}/25
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Not scored yet
            </span>
          )}
          <span
            title={
              (insight.independent_source_count === null
                ? "Its sources have not been checked for independence. "
                : `Rests on ${insight.independent_source_count} independent evidence source${insight.independent_source_count === 1 ? "" : "s"} ` +
                  "(findings from the same table, or claims from the same report, count as one). ") +
              `Built from ${insight.triangulation_count} linked pre-insight${insight.triangulation_count === 1 ? "" : "s"}` +
              `${insight.source_theme_count > 1 ? ` across ${insight.source_theme_count} distinct themes` : " from a single theme"}. ` +
              "The confidence tier is computed from the independent sources and themes, not from the number of pre-insights."
            }
            className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500"
          >
            {insight.independent_source_count === null
              ? "Sources not checked for independence"
              : `${insight.independent_source_count} independent source${insight.independent_source_count === 1 ? "" : "s"}`}
            {insight.source_theme_count > 1
              ? ` across ${insight.source_theme_count} themes`
              : ""}
          </span>
          {(insight.independent_source_count ?? insight.triangulation_count) <= THIN_EVIDENCE_FLOOR && (
            <span
              title="This insight rests on the bare minimum of corroborating evidence; losing one supporting finding could undo it. A full reproducibility check (resampling the evidence and re-running synthesis) would confirm whether it holds up, but isn't run automatically."
              className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700"
            >
              Thin evidence
            </span>
          )}
          {insight.stability_checked_at &&
            (insight.stability_testable_count === 0 ? (
              <span
                title="Every resample dropped too much of this insight's own evidence to test it -- not a failure, just inconclusive. Usually happens to thin-evidence insights."
                className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500"
              >
                Stability: not testable
              </span>
            ) : (
              <span
                title={`Reappeared in ${insight.stability_reappeared_count} of ${insight.stability_testable_count} resamples where it could be tested. Checked ${new Date(insight.stability_checked_at).toLocaleDateString("en-ZA")}.`}
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                  insight.stability_reappeared_count ===
                  insight.stability_testable_count
                    ? "bg-success-light text-success"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                Reproduced {insight.stability_reappeared_count}/
                {insight.stability_testable_count}
              </span>
            ))}
          {insight.action_plan_status === "retained_no_action" && (
            <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
              No action plan yet, retained
            </span>
          )}
          {isRejected && (
            <span className="inline-flex items-center rounded-full bg-slate-200 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
              Rejected
            </span>
          )}
          <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
            New, found by the Elevator
          </span>
          {insight.contradicts.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-rose-700">
              Contradicts the report
            </span>
          )}
        </div>
        <button
          disabled={isPending}
          onClick={handleDelete}
          aria-label="Delete synthesized insight"
          title="Delete synthesized insight"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-danger-light hover:text-danger"
        >
          <TrashIcon className="h-3 w-3" />
        </button>
      </div>
      <SupportStatusNotice support={insight.support} />
      <FigureCheckFor kind="synthesizedInsights" id={insight.id} />

      <div className="text-base font-semibold leading-snug text-foreground">
        {insight.headline}
      </div>
      <p className="-mt-1 text-xs text-muted">{insight.provenance_caption}</p>
      {insight.contradicts.length > 0 && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">
            This corrects the report, it does not add to it
          </p>
          <ul className="mt-1 space-y-1 text-xs text-rose-900">
            {insight.contradicts.map((c, index) => (
              <li key={index}>
                The report said &ldquo;{c.original_text}&rdquo;. {c.rationale}
              </li>
            ))}
          </ul>
        </div>
      )}


      <div className="-mt-1 flex flex-wrap items-center justify-between gap-1.5">
        <button
          type="button"
          onClick={() => select(insight.id)}
          aria-pressed={isSelected}
          className="rounded-lg px-2 py-1 text-xs font-medium text-primary transition hover:bg-primary/5"
        >
          {isSelected ? "Showing on the right" : "Show the story and evidence"}
        </button>
        <div className="flex flex-wrap gap-1.5">
        {isRejected ? (
          <button
            disabled={isPending}
            onClick={() =>
              startTransition(() => acceptSynthesizedInsight(runId, insight.id))
            }
            className="rounded-lg border border-success px-2.5 py-1 text-xs font-medium text-success transition hover:bg-success-light"
          >
            Accept
          </button>
        ) : (
          <button
            disabled={isPending}
            onClick={() =>
              startTransition(() => rejectSynthesizedInsight(runId, insight.id))
            }
            className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-danger hover:text-danger"
          >
            Reject
          </button>
        )}
        </div>
      </div>
    </div>
  );
}

/** The right-hand pane for one insight: the observation, tension and implication, then why to trust it. */
function InsightStory({ insight }: { insight: SynthesizedInsightRow }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="text-base font-semibold leading-snug text-foreground">
        {insight.headline}
      </div>
      {/* Laid out like a slide: the story on the left, why to trust it on
          the right. Stacks on narrow screens. */}
      <div className="grid overflow-hidden rounded-2xl border border-border bg-white ">
        <div className="flex flex-col gap-5 p-4">
          {[
            {
              letter: "O",
              label: "Observation",
              text: insight.observation,
              badge: "bg-primary text-white",
              labelColor: "text-primary",
              bar: "bg-primary",
            },
            {
              letter: "T",
              label: "Tension",
              text: insight.tension,
              badge: "bg-amber-600 text-white",
              labelColor: "text-amber-700",
              bar: "bg-amber-500",
            },
            {
              letter: "I",
              label: "Implication",
              text: insight.implication,
              badge: "bg-indigo-600 text-white",
              labelColor: "text-indigo-700",
              bar: "bg-indigo-500",
            },
          ].map((part) => (
            <div key={part.letter} className="flex gap-4">
              <div className="flex shrink-0 flex-col items-center">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${part.badge}`}
                >
                  {part.letter}
                </div>
                <div className={`mt-1 w-0.5 flex-1 rounded ${part.bar} opacity-30`} />
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <div
                  className={`mb-1 text-[11px] font-bold uppercase tracking-wide ${part.labelColor}`}
                >
                  {part.label}
                </div>
                <div className="text-[15px] leading-relaxed text-foreground">
                  {part.text}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-5 border-t border-border bg-slate-50 p-5 ">
          {insight.quality_rationale && (
            <div>
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-teal-700">
                Quality note
              </div>
              <div className="text-sm leading-relaxed text-slate-700">
                {insight.quality_rationale}
              </div>
            </div>
          )}
          {insight.materiality_rationale && (
            <div>
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-orange-800">
                Materiality
              </div>
              <div className="text-sm leading-relaxed text-slate-700">
                {insight.materiality_rationale}
              </div>
            </div>
          )}
          <div
            className={
              insight.quality_rationale || insight.materiality_rationale
                ? "border-t border-border pt-4"
                : ""
            }
          >
            <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-muted">
              Chain of evidence &middot; {insight.source_headlines.length}{" "}
              pre-insight
              {insight.source_headlines.length === 1 ? "" : "s"}
            </div>
            <div className="flex flex-col">
              {insight.source_headlines.map((headline, index) => (
                <div key={index} className="flex gap-3">
                  <div className="flex w-5 shrink-0 flex-col items-center">
                    <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 border-slate-300 bg-white text-[10px] font-bold text-slate-500">
                      {index + 1}
                    </div>
                    {index < insight.source_headlines.length - 1 && (
                      <div
                        className="w-0.5 flex-1 bg-border"
                        style={{ minHeight: "10px" }}
                      />
                    )}
                  </div>
                  <div className="pb-3 text-[13px] leading-relaxed text-slate-600">
                    {headline}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
