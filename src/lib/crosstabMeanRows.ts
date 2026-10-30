import type { CrosstabResult } from "./parseStatsFile";

/**
 * Batch 48: the table without the mean rows the Mean setting added (rows marked autoMean), for a screen
 * or export where the researcher has unticked Mean on a built table. Mean rows the researcher defined
 * as groups are kept, so are every other row, and the table's figures are not recalculated.
 */
export function withoutMeanTickRows(result: CrosstabResult): CrosstabResult {
  return { ...result, questions: result.questions.map((q) => ({ ...q, rows: q.rows.filter((r) => !r.autoMean) })) };
}
