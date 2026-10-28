"use client";

import { useMemo, useState } from "react";
import {
  verificationCaption,
  type InputCompleteness,
  type VerificationBasis,
} from "@/lib/discoveryClassification";
import { CAVEAT_LABELS, caveatLabel } from "@/lib/caveatLabels";
import { EARLIER_DECISIONS_LABEL } from "@/lib/decisionContext";
import { SUPPORT_STATUS_LABEL } from "@/lib/supportStatusShared";
import { FigureCheckFor } from "./FigureCheckNotice";

type VerdictTier = "robust" | "use_with_caution";

type Insight = {
  id: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  decision_context: string | null;
  finding_text: string;
  theme: string | null;
  verdict_tier: VerdictTier;
  // True when the finding behind this insight traces to something the
  // original report said; false means the Elevator's own analysis found it.
  from_report: boolean;
  verification_basis: VerificationBasis;
  caveats: string[];
  written_for_earlier_decisions: boolean;
  // GT-006: the pre-insight's support from the shared rule; summary is null when current.
  support_status: "current" | "stale" | "invalid" | "unknown";
  support_summary: string | null;
};

// Short, plain-language labels for the fixed caveat vocabulary (see the
// user manual's Verification page for what each one actually means). A
// caveat this map doesn't recognize still renders, just with its raw name
// (underscores swapped for spaces) rather than disappearing silently, so a
// future caveat type is never invisible while this map catches up.
//
// FND-001/REP-OUT-001 (second counter-review): moved to src/lib/caveatLabels.ts so the DOCX/
// PPTX export routes can render the same label for the same tag, rather than keeping a second,
// independently-drifting copy here. No behaviour change - same map, same fallback, imported
// instead of declared inline.

type VerdictSummary = { verdictedCount: number; passedCount: number };
type FailedVerdictSample = {
  finding_text: string;
  verdict_tier: string;
  rationale: string;
};

const UNCATEGORIZED = "Uncategorized";

/** Whether every eligible verified finding has an insight, counted when the page was read (EC10K-F01). */
export type InsightCoverageGap = {
  /** Verified findings still without an insight; null when this could not be counted. */
  uncovered: number | null;
  /** A "validate" project with no confirmed decision yet: nothing is drafted, and that is not a gap. */
  waitingForDecision: boolean;
  error: string | null;
  /** The last automatic attempt's own account of what it could not write, when there is a gap. */
  reason: string | null;
};

/**
 * EC10K-F01: says when verified findings have no insight yet, so a partial or bounded generation never
 * reads as complete; says the count is unknown when it could not be read. Nothing when complete.
 */
export function InsightCoverageNotice({ gap }: { gap: InsightCoverageGap }) {
  if (gap.waitingForDecision) return null;
  if (gap.uncovered === null) {
    return (
      <p className="text-sm text-danger">
        Whether every verified finding has an insight could not be checked{gap.error ? `: ${gap.error}` : ""}.
      </p>
    );
  }
  if (gap.uncovered === 0) return null;
  return (
    <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-foreground">
      {gap.uncovered} verified finding{gap.uncovered === 1 ? " has" : "s have"} no insight yet, so this list is
      incomplete.{gap.reason ? ` Last attempt: ${gap.reason}` : ""} The insights already written are kept; processing
      the project again drafts only the missing ones.
    </p>
  );
}

/**
 * A run with a few dozen insights used to mean scrolling past all of them
 * to find the ones that actually matter, with no sense of the overall mix
 * of robust-vs-caution or which themes carry the most weight. This adds a
 * small stat dashboard (click a tile to filter by that tier) and a theme
 * chip row above the list, so narrowing down is a click instead of a
 * scroll, while the underlying data and card layout are unchanged.
 *
 * These are the one-per-finding pre-insights (chain of evidence), kept
 * exactly as insightGenerator.ts produces them. The five-dimension quality
 * score that used to be scored and shown here moved to the Synthesized
 * insights section instead: a pre-insight is one finding's worth of
 * restated claim, so scoring it mostly measured how well a single
 * restatement was written, where a synthesized insight is the thing that
 * actually claims to be a genuine, cross-source insight, which is where
 * that judgment belongs (see synthesizedInsightQualityScorer.ts).
 */
export default function InsightsReview({
  insights,
  inputState,
  totalFindings,
  verdictSummary,
  insightError,
  failedVerdictSamples,
  coverageGap,
}: {
  insights: Insight[];
  inputState: InputCompleteness;
  totalFindings: number;
  verdictSummary: VerdictSummary | null;
  insightError: string | null;
  failedVerdictSamples: FailedVerdictSample[];
  coverageGap: InsightCoverageGap;
}) {
  const [tierFilter, setTierFilter] = useState<"all" | VerdictTier>("all");
  const [themeFilter, setThemeFilter] = useState<string>("all");

  const robustCount = insights.filter(
    (i) => i.verdict_tier === "robust",
  ).length;
  const cautionCount = insights.length - robustCount;

  const themeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const insight of insights) {
      const theme = insight.theme ?? UNCATEGORIZED;
      counts.set(theme, (counts.get(theme) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [insights]);

  const filtered = insights.filter((insight) => {
    if (tierFilter !== "all" && insight.verdict_tier !== tierFilter)
      return false;
    if (
      themeFilter !== "all" &&
      (insight.theme ?? UNCATEGORIZED) !== themeFilter
    )
      return false;
    return true;
  });

  if (insights.length === 0) {
    return (
      <div className="space-y-1.5 text-sm text-muted">
        <p>
          None yet. Insights are generated from findings that pass verification,
          once there are any to read.
        </p>
        {verdictSummary && (
          <p>
            {verdictSummary.verdictedCount === 0
              ? `None of this run's ${totalFindings} finding(s) have been through verification yet.`
              : `${verdictSummary.passedCount} of ${verdictSummary.verdictedCount} verified finding(s) passed as robust or use-with-caution, the only tiers insights are generated from.`}
          </p>
        )}
        {insightError && (
          <p className="text-danger">
            Last automatic attempt failed: {insightError}
          </p>
        )}
        <InsightCoverageNotice gap={{ ...coverageGap, reason: null }} />
        {failedVerdictSamples.length > 0 && (
          <div className="mt-2 space-y-2 rounded-lg border border-border bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Why some didn&apos;t pass (a sample)
            </p>
            {failedVerdictSamples.map((sample, index) => (
              <div
                key={index}
                className="border-t border-border pt-2 first:border-t-0 first:pt-0"
              >
                <p className="text-foreground">
                  &ldquo;{sample.finding_text}&rdquo;
                </p>
                <p className="mt-0.5 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-muted">
                    {sample.verdict_tier.replace(/_/g, " ")}:
                  </span>{" "}
                  {sample.rationale}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <InsightCoverageNotice gap={coverageGap} />
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          Evidence strength
        </p>
        <div className="grid grid-cols-3 gap-2 sm:max-w-md">
          <button
            type="button"
            onClick={() => setTierFilter("all")}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              tierFilter === "all"
                ? "border-primary bg-primary-light"
                : "border-border bg-white hover:border-slate-300"
            }`}
          >
            <div className="text-lg font-semibold text-foreground">
              {insights.length}
            </div>
            <div className="text-xs text-muted">Total</div>
          </button>
          <button
            type="button"
            onClick={() =>
              setTierFilter((f) => (f === "robust" ? "all" : "robust"))
            }
            className={`rounded-lg border px-3 py-2 text-left transition ${
              tierFilter === "robust"
                ? "border-success bg-success-light"
                : "border-border bg-white hover:border-slate-300"
            }`}
          >
            <div className="text-lg font-semibold text-success">
              {robustCount}
            </div>
            <div className="text-xs text-muted">Robust</div>
          </button>
          <button
            type="button"
            onClick={() =>
              setTierFilter((f) =>
                f === "use_with_caution" ? "all" : "use_with_caution",
              )
            }
            className={`rounded-lg border px-3 py-2 text-left transition ${
              tierFilter === "use_with_caution"
                ? "border-amber-400 bg-amber-50"
                : "border-border bg-white hover:border-slate-300"
            }`}
          >
            <div className="text-lg font-semibold text-amber-700">
              {cautionCount}
            </div>
            <div className="text-xs text-muted">Use with caution</div>
          </button>
        </div>
      </div>

      {themeCounts.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setThemeFilter("all")}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
              themeFilter === "all"
                ? "bg-primary text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            All themes
          </button>
          {themeCounts.map(([theme, count]) => (
            <button
              key={theme}
              type="button"
              onClick={() =>
                setThemeFilter((f) => (f === theme ? "all" : theme))
              }
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                themeFilter === theme
                  ? "bg-primary text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {theme} ({count})
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-muted">No insights match this filter.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((insight) => (
            <div
              key={insight.id}
              className="rounded-lg border border-border bg-white p-4"
            >
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    insight.verdict_tier === "robust"
                      ? "bg-success-light text-success"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {insight.verdict_tier === "robust"
                    ? "Robust"
                    : "Use with caution"}
                </span>
                {insight.theme && (
                  <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {insight.theme}
                  </span>
                )}
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    insight.from_report
                      ? "bg-primary-light text-primary"
                      : "bg-indigo-50 text-indigo-700"
                  }`}
                >
                  {insight.from_report
                    ? "From the report"
                    : "New, found by the Elevator"}
                </span>
                {insight.caveats.map((caveat) => (
                  <span
                    key={caveat}
                    title={caveat}
                    className="inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                  >
                    {caveatLabel(caveat)}
                  </span>
                ))}
                {insight.support_status !== "current" && (
                  <span
                    data-testid="pre-insight-support"
                    data-support-status={insight.support_status}
                    title={insight.support_summary ?? undefined}
                    className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      insight.support_status === "invalid" ? "bg-danger-light text-danger" : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {SUPPORT_STATUS_LABEL[insight.support_status]}
                  </span>
                )}
                {insight.written_for_earlier_decisions && (
                  <span
                    title="The accepted decisions changed after this insight was written; it has not been rewritten for the current ones."
                    className="inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                  >
                    {EARLIER_DECISIONS_LABEL}
                  </span>
                )}
              </div>
              {verificationCaption(insight.verification_basis, inputState) && (
                <p className="mb-1.5 text-xs italic text-slate-500">
                  {verificationCaption(insight.verification_basis, inputState)}
                </p>
              )}
              <div className="mb-2 text-sm font-semibold text-foreground">
                {insight.headline}
              </div>
              <FigureCheckFor kind="preInsights" id={insight.id} />
              <dl className="space-y-1.5 text-sm">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Observation
                  </dt>
                  <dd className="text-foreground">{insight.observation}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Tension
                  </dt>
                  <dd className="text-foreground">{insight.tension}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Implication
                  </dt>
                  <dd className="text-foreground">{insight.implication}</dd>
                </div>
              </dl>
              <div className="mt-2 border-t border-border pt-2 text-xs text-muted">
                From: &ldquo;{insight.finding_text}&rdquo;
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
