"use client";

import { useState, useTransition } from "react";
import {
  acceptSynthesizedInsight,
  rejectSynthesizedInsight,
  deleteSynthesizedInsight,
  checkStability,
} from "@/lib/synthesizedInsightActions";
import { TrashIcon } from "@/components/icons";

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
  source_theme_count: number;
  materiality_rationale: string | null;
  confidence_tier: ConfidenceTier | null;
  review_status: ReviewStatus;
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
  from_report: boolean;
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

// Mirrors the strong/moderate/exploratory thresholds computed server-side in
// insightSynthesizer.ts (sourceThemeCount >= 2 && triangulationCount >= 3 =
// strong; either alone = moderate; neither = exploratory). Display copy
// only, same reasoning as THIN_EVIDENCE_FLOOR and
// STABILITY_RESAMPLE_COUNT_LABEL above: kept here rather than imported so
// this client component doesn't pull in server-only code.
const confidenceTierDefinition: Record<ConfidenceTier, string> = {
  strong:
    "Strong confidence: at least 3 corroborating pre-insights spanning at least 2 distinct themes. " +
    "Computed directly from the evidence count, not a judgment call the model makes.",
  moderate:
    "Moderate confidence: either 3+ corroborating pre-insights or 2+ distinct themes, but not both.",
  exploratory:
    "Exploratory confidence: fewer than 3 corroborating pre-insights and from a single theme. Worth " +
    "watching, but not yet well-triangulated against independent evidence.",
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

/**
 * Small, discoverable hover target for a definition that doesn't fit in a
 * label. Plain title attribute underneath (same pattern already used on the
 * stability badges below), the visible "i" dot just signals there's
 * something to hover, since a bare label or count gives no such hint.
 */
function InfoDot({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      className="ml-1 inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full bg-slate-200 align-text-top text-[9px] font-bold leading-none text-slate-500"
    >
      i
    </span>
  );
}

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
export default function SynthesizedInsightsReview({
  runId,
  insights,
}: {
  runId: string;
  insights: SynthesizedInsightRow[];
}) {
  const [confidenceFilter, setConfidenceFilter] = useState<"all" | ConfidenceTier>("all");
  const [qualityFilter, setQualityFilter] = useState<"all" | QualityTier>("all");
  const [reviewFilter, setReviewFilter] = useState<"all" | ReviewStatus>("all");
  const [isCheckingStability, startStabilityCheck] = useTransition();
  const [stabilityError, setStabilityError] = useState<string | null>(null);

  if (insights.length === 0) {
    return (
      <p className="text-sm text-muted">
        No synthesized insights yet. This builds from the pre-insights above once at least two of them
        triangulate around the same underlying pattern; a run with findings that don&apos;t yet corroborate
        each other across more than one theme may legitimately stay empty here for a while.
      </p>
    );
  }

  const strongCount = insights.filter((i) => i.confidence_tier === "strong").length;
  const moderateCount = insights.filter((i) => i.confidence_tier === "moderate").length;
  const exploratoryCount = insights.filter((i) => i.confidence_tier === "exploratory").length;

  const qualifiedCount = insights.filter((i) => i.quality_tier === "qualified").length;
  const partialCount = insights.filter((i) => i.quality_tier === "partial").length;
  const findingOnlyCount = insights.filter((i) => i.quality_tier === "finding").length;

  const acceptedCount = insights.filter((i) => i.review_status === "accepted").length;
  const rejectedCount = insights.length - acceptedCount;

  const filtered = insights.filter((insight) => {
    if (confidenceFilter !== "all" && insight.confidence_tier !== confidenceFilter) return false;
    if (qualityFilter !== "all" && insight.quality_tier !== qualityFilter) return false;
    if (reviewFilter !== "all" && insight.review_status !== reviewFilter) return false;
    return true;
  });

  function handleCheckStability() {
    setStabilityError(null);
    startStabilityCheck(async () => {
      const result = await checkStability(runId);
      if (!result.ok) {
        setStabilityError(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      {acceptedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-slate-50 px-4 py-3">
          <p className="max-w-2xl text-xs text-muted">
            Re-runs clustering on {STABILITY_RESAMPLE_COUNT_LABEL} random resamples of the evidence pool and
            checks whether each accepted insight&apos;s evidence still groups together. Costs a handful of
            extra model calls, so it only runs when you click it, never automatically.
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
          <span>Couldn&apos;t run the stability check: {stabilityError}</span>
          <button onClick={() => setStabilityError(null)} className="shrink-0 font-medium underline">
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
        <div className="grid grid-cols-3 gap-2 sm:max-w-md">
          <button
            type="button"
            title={confidenceTierDefinition.strong}
            onClick={() => setConfidenceFilter((f) => (f === "strong" ? "all" : "strong"))}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              confidenceFilter === "strong" ? "border-success bg-success-light" : "border-border bg-white hover:border-slate-300"
            }`}
          >
            <div className="text-lg font-semibold text-success">{strongCount}</div>
            <div className="text-xs text-muted">Strong</div>
          </button>
          <button
            type="button"
            title={confidenceTierDefinition.moderate}
            onClick={() => setConfidenceFilter((f) => (f === "moderate" ? "all" : "moderate"))}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              confidenceFilter === "moderate" ? "border-amber-400 bg-amber-50" : "border-border bg-white hover:border-slate-300"
            }`}
          >
            <div className="text-lg font-semibold text-amber-700">{moderateCount}</div>
            <div className="text-xs text-muted">Moderate</div>
          </button>
          <button
            type="button"
            title={confidenceTierDefinition.exploratory}
            onClick={() => setConfidenceFilter((f) => (f === "exploratory" ? "all" : "exploratory"))}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              confidenceFilter === "exploratory" ? "border-slate-400 bg-slate-100" : "border-border bg-white hover:border-slate-300"
            }`}
          >
            <div className="text-lg font-semibold text-slate-600">{exploratoryCount}</div>
            <div className="text-xs text-muted">Exploratory</div>
          </button>
        </div>
      </div>

      <div>
        <p className="mb-1.5 flex items-center text-xs font-semibold uppercase tracking-wide text-muted">
          Insight quality (why / actionability / novelty / synthesis / evidentiary fit)
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
        <div className="grid grid-cols-3 gap-2 sm:max-w-md">
          <button
            type="button"
            title={qualityTierDefinition.qualified}
            onClick={() => setQualityFilter((f) => (f === "qualified" ? "all" : "qualified"))}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              qualityFilter === "qualified" ? "border-indigo-400 bg-indigo-50" : "border-border bg-white hover:border-slate-300"
            }`}
          >
            <div className="text-lg font-semibold text-indigo-700">{qualifiedCount}</div>
            <div className="text-xs text-muted">Qualified</div>
          </button>
          <button
            type="button"
            title={qualityTierDefinition.partial}
            onClick={() => setQualityFilter((f) => (f === "partial" ? "all" : "partial"))}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              qualityFilter === "partial" ? "border-amber-400 bg-amber-50" : "border-border bg-white hover:border-slate-300"
            }`}
          >
            <div className="text-lg font-semibold text-amber-700">{partialCount}</div>
            <div className="text-xs text-muted">Partial</div>
          </button>
          <button
            type="button"
            title={qualityTierDefinition.finding}
            onClick={() => setQualityFilter((f) => (f === "finding" ? "all" : "finding"))}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              qualityFilter === "finding" ? "border-slate-400 bg-slate-100" : "border-border bg-white hover:border-slate-300"
            }`}
          >
            <div className="text-lg font-semibold text-slate-600">{findingOnlyCount}</div>
            <div className="text-xs text-muted">Finding only</div>
          </button>
        </div>
      </div>

      {rejectedCount > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setReviewFilter("all")}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
              reviewFilter === "all" ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            All ({insights.length})
          </button>
          <button
            type="button"
            onClick={() => setReviewFilter((f) => (f === "accepted" ? "all" : "accepted"))}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
              reviewFilter === "accepted" ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            Accepted ({acceptedCount})
          </button>
          <button
            type="button"
            onClick={() => setReviewFilter((f) => (f === "rejected" ? "all" : "rejected"))}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
              reviewFilter === "rejected" ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            Rejected ({rejectedCount})
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-muted">No synthesized insights match this filter.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((insight) => (
            <SynthesizedInsightCard key={insight.id} runId={runId} insight={insight} />
          ))}
        </div>
      )}
    </div>
  );
}

function SynthesizedInsightCard({ runId, insight }: { runId: string; insight: SynthesizedInsightRow }) {
  const [isPending, startTransition] = useTransition();
  const isRejected = insight.review_status === "rejected";

  function handleDelete() {
    if (
      !confirm(
        "Delete this synthesized insight? It will be kept in the run's history, but its member pre-insights become eligible for a future synthesis pass again."
      )
    )
      return;
    startTransition(() => deleteSynthesizedInsight(runId, insight.id));
  }

  return (
    <div className={`rounded-lg border border-border bg-white p-4 transition ${isRejected ? "opacity-50" : ""}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {insight.confidence_tier ? (
            <span
              title={confidenceTierDefinition[insight.confidence_tier]}
              className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${confidenceTierClass[insight.confidence_tier]}`}
            >
              {confidenceTierLabel[insight.confidence_tier]} confidence
            </span>
          ) : null}
          {insight.quality_tier ? (
            <span
              title={
                insight.quality_rationale
                  ? `${qualityTierDefinition[insight.quality_tier]} For this insight: ${insight.quality_rationale}`
                  : qualityTierDefinition[insight.quality_tier]
              }
              className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${qualityTierClass[insight.quality_tier]}`}
            >
              {qualityTierLabel[insight.quality_tier]} &middot; {insight.quality_score}/25
            </span>
          ) : (
            <span className="inline-block rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Not scored yet
            </span>
          )}
          <span
            title={
              `Built from ${insight.triangulation_count} corroborating pre-insight${insight.triangulation_count === 1 ? "" : "s"}` +
              `${insight.source_theme_count > 1 ? ` across ${insight.source_theme_count} distinct themes` : " from a single theme"}. ` +
              "This count is what the Strong/Moderate/Exploratory confidence tier above is computed from."
            }
            className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
          >
            {insight.triangulation_count} corroborating pre-insight{insight.triangulation_count === 1 ? "" : "s"}
            {insight.source_theme_count > 1 ? ` across ${insight.source_theme_count} themes` : ""}
          </span>
          {insight.triangulation_count <= THIN_EVIDENCE_FLOOR && (
            <span
              title="This insight rests on the bare minimum of corroborating evidence; losing one supporting finding could undo it. A full reproducibility check (resampling the evidence and re-running synthesis) would confirm whether it holds up, but isn't run automatically."
              className="inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
            >
              Thin evidence
            </span>
          )}
          {insight.stability_checked_at &&
            (insight.stability_testable_count === 0 ? (
              <span
                title="Every resample dropped too much of this insight's own evidence to test it -- not a failure, just inconclusive. Usually happens to thin-evidence insights."
                className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
              >
                Stability: not testable
              </span>
            ) : (
              <span
                title={`Reappeared in ${insight.stability_reappeared_count} of ${insight.stability_testable_count} resamples where it could be tested. Checked ${new Date(insight.stability_checked_at).toLocaleDateString("en-ZA")}.`}
                className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  insight.stability_reappeared_count === insight.stability_testable_count
                    ? "bg-success-light text-success"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                Reproduced {insight.stability_reappeared_count}/{insight.stability_testable_count}
              </span>
            ))}
          {insight.action_plan_status === "retained_no_action" && (
            <span className="inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
              No action plan yet, retained
            </span>
          )}
          {isRejected && (
            <span className="inline-block rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
              Rejected
            </span>
          )}
          <span
            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              insight.from_report ? "bg-primary-light text-primary" : "bg-indigo-50 text-indigo-700"
            }`}
          >
            {insight.from_report ? "Confirms the report" : "New, found by the Elevator"}
          </span>
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
      <div className="mb-2 text-sm font-semibold text-foreground">{insight.headline}</div>
      <dl className="space-y-1.5 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Observation</dt>
          <dd className="text-foreground">{insight.observation}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Tension</dt>
          <dd className="text-foreground">{insight.tension}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Implication</dt>
          <dd className="text-foreground">{insight.implication}</dd>
        </div>
      </dl>
      {insight.quality_rationale && (
        <div className="mt-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
          <span className="font-semibold uppercase tracking-wide text-slate-500">Quality note: </span>
          {insight.quality_rationale}
        </div>
      )}
      {insight.materiality_rationale && (
        <div className="mt-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
          <span className="font-semibold uppercase tracking-wide text-slate-500">Materiality: </span>
          {insight.materiality_rationale}
        </div>
      )}
      <div className="mt-2 border-t border-border pt-2 text-xs text-muted">
        Chain of evidence, from {insight.source_headlines.length} pre-insight
        {insight.source_headlines.length === 1 ? "" : "s"}:
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          {insight.source_headlines.map((headline, index) => (
            <li key={index}>{headline}</li>
          ))}
        </ul>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {isRejected ? (
          <button
            disabled={isPending}
            onClick={() => startTransition(() => acceptSynthesizedInsight(runId, insight.id))}
            className="rounded-lg border border-success px-2.5 py-1 text-xs font-medium text-success transition hover:bg-success-light"
          >
            Accept
          </button>
        ) : (
          <button
            disabled={isPending}
            onClick={() => startTransition(() => rejectSynthesizedInsight(runId, insight.id))}
            className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-danger hover:text-danger"
          >
            Reject
          </button>
        )}
      </div>
    </div>
  );
}
