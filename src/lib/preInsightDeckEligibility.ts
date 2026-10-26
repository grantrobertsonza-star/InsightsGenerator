// Which pre-insights the pre-insights slide deck shows, and how each is labelled.
//
// A pre-insight is drafted only from a finding that was not rejected and whose verdict was
// 'robust' or 'use_with_caution' (insightGenerator.ts). Both can change afterwards: the finding can
// be rejected, or re-verification can store a new verdict. The deck therefore re-applies the same
// rule to the CURRENT state (latest verdict, current finding status):
//   included  latest verdict robust / use_with_caution and finding not rejected, labelled by tier
//   excluded  everything else, listed on a closing slide with the reason, never silently dropped
// Every verdict tier has a label, and an unrecognised or missing verdict is excluded with its own
// reason rather than crashing the export (the earlier deck threw a 500 on any tier it did not map).

export type DeckVerdictTier = "robust" | "use_with_caution" | "not_supported" | "insufficient_information";

export type DeckPreInsightRow = {
  verdict_tier: string | null;
  finding_status: string | null;
};

export type DeckPlacement =
  | { include: true; tier: "robust" | "use_with_caution"; label: string; color: string }
  | { include: false; reason: string };

const INCLUDED: Record<"robust" | "use_with_caution", { label: string; color: string }> = {
  robust: { label: "Robust", color: "16A34A" },
  use_with_caution: { label: "Use with caution", color: "D97706" },
};

const EXCLUDED_REASON: Record<"not_supported" | "insufficient_information", string> = {
  not_supported: "its finding is no longer supported by the data",
  insufficient_information: "there is not enough information to verify its finding",
};

export function placePreInsight(row: DeckPreInsightRow): DeckPlacement {
  if (row.finding_status === "rejected") return { include: false, reason: "its finding was rejected" };
  const tier = row.verdict_tier;
  if (tier === null) return { include: false, reason: "its finding has no verification verdict" };
  if (tier === "robust" || tier === "use_with_caution") return { include: true, tier, ...INCLUDED[tier] };
  if (tier === "not_supported" || tier === "insufficient_information") return { include: false, reason: EXCLUDED_REASON[tier] };
  return { include: false, reason: `its finding has an unrecognised verdict ("${tier}")` };
}
