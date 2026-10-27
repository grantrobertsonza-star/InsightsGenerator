// Table method freshness (batch 47, Grant 27 October 2026). The engine records in every table's notes the
// version of the rules that decided its figures and flags (api/parse-stats-file.py TABLE_METHOD, notes
// .methodVersion). A table recorded with another version, or with none because it was built before the
// version was recorded, was built under rules that can give different figures or flags, so it is reported
// as built with an earlier method until it is rebuilt. Nothing is recalculated automatically, so human
// review recorded against the table and its findings is kept (the same "flag, never silently
// recalculate" rule the design and corrections checks follow).
//
// "2026.10.27": shares tested pooled under the null hypothesis, and run-together non-answer labels
// ("DontKnow", "Not_applicable") left out of bases and banners. tableMethod.test.ts checks this constant
// equals the engine's, so the two cannot drift apart.

export const CURRENT_TABLE_METHOD = "2026.10.27";

/** "current" when the table was built with the current method; "earlier" otherwise, including no record. */
export type TableMethodStatus = "current" | "earlier";

export function tableMethodStatus(methodVersion: string | null | undefined): TableMethodStatus {
  return methodVersion === CURRENT_TABLE_METHOD ? "current" : "earlier";
}

/** What changed, in words, for a badge's title, a finding's note and a support reason. */
export const EARLIER_METHOD_TEXT =
  "built before the significance test and the don't know rules were updated (27 October 2026): shares are now tested with the two groups pooled, and answers labelled like \"DontKnow\" or \"Not_applicable\" are left out of the bases. Rebuild the table to update its figures";
