// A finding's CURRENT verdict: its latest verification, newest created_at first and then the larger
// id, the order finding_support_parts() (migration 0096) records in support snapshots. Verification
// can run more than once for a finding (re-verify, a stated insight's chain trace, a rewrite), and
// the older rows stay in the table as history.
//
// Golden-thread follow-up (2026-10-17): several readers joined `verdicts` directly. A finding with
// more than one verdict then appeared once per verdict, and a filter on the tier (robust,
// use_with_caution) could pass on an OLDER verdict while the latest refused the finding
// (not_supported, insufficient_information). The insight generator was fixed first (7d12593);
// this is the same rule for every other reader that means "the finding's verdict now".
//
// Not for history: findingArchive.ts copies every verdict on purpose.

/** SQL ORDER BY clause selecting the latest verdict first (alias the verdicts table as `alias`). */
export function latestVerdictOrder(alias: string): string {
  return `${alias}.created_at desc, ${alias}.id desc`;
}

/**
 * A lateral subquery yielding at most one row: the latest verdict of `findingIdExpr`, with the
 * listed `columns` of the verdicts table. Use as `join ${latestVerdictLateral(...)} v on true` (only
 * findings that have a verdict) or `left join ... v on true` (all findings, verdict columns null
 * when there is none).
 */
export function latestVerdictLateral(findingIdExpr: string, columns: string[]): string {
  const cols = columns.map((c) => `lv.${c}`).join(", ");
  return `lateral (select ${cols} from verdicts lv where lv.finding_id = ${findingIdExpr} order by ${latestVerdictOrder("lv")} limit 1)`;
}
