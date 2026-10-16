import type { PoolClient } from "pg";

/**
 * Which model suggestions a regeneration may insert.
 *
 * A regeneration first removes the run's undecided AI suggestions, then inserts the model's new
 * ones. Whatever is still on the run at that point is a human outcome or human work: a rejected
 * suggestion, an accepted or edited one, or the researcher's own text. A model that proposes the
 * same wording again must not bring that back as a fresh row, because:
 *   - a rejected suggestion would reappear as pending (objectives) or even as accepted and enter
 *     runs.decision_statement (decisions), silently undoing the researcher's rejection;
 *   - an accepted or researcher-authored one would be duplicated.
 *
 * Identity is the trimmed text, the same rule the researcher-text unique index (0083) and the own
 * add/duplicate guards use. Wording that differs only in case or punctuation is a different
 * candidate; this does not attempt semantic matching. Duplicates within one model answer are also
 * collapsed to the first occurrence.
 *
 * Must run on the regeneration's own client, after its delete and inside its transaction, so the
 * check sees exactly the rows that will remain. It does not serialise two concurrent
 * regenerations of the same run against each other.
 */
export async function suggestionsNotAlreadyOnRun<T extends { candidate_text: string }>(
  client: PoolClient,
  table: "objective_candidates" | "decision_candidates",
  runId: string,
  suggestions: T[],
): Promise<T[]> {
  const existing = await client.query<{ t: string }>(
    `select trim(candidate_text) as t from ${table} where run_id = $1`,
    [runId],
  );
  const taken = new Set(existing.rows.map((r) => r.t));
  const kept: T[] = [];
  for (const suggestion of suggestions) {
    const key = suggestion.candidate_text.trim();
    if (taken.has(key)) continue;
    taken.add(key);
    kept.push(suggestion);
  }
  return kept;
}
