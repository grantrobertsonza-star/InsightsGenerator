import type { PoolClient } from "pg";

/**
 * Both objectives and decisions work the same way: a run can genuinely have
 * more than one accepted at once (an objective rarely stands entirely
 * alone, and a project can be organized around more than one decision), so
 * there is no single "the accepted one" slot. runs.research_objective and
 * runs.decision_statement stay single text columns regardless, since
 * that's what the framers, the insight generator, and the recommendation
 * agent all read as "the objective(s)/decision(s) this project is judged
 * against". These two helpers keep each column in sync with whichever
 * candidates are currently accepted: their text joined together (numbered
 * once there's more than one), or null once none are accepted. Ties on created_at (two saved
 * in the same instant) are broken by id, so the numbering does not change between syncs; the
 * objective and decision loaders in objectiveValidator.ts and objectiveEvidence.ts use the same
 * tie-break.
 *
 * Shared between the candidate-action files (a researcher accepting,
 * rejecting, or restoring one by hand) and the framers themselves (which
 * now insert their suggestions as already-accepted, so the run's column
 * needs the same sync the moment they land, not only on a later manual
 * accept). Kept in their own module, rather than defined in the actions
 * files and imported from the framers, purely to avoid a circular import
 * between a framer and the actions file that already imports that framer.
 */
/**
 * Codex OBJ500-F01: every change to a run's objective or decision candidates, or to its stated
 * objectives list, takes the owned run row FOR UPDATE first, before it changes a candidate or reads
 * a list to rebuild. The syncs below read every accepted candidate and write one statement; two
 * transactions changing different candidates used to each read the accepted set while the other's
 * change was uncommitted, so the last writer saved a statement naming an objective just unaccepted,
 * rejected or deleted (and a deletion could undo the other's change to the stated list). With the
 * lock first, the second transaction waits, then reads (READ COMMITTED: each statement sees what was
 * committed before it) the first one's result. Locking only the final update is not enough: the
 * statement would already be computed from the old view. One order everywhere (run row, then
 * candidate rows) also keeps these paths from deadlocking each other. The lock query is the
 * ownership check: no row for this tenant means nothing is changed.
 */
export async function lockRunForContextChange(client: PoolClient, runId: string, tenantId: string): Promise<void> {
  const owned = await client.query("select id from runs where id = $1 and tenant_id = $2 for update", [runId, tenantId]);
  if (!owned.rowCount) throw new Error("That project is not available.");
}

export async function syncResearchObjective(client: PoolClient, runId: string) {
  const result = await client.query<{ candidate_text: string }>(
    "select candidate_text from objective_candidates where run_id = $1 and status = 'accepted' order by (source = 'ai_suggested'), created_at, id",
    [runId]
  );
  const texts = result.rows.map((r) => r.candidate_text);
  const joined =
    texts.length === 0
      ? null
      : texts.length === 1
        ? texts[0]
        : texts.map((text, i) => `${i + 1}. ${text}`).join("\n");

  await client.query("update runs set research_objective = $1, updated_at = now() where id = $2", [
    joined,
    runId,
  ]);
}

export async function syncDecisionStatement(client: PoolClient, runId: string) {
  const result = await client.query<{ candidate_text: string }>(
    "select candidate_text from decision_candidates where run_id = $1 and status = 'accepted' order by created_at, id",
    [runId]
  );
  const texts = result.rows.map((r) => r.candidate_text);
  const joined =
    texts.length === 0
      ? null
      : texts.length === 1
        ? texts[0]
        : texts.map((text, i) => `${i + 1}. ${text}`).join("\n");

  await client.query("update runs set decision_statement = $1, updated_at = now() where id = $2", [
    joined,
    runId,
  ]);
}
