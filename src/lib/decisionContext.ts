// An insight records the accepted decisions it was written for (decision_context, a copy of
// runs.decision_statement at the time). The insight refresh only writes insights for findings
// that have none, so after the accepted decisions change an existing insight keeps describing
// the earlier ones, and so do the recommendations built on it. Rewriting them is not done
// automatically: deleting an insight would also delete the recommendations a researcher reviewed
// and the synthesized-insight support links built on it. Instead they are marked, using this one
// rule, until the decisions match again (where, below).
//
// "Written for earlier decisions": the insight recorded a decision context and it differs from
// the run's current statement, ignoring leading and trailing whitespace. An insight that recorded
// none (a "generate" run before any decision was accepted) was not framed against a decision, so
// it is not marked. If every decision is later removed, a recorded context differs from the empty
// statement and is marked.
//
// Where it is shown: the decisions panel (a count of per-finding and synthesized insights and the
// recommendations built on them), each pre-insight card, and the pre-insights Excel export.
//
// Limitations: recommendations store no decision snapshot of their own; one is treated as written
// for earlier decisions exactly when the insight it is built on is. Synthesized-insight cards,
// recommendation lists, decks and the narrative do not yet carry a per-item mark; the panel count
// is their only qualification.

/** SQL predicate over an insight's decision_context column and the run's decision_statement. */
export function writtenForEarlierDecisionsSql(contextColumn: string, statementColumn: string): string {
  return `(${contextColumn} is not null and btrim(${contextColumn}) is distinct from btrim(${statementColumn}))`;
}

export const EARLIER_DECISIONS_LABEL = "Written for earlier decisions";
