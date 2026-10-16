// Golden-thread repair (narrative grounding): rules shared by every prompt that summarises or
// reframes evidence (decisionFramer's evidence synthesis, insightSynthesizer's reframing,
// storyNarrative's report narrative), so they cannot drift apart.
//
// Reproduction this generalises: a report claimed an average of 4.2 where the data computed 3.5 on
// the same scale; the claim had been verified as not supported, yet the run summary presented both
// as conflicting evidence and the narrative explained the gap as "different scales". Nothing in the
// evidence said so. The rule applies to any figure, scale, instrument or dataset.

/** Prompt text: discrepancies are reported, never explained by invented causes. */
export const NO_INVENTED_EXPLANATIONS_RULE =
  "When two figures for what appears to be the same measure disagree, never explain the gap by " +
  "assuming different scales, instruments, question wordings, samples, time periods or methods unless " +
  "the evidence itself states that difference. A figure computed from the data takes precedence over " +
  "a report's claim about it: describe a disagreeing claim as not supported by the data, not as a " +
  "second measurement.";

/** Plain-language status for one finding, as shown to a model alongside the finding's text. */
export function evidenceStatusLabel(input: {
  origin: string | null;
  verdictTier: string | null;
  verificationBasis: string | null;
}): string {
  if (input.origin === "generated") return "computed from the data";
  switch (input.verdictTier) {
    case "robust":
      return input.verificationBasis === "data_backed" ? "verified against the computed data" : "verified";
    case "use_with_caution":
      return input.verificationBasis === "data_backed"
        ? "verified against the computed data, use with caution"
        : "verified, use with caution";
    case "not_supported":
      return "NOT SUPPORTED by verification: a claim, not evidence";
    case "insufficient_information":
      return "unverified: not enough information to check it";
    default:
      return "not yet verified";
  }
}

/** Prompt text (narrative): figures are quoted, never derived. Enforced after generation by
 * numberTrace.ts; this rule only makes a rejected draft less likely. */
export const NO_DERIVED_FIGURES_RULE =
  "Use figures only as they appear in the accepted insights and recommendations below (rounding is " +
  "fine). Never compute a new figure from them: no new ranges, margins of error, plus-or-minus spreads, " +
  "differences, ratios or totals. If an estimate comes with an interval, keep the interval as given or " +
  "leave it out.";
