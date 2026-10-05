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
 * once there's more than one), or null once none are accepted.
 *
 * Shared between the candidate-action files (a researcher accepting,
 * rejecting, or restoring one by hand) and the framers themselves (which
 * now insert their suggestions as already-accepted, so the run's column
 * needs the same sync the moment they land, not only on a later manual
 * accept). Kept in their own module, rather than defined in the actions
 * files and imported from the framers, purely to avoid a circular import
 * between a framer and the actions file that already imports that framer.
 */
export async function syncResearchObjective(client: PoolClient, runId: string) {
  const result = await client.query<{ candidate_text: string }>(
    "select candidate_text from objective_candidates where run_id = $1 and status = 'accepted' order by created_at",
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
    "select candidate_text from decision_candidates where run_id = $1 and status = 'accepted' order by created_at",
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
