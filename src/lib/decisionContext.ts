import type { PoolClient } from "pg";

// Insights and AI recommendations each record the accepted decisions they were written for
// (decision_context, a copy of runs.decision_statement when they were generated). The refreshes
// only write what is missing, so after the accepted decisions change, existing ones keep
// describing the earlier decisions. Rewriting them is not done automatically: deleting an insight
// would also delete the recommendations a researcher reviewed and the synthesized-insight support
// links built on it, and rewriting a recommendation would replace reviewed wording. Instead they
// are marked, using the rules below, until the decisions match again.
//
// Insights, "written for earlier decisions": the insight recorded a decision context and it
// differs from the run's current statement, ignoring leading and trailing whitespace. An insight
// that recorded none (a "generate" run before any decision was accepted) was not framed against a
// decision, so it is not marked. If every decision is later removed, a recorded context differs
// from the empty statement and is marked.
//
// Recommendations are judged on their own record, never inferred from their insight: the
// generator frames a recommendation against the decisions current when it runs, whatever its
// insight recorded (a pre-decision insight can carry a recommendation written for Decision A).
//   - AI recommendation with a recorded context (migration 0102): "earlier" when it differs from
//     the current statement, as for insights.
//   - AI recommendation with none (written before 0102, or 0102 not applied): "unknown". Its
//     decisions cannot be established, so it is qualified as such rather than assumed current.
//   - A recommendation the researcher wrote: not framed by the generator, no claim made.
// Rejected recommendations are out of use and not counted.
//
// Where it is shown: the decisions panel (counts of per-finding and synthesized insights, and of
// recommendations, earlier or unknown), each pre-insight card, and the pre-insights Excel export.
//
// Limitations: synthesized-insight cards, recommendation lists, decks and the narrative do not yet
// carry a per-item mark; the panel count is their only qualification.

/** SQL predicate over an insight's decision_context column and the run's decision_statement. */
export function writtenForEarlierDecisionsSql(contextColumn: string, statementColumn: string): string {
  return `(${contextColumn} is not null and btrim(${contextColumn}) is distinct from btrim(${statementColumn}))`;
}

/**
 * SQL for a recommendation's decision currentness: 'earlier', 'unknown', or null (current, or not
 * an AI recommendation). contextRecorded: whether recommendations.decision_context exists (0102).
 */
export function recommendationDecisionStateSql(alias: string, statementColumn: string, contextRecorded: boolean): string {
  if (!contextRecorded) return `(case when ${alias}.source = 'ai_suggested' then 'unknown' end)`;
  return `(case when ${alias}.source <> 'ai_suggested' then null
                when ${alias}.decision_context is null then 'unknown'
                when ${writtenForEarlierDecisionsSql(`${alias}.decision_context`, statementColumn)} then 'earlier' end)`;
}

let contextColumnConfirmed = false;
/** Whether migration 0102 (recommendations.decision_context) is applied. Positive result cached. */
export async function recommendationDecisionContextAvailable(client: PoolClient): Promise<boolean> {
  if (contextColumnConfirmed) return true;
  const r = await client.query<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'recommendations' and column_name = 'decision_context'`,
  );
  contextColumnConfirmed = r.rows[0]?.n === 1;
  return contextColumnConfirmed;
}

export const EARLIER_DECISIONS_LABEL = "Written for earlier decisions";
