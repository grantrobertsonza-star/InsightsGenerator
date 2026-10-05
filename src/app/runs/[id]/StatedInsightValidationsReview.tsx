"use client";

import { useState } from "react";

type ChainTier = "robust" | "use_with_caution" | "not_supported" | "insufficient_information";

export type StatedInsightValidation = {
  id: string;
  finding_text: string;
  theme: string | null;
  verdict_tier: ChainTier | null;
  rationale: string | null;
  elevated_insight_id: string | null;
  cited_texts: string[];
  relied_texts: string[];
};

const TIER_LABEL: Record<ChainTier, string> = {
  robust: "Supported",
  use_with_caution: "Overreach",
  not_supported: "Contradicted",
  insufficient_information: "Unsupported",
};

const TIER_BADGE_CLASS: Record<ChainTier, string> = {
  robust: "bg-success-light text-success",
  use_with_caution: "bg-amber-50 text-amber-700",
  not_supported: "bg-rose-50 text-rose-700",
  insufficient_information: "bg-slate-100 text-slate-500",
};

type TierFilter = "all" | ChainTier | "pending";

/**
 * The "did the report's own claim hold up" surface: one row per
 * stated_insight finding (a higher-order interpretive claim extracted from
 * the client's own report or deck), each traced against the evidence that
 * is supposed to back it rather than just judged for plausibility, see
 * validateStatedInsights.ts. A claim with no verdict yet isn't a failure,
 * it's just still waiting on evidence elsewhere in the run to arrive
 * (shown as "Awaiting evidence" rather than lumped in with a real outcome).
 *
 * "Elevated" marks a claim that, having been traced and found to hold up,
 * went on to actually become one of this run's own insights (the same
 * eligibility path every other verified finding goes through) -- the
 * concrete answer to "this report's claim is not just plausible, it's now
 * one of ours too."
 */
export default function StatedInsightValidationsReview({
  validations,
  totalStatedInsights,
}: {
  validations: StatedInsightValidation[];
  totalStatedInsights: number;
}) {
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");

  if (totalStatedInsights === 0) {
    return (
      <p className="text-sm text-muted">
        None found. This section only appears once the report or deck being validated contains its own
        higher-order claims (a ranking, a cross-finding conclusion, a stated takeaway), not just discrete
        findings.
      </p>
    );
  }

  const supportedCount = validations.filter((v) => v.verdict_tier === "robust").length;
  const overreachCount = validations.filter((v) => v.verdict_tier === "use_with_caution").length;
  const contradictedCount = validations.filter((v) => v.verdict_tier === "not_supported").length;
  const unsupportedCount = validations.filter((v) => v.verdict_tier === "insufficient_information").length;
  const pendingCount = validations.filter((v) => v.verdict_tier === null).length;

  const filtered = validations.filter((v) => {
    if (tierFilter === "all") return true;
    if (tierFilter === "pending") return v.verdict_tier === null;
    return v.verdict_tier === tierFilter;
  });

  const tiles: { key: TierFilter; count: number; label: string; activeClass: string }[] = [
    { key: "all", count: validations.length, label: "Claims", activeClass: "border-primary bg-primary-light" },
    { key: "robust", count: supportedCount, label: "Supported", activeClass: "border-success bg-success-light" },
    { key: "use_with_caution", count: overreachCount, label: "Overreach", activeClass: "border-amber-400 bg-amber-50" },
    { key: "not_supported", count: contradictedCount, label: "Contradicted", activeClass: "border-rose-400 bg-rose-50" },
    { key: "insufficient_information", count: unsupportedCount, label: "Unsupported", activeClass: "border-slate-400 bg-slate-100" },
  ];
  if (pendingCount > 0) {
    tiles.push({ key: "pending", count: pendingCount, label: "Awaiting evidence", activeClass: "border-slate-300 bg-slate-50" });
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          Evidence-chain outcome
        </p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 sm:max-w-2xl">
          {tiles.map((tile) => (
            <button
              key={tile.key}
              type="button"
              onClick={() => setTierFilter((f) => (f === tile.key ? "all" : tile.key))}
              className={`rounded-lg border px-3 py-2 text-left transition ${
                tierFilter === tile.key ? tile.activeClass : "border-border bg-white hover:border-slate-300"
              }`}
            >
              <div className="text-lg font-semibold text-foreground">{tile.count}</div>
              <div className="text-xs text-muted">{tile.label}</div>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted">No claims match this filter.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((validation) => (
            <div key={validation.id} className="rounded-lg border border-border bg-white p-4">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    validation.verdict_tier ? TIER_BADGE_CLASS[validation.verdict_tier] : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {validation.verdict_tier ? TIER_LABEL[validation.verdict_tier] : "Awaiting evidence"}
                </span>
                {validation.theme && (
                  <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {validation.theme}
                  </span>
                )}
                {validation.elevated_insight_id && (
                  <span className="inline-block rounded bg-primary-light px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    Elevated to insight
                  </span>
                )}
              </div>
              <p className="text-sm font-medium text-foreground">&ldquo;{validation.finding_text}&rdquo;</p>
              {validation.rationale && (
                <p className="mt-2 text-sm text-muted">{validation.rationale}</p>
              )}
              {(validation.cited_texts.length > 0 || validation.relied_texts.length > 0) && (
                <div className="mt-3 space-y-2 border-t border-border pt-2">
                  {validation.cited_texts.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Report cited as support
                      </p>
                      <ul className="mt-1 space-y-1 text-xs text-foreground">
                        {validation.cited_texts.map((text, index) => (
                          <li key={index}>&ldquo;{text}&rdquo;</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {validation.relied_texts.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Evidence the check actually relied on
                      </p>
                      <ul className="mt-1 space-y-1 text-xs text-foreground">
                        {validation.relied_texts.map((text, index) => (
                          <li key={index}>&ldquo;{text}&rdquo;</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {!validation.verdict_tier && (
                <p className="mt-2 text-xs text-muted">
                  Nothing in this run&apos;s evidence yet addresses this claim either way; it will be checked
                  automatically once more findings are verified.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
