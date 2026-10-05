"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { generateObjectiveCandidates } from "./objectiveFramer";
import { syncResearchObjective } from "./runSync";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

export async function acceptObjectiveCandidate(runId: string, candidateId: string, editedText?: string) {
  await withTenant(TENANT_ID, async (client) => {
    const result = await client.query<{ candidate_text: string }>(
      "select candidate_text from objective_candidates where id = $1 and run_id = $2",
      [candidateId, runId]
    );
    const candidate = result.rows[0];
    if (!candidate) return;

    const trimmedEdit = editedText?.trim();
    const finalText = trimmedEdit || candidate.candidate_text;
    const wasEdited = Boolean(trimmedEdit && trimmedEdit !== candidate.candidate_text);

    await client.query(
      "update objective_candidates set status = 'accepted', candidate_text = $1, edited = $2 where id = $3",
      [finalText, wasEdited, candidateId]
    );
    await syncResearchObjective(client, runId);
  });

  revalidatePath(`/runs/${runId}`);
}

/**
 * Accepts every candidate still pending, exactly as each stands (no text
 * edits happen here). Rejected and already-accepted candidates are left
 * alone.
 */
export async function acceptAllObjectiveCandidates(runId: string) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update objective_candidates set status = 'accepted' where run_id = $1 and status = 'pending'", [
      runId,
    ]);
    await syncResearchObjective(client, runId);
  });
  revalidatePath(`/runs/${runId}`);
}

/**
 * Permanently discards every candidate still pending, the same
 * can't-be-undone move as deleting one individually, just for the whole
 * batch at once. Accepted and already-rejected candidates are untouched.
 */
export async function deleteAllObjectiveCandidates(runId: string) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("delete from objective_candidates where run_id = $1 and status = 'pending'", [runId]);
  });
  revalidatePath(`/runs/${runId}`);
}

export async function rejectObjectiveCandidate(runId: string, candidateId: string) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update objective_candidates set status = 'rejected' where id = $1 and run_id = $2", [
      candidateId,
      runId,
    ]);
    await syncResearchObjective(client, runId);
  });
  revalidatePath(`/runs/${runId}`);
}

/**
 * Puts a rejected candidate back into play. Restores it straight to
 * accepted, not to a pending state someone then has to accept again: since
 * everything starts accepted by default now, "restore" is just the
 * mirror of reject, an un-reject, not a second review step.
 */
export async function restoreObjectiveCandidate(runId: string, candidateId: string) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update objective_candidates set status = 'accepted' where id = $1 and run_id = $2", [
      candidateId,
      runId,
    ]);
    await syncResearchObjective(client, runId);
  });
  revalidatePath(`/runs/${runId}`);
}

/**
 * Written as already accepted, same reasoning as addOwnDecisionCandidate:
 * typing this in is the deliberate act of adding it to the run, so there's
 * no separate accept click to make the researcher do afterward. They can
 * still reject it like anything else if they change their mind.
 */
export async function addOwnObjectiveCandidate(runId: string, candidateText: string) {
  const text = candidateText.trim();
  if (!text) return;

  await withTenant(TENANT_ID, async (client) => {
    await client.query(
      `insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status)
       values ($1, $2, $3, 'Written directly by the researcher.', 'researcher_authored', 'accepted')`,
      [TENANT_ID, runId, text]
    );
    await syncResearchObjective(client, runId);
  });

  revalidatePath(`/runs/${runId}`);
}

/**
 * Deleting an accepted candidate re-syncs runs.research_objective from
 * whatever else is still accepted, rather than leaving it pointing at text
 * that no longer exists anywhere as a candidate.
 */
export async function deleteObjectiveCandidate(runId: string, candidateId: string) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("delete from objective_candidates where id = $1 and run_id = $2", [candidateId, runId]);
    await syncResearchObjective(client, runId);
  });
  revalidatePath(`/runs/${runId}`);
}

export async function regenerateObjectiveCandidates(
  runId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await generateObjectiveCandidates(TENANT_ID, runId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'objective_framer_error', $3)`,
        [TENANT_ID, runId, message]
      );
    }).catch(() => {});
    return { ok: false, error: message };
  }
}
