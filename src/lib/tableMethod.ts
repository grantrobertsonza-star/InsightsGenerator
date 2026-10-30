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

/** The engine's workbook label reader (api/parse-stats-file.py LABEL_READER; tableMethod.test.ts keeps them equal).
 * "2026.10.29" (R1): a labels sheet headed "value_label" is read by that column. */
export const CURRENT_LABEL_READER = "2026.10.29";

/** "current" when the table was built with the current method; "earlier" otherwise, including no record. */
export type TableMethodStatus = "current" | "earlier";

/** Where a table was read from and with which label reader (its provenance's sourceFile, its notes' labelReader). */
export type TableSource = { sourceFile?: string | null; labelReader?: string | null };

const isWorkbook = (f: string | null | undefined) => !!f && /\.(?:xlsx|xls)$/i.test(f);

/**
 * A table from a workbook read before the label reader repair (R1, Codex R1-F01) may carry merged answers, so it is
 * "earlier" whatever its method version. Tables from any other format did not change. Without its source the
 * table is judged on its method version alone (a caller that cannot say where it came from).
 */
export function tableMethodStatus(methodVersion: string | null | undefined, source?: TableSource): TableMethodStatus {
  if (methodVersion !== CURRENT_TABLE_METHOD) return "earlier";
  if (source && isWorkbook(source.sourceFile) && source.labelReader !== CURRENT_LABEL_READER) return "earlier";
  return "current";
}

/** Why a table counts as earlier, in words: the workbook label repair, or the cross tab rules. */
export function earlierMethodText(methodVersion: string | null | undefined, source?: TableSource): string {
  if (methodVersion === CURRENT_TABLE_METHOD && source && isWorkbook(source.sourceFile) && source.labelReader !== CURRENT_LABEL_READER) return WORKBOOK_LABELS_TEXT;
  return EARLIER_METHOD_TEXT;
}

/** What changed, in words, for a badge's title, a finding's note and a support reason. */
export const EARLIER_METHOD_TEXT =
  "built before the cross tab rules were last updated (28 October 2026): row percentages and shares of responses are now calculated from unrounded weighted counts (small or fractional weights could shift them before), shares are tested with the two groups pooled, and answers labelled like \"DontKnow\" or \"Not_applicable\" are left out of the bases. Rebuild the table to update its figures";

/** A workbook table read before the label reader repair (R1, 29 October 2026). */
export const WORKBOOK_LABELS_TEXT =
  "read from its workbook before the labels sheet was read correctly (29 October 2026): when that sheet's header is written \"value_label\", every answer took the question's label and answers with the same label were merged into one. Rebuild the table to update its labels and figures";

