// Table method freshness (batch 47, Grant 27 October 2026). The engine records in every table's notes the
// version of the rules that decided its figures and flags (api/parse-stats-file.py TABLE_METHOD, notes
// .methodVersion). A table recorded with another version, or with none because it was built before the
// version was recorded, was built under rules that can give different figures or flags, so it is reported
// as built with an earlier method until it is rebuilt. Nothing is recalculated automatically, so human
// review recorded against the table and its findings is kept (the same "flag, never silently
// recalculate" rule the design and corrections checks follow).
//
// "2026.10.27": shares tested pooled under the null hypothesis, and run-together non-answer labels
// ("DontKnow", "Not_applicable") left out of bases and banners.
// "2026.10.28" (batch 59, CT5K-F01): row % and share of responses divided from the unrounded weighted
// sums, not from counts rounded for display. A table recorded as "2026.10.27" is therefore "earlier" too.
// tableMethod.test.ts checks this constant equals the engine's, so the two cannot drift apart.

export const CURRENT_TABLE_METHOD = "2026.10.28";

/** "current" when the table was built with the current method; "earlier" otherwise, including no record. */
export type TableMethodStatus = "current" | "earlier";

export function tableMethodStatus(methodVersion: string | null | undefined): TableMethodStatus {
  return methodVersion === CURRENT_TABLE_METHOD ? "current" : "earlier";
}

/** What changed, in words, for a badge's title, a finding's note and a support reason. */
export const EARLIER_METHOD_TEXT =
  "built before the cross tab rules were last updated (28 October 2026): row percentages and shares of responses are now calculated from unrounded weighted counts (small or fractional weights could shift them before), shares are tested with the two groups pooled, and answers labelled like \"DontKnow\" or \"Not_applicable\" are left out of the bases. Rebuild the table to update its figures";
