import type { PoolClient } from "pg";

/**
 * The comparison key for a candidate's wording: the text with leading and trailing whitespace
 * removed (spaces, tabs, line breaks and other Unicode whitespace, as String.prototype.trim does).
 * Inner wording, case and punctuation are kept, so "Grow share" and "Grow  share" or "grow share"
 * stay distinct candidates; this does not attempt semantic matching. It is a key only: stored
 * wording is never rewritten with it.
 *
 * Both sides of the comparison must go through this one function. Comparing SQL trim() of stored
 * text (spaces only) with a JavaScript trim of new text (all whitespace) let rejected wording that
 * ends in a tab or line break slip back in.
 */
export function candidateWordingKey(text: string): string {
  return text.trim();
}

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
 * Wording identity is candidateWordingKey, applied in this process to both the stored rows and
 * the new suggestions. Duplicates within one model answer collapse to the first occurrence.
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
  const existing = await client.query<{ candidate_text: string }>(
    `select candidate_text from ${table} where run_id = $1`,
    [runId],
  );
  const taken = new Set(existing.rows.map((r) => candidateWordingKey(r.candidate_text)));
  const kept: T[] = [];
  for (const suggestion of suggestions) {
    const key = candidateWordingKey(suggestion.candidate_text);
    if (taken.has(key)) continue;
    taken.add(key);
    kept.push(suggestion);
  }
  return kept;
}
