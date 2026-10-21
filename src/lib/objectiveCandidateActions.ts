"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { generateObjectiveCandidates } from "./objectiveFramer";
import { syncResearchObjective } from "./runSync";
import { refreshObjectiveQuality } from "./objectiveQualityScorer";
import { refreshObjectiveValidationQuietly } from "./objectiveValidator";
import { normalizeObjectiveLine, objectiveIdentityKey, parseObjectiveLines } from "./objectiveLines";
import { requireTenantId } from "./requestContext";

/** A refused objective action, returned rather than thrown so its wording reaches the researcher. */
// On a conflict, `currentText` is the objective's wording as stored now (null when it was deleted),
// read under the same lock as the refusal, so the editor can show it without waiting for a refresh.
export type ObjectiveActionResult = { ok: true } | { ok: false; error: string; conflict: boolean; currentText?: string | null };

const REVIEW_EDIT_CONFLICT =
  "This objective was changed or removed after you opened it, so your edit was not saved. Your wording is still in the box: use the current wording, or replace it with yours.";

/**
 * Accepts a candidate, optionally with edited wording. `expectedText` is the wording the editor
 * opened with (GT500-F03): when the candidate now says something else, or is gone, the edit is
 * refused as a conflict instead of overwriting another editor's change. The run row is locked
 * first, the same order editStatedObjective uses, so a Review edit and a Setup edit of the same
 * objective are serialized and the second one sees the first.
 */
export async function acceptObjectiveCandidate(runId: string, candidateId: string, editedText?: string, expectedText?: string): Promise<ObjectiveActionResult> {
  const TENANT_ID = await requireTenantId();
  const refused = await withTenant(TENANT_ID, async (client): Promise<ObjectiveActionResult | null> => {
    const owned = await client.query("select id from runs where id = $1 and tenant_id = $2 for update", [runId, TENANT_ID]);
    if (!owned.rowCount) return { ok: false, error: "This project was not found.", conflict: false };
    const result = await client.query<{ candidate_text: string; source: string }>(
      "select candidate_text, source from objective_candidates where id = $1 and run_id = $2 for update",
      [candidateId, runId]
    );
    const candidate = result.rows[0];
    if (!candidate) return { ok: false, error: "This objective is no longer in the project; it may have been deleted. Reload to see the current list.", conflict: true, currentText: null };
    if (expectedText !== undefined && normalizeObjectiveLine(candidate.candidate_text) !== normalizeObjectiveLine(expectedText)) {
      return { ok: false, error: REVIEW_EDIT_CONFLICT, conflict: true, currentText: candidate.candidate_text };
    }

    // OBJ-SET-001/M02: this used to only trim the edit, while Setup's own edit path
    // (editStatedObjective in runContextActions.ts) strips a leading bullet/number/hyphen
    // through normalizeObjectiveLine before ever storing or matching against candidate_text.
    // A Review edit that kept its typed marker ("- B" saved as "- B", not "B") then could
    // never be found by Setup's later trim()-based match against the same column, so a
    // subsequent Setup edit of that same objective added a brand-new candidate instead of
    // updating the one Review had already changed - which is exactly the "Review keeps the
    // old line, Setup has only the new one" divergence this finding described. Normalizing
    // here the same way keeps candidate_text in the one normalized form every reader of this
    // column already assumes it is in.
    const normalizedEdit = editedText ? normalizeObjectiveLine(editedText) : "";
    const finalText = normalizedEdit || candidate.candidate_text;
    const wasEdited = Boolean(normalizedEdit && normalizedEdit !== candidate.candidate_text);

    // edited is OR'd in, never overwritten outright (OBJ-REV-004): the plain Accept button
    // (useObjectiveRowActions.ts) calls this with no editedText at all, e.g. when
    // re-accepting a candidate that was previously unaccepted back to pending - wasEdited
    // computes false in that call, and writing it straight into the column used to erase
    // the fact that candidate_text already holds edited wording from an earlier save,
    // losing the "Edited" badge and, were it ever unaccepted again, wrongly making the
    // generateObjectiveCandidates regenerate-guard above treat it as untouched. A candidate's
    // wording can only move further from the original suggestion over time, never back, so
    // edited has no legitimate path from true to false.
    await client.query(
      "update objective_candidates set status = 'accepted', candidate_text = $1, edited = edited or $2 where id = $3",
      [finalText, wasEdited, candidateId]
    );

    // runs.stated_objectives_text (OBJ-SET-M01's "current mutable list") is otherwise only
    // ever written by Setup's own save/edit actions (runContextActions.ts), which match a
    // line by its exact trimmed text rather than this row's stable id. An edit made here, on
    // Review, used to leave that text column holding the pre-edit wording - Setup then read
    // and displayed the stale line, and a subsequent edit made there, no longer finding a
    // match for what Review had already changed, added the researcher's correction as a
    // brand-new line instead of replacing it (OBJ-SET-001). Replacing the one line that
    // actually changed - using the exact pre-edit text this same query already has, not a
    // re-guess from current state - is what keeps the two views of the same objective in
    // sync without needing a wider, schema-level rework of how either reads the other.
    if (wasEdited && candidate.source === "researcher_authored") {
      const r = await client.query<{ stated_objectives_text: string | null }>(
        "select stated_objectives_text from runs where id = $1",
        [runId],
      );
      const lines = parseObjectiveLines(r.rows[0]?.stated_objectives_text ?? null);
      const idx = lines.indexOf(normalizeObjectiveLine(candidate.candidate_text));
      if (idx >= 0) {
        lines[idx] = finalText;
        await client.query("update runs set stated_objectives_text = $1, updated_at = now() where id = $2", [
          lines.join("\n") || null,
          runId,
        ]);
      }
    }

    await syncResearchObjective(client, runId);
    return null;
  });
  if (refused) return refused;

  await refreshObjectiveQuality(TENANT_ID, runId);
  await refreshObjectiveValidationQuietly(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
  return { ok: true };
}

/**
 * Accepts every candidate still pending, exactly as each stands (no text
 * edits happen here). Rejected and already-accepted candidates are left
 * alone.
 */
export async function acceptAllObjectiveCandidates(runId: string) {
  const TENANT_ID = await requireTenantId();
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update objective_candidates set status = 'accepted' where run_id = $1 and status = 'pending'", [
      runId,
    ]);
    await syncResearchObjective(client, runId);
  });
  await refreshObjectiveQuality(TENANT_ID, runId);
  await refreshObjectiveValidationQuietly(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
}

/**
 * Permanently discards every candidate still pending, the same
 * can't-be-undone move as deleting one individually, just for the whole
 * batch at once. Accepted and already-rejected candidates are untouched.
 */
export async function deleteAllObjectiveCandidates(runId: string) {
  const TENANT_ID = await requireTenantId();
  await withTenant(TENANT_ID, async (client) => {
    await client.query("delete from objective_candidates where run_id = $1 and status = 'pending'", [runId]);
  });
  revalidatePath(`/runs/${runId}`);
}

/**
 * Reverses an acceptance back to pending, for an ai_suggested candidate a
 * researcher accepted and now wants to leave as a suggestion again rather
 * than reject outright. Added for OBJ-REV-M02: both review presentations'
 * "Unaccept" button previously called restoreObjectiveCandidate, which only
 * performs the rejected -> accepted transition, so clicking it on an
 * already-accepted candidate silently did nothing. Scoped to candidates
 * currently accepted, so calling it on anything else is a no-op rather than
 * an unintended transition.
 */
export async function unacceptObjectiveCandidate(runId: string, candidateId: string) {
  const TENANT_ID = await requireTenantId();
  await withTenant(TENANT_ID, async (client) => {
    await client.query(
      "update objective_candidates set status = 'pending' where id = $1 and run_id = $2 and status = 'accepted'",
      [candidateId, runId]
    );
    await syncResearchObjective(client, runId);
  });
  await refreshObjectiveQuality(TENANT_ID, runId);
  await refreshObjectiveValidationQuietly(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
}

export async function rejectObjectiveCandidate(runId: string, candidateId: string) {
  const TENANT_ID = await requireTenantId();
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update objective_candidates set status = 'rejected' where id = $1 and run_id = $2", [
      candidateId,
      runId,
    ]);
    await syncResearchObjective(client, runId);
  });
  // Quality and coverage were computed with this objective in play; refresh
  // them so the panels do not show a stale verdict.
  await refreshObjectiveQuality(TENANT_ID, runId);
  await refreshObjectiveValidationQuietly(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
}

/**
 * Puts a rejected candidate back into play. Restores it straight to
 * accepted, not to a pending state someone then has to accept again. This
 * is a deliberate choice about what "restore" itself means, not a mirror
 * of some universal starting status: a candidate's initial status is
 * conditional (see generateObjectiveCandidates in objectiveFramer.ts,
 * OBJ-REV-M01 - it can land 'pending' when a stated objective already
 * exists), so restore does not recreate whatever status this candidate
 * happened to start at. Rejecting, then restoring, is its own explicit
 * pair of human actions and is treated as an un-reject, landing accepted
 * regardless of the candidate's original initial status.
 */
export async function restoreObjectiveCandidate(runId: string, candidateId: string) {
  const TENANT_ID = await requireTenantId();
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update objective_candidates set status = 'accepted' where id = $1 and run_id = $2", [
      candidateId,
      runId,
    ]);
    await syncResearchObjective(client, runId);
  });
  await refreshObjectiveQuality(TENANT_ID, runId);
  await refreshObjectiveValidationQuietly(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
}

/**
 * Written as already accepted, same reasoning as addOwnDecisionCandidate:
 * typing this in is the deliberate act of adding it to the run, so there's
 * no separate accept click to make the researcher do afterward. They can
 * still reject it like anything else if they change their mind.
 *
 * Identity (GT500-P01): the same objectiveIdentityKey Set objectives' fill and the quality
 * scorer use, so "Measure rural demand." and "measure rural demand" are one objective at every
 * entry point. Adding one whose key matches a pending or accepted objective, of any source, is
 * refused with a message naming it, and nothing is added (a repeated request after a first that
 * succeeded gets the same message). Matching a rejected objective does not block the add:
 * typing it in again is the researcher's deliberate re-add, a new accepted candidate beside the
 * rejected one (Restore on Review brings the original back instead).
 */
export async function addOwnObjectiveCandidate(runId: string, candidateText: string): Promise<ObjectiveActionResult> {
  const TENANT_ID = await requireTenantId();
  const text = normalizeObjectiveLine(candidateText);
  const key = objectiveIdentityKey(text);
  if (!key) return { ok: false, error: "Type an objective to add.", conflict: false };

  const refused = await withTenant(TENANT_ID, async (client): Promise<ObjectiveActionResult | null> => {
    // The owned run row is locked, so the duplicate check, the insert and the wording sync are one
    // step for concurrent requests too (migration 0083's index only covers exact trimmed text).
    const owned = await client.query("select id from runs where id=$1 and tenant_id=$2 for update", [runId, TENANT_ID]);
    if (!owned.rowCount) throw new Error("This project is not available for adding objectives.");
    const existing = await client.query<{ candidate_text: string; status: string; source: string }>(
      `select candidate_text, status, source from objective_candidates where run_id = $1 and status <> 'rejected' order by created_at, id`,
      [runId],
    );
    const same = existing.rows.find((r) => objectiveIdentityKey(r.candidate_text) === key);
    if (same) {
      const where = same.status === "pending" ? (same.source === "ai_suggested" ? "a suggestion waiting for review" : "waiting for review") : "already accepted";
      return {
        ok: false,
        error: `Not added: "${same.candidate_text}" is already in this project (${where}). Edit that one if the wording should change.`,
        conflict: false,
      };
    }
    await client.query(
      `insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status)
       values ($1, $2, $3, 'Written directly by the researcher.', 'researcher_authored', 'accepted')`,
      [TENANT_ID, runId, text],
    );
    await syncResearchObjective(client, runId);
    return null;
  });
  if (refused) return refused;

  await refreshObjectiveQuality(TENANT_ID, runId);
  await refreshObjectiveValidationQuietly(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
  return { ok: true };
}

/**
 * Deleting an accepted candidate re-syncs runs.research_objective from
 * whatever else is still accepted, rather than leaving it pointing at text
 * that no longer exists anywhere as a candidate.
 *
 * OBJ-SET-001/003: that sync only ever touched research_objective, never
 * stated_objectives_text (Setup's own current mutable list, OBJ-SET-M01) - the same gap
 * acceptObjectiveCandidate's edit path above already had to close for an edit, but deleting
 * a candidate here left its line sitting in Setup's list with nothing in Review to show it
 * was gone: a deleted objective kept appearing as current there, and a later edit of that
 * now-orphaned line in Setup had no candidate row left to reconcile against. The candidate's
 * text has to be read BEFORE the delete, not after, since the delete is what removes the one
 * thing needed to find its matching line.
 */
export async function deleteObjectiveCandidate(runId: string, candidateId: string) {
  const TENANT_ID = await requireTenantId();
  await withTenant(TENANT_ID, async (client) => {
    const result = await client.query<{ candidate_text: string; source: string }>(
      "select candidate_text, source from objective_candidates where id = $1 and run_id = $2",
      [candidateId, runId]
    );
    const candidate = result.rows[0];

    await client.query("delete from objective_candidates where id = $1 and run_id = $2", [candidateId, runId]);

    if (candidate && candidate.source === "researcher_authored") {
      const r = await client.query<{ stated_objectives_text: string | null }>(
        "select stated_objectives_text from runs where id = $1",
        [runId],
      );
      const lines = parseObjectiveLines(r.rows[0]?.stated_objectives_text ?? null);
      const idx = lines.indexOf(normalizeObjectiveLine(candidate.candidate_text));
      if (idx >= 0) {
        lines.splice(idx, 1);
        await client.query("update runs set stated_objectives_text = $1, updated_at = now() where id = $2", [
          lines.length > 0 ? lines.join("\n") : null,
          runId,
        ]);
      }
    }

    await syncResearchObjective(client, runId);
  });
  await refreshObjectiveQuality(TENANT_ID, runId);
  await refreshObjectiveValidationQuietly(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
}

export async function regenerateObjectiveCandidates(
  runId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const TENANT_ID = await requireTenantId();
  try {
    await generateObjectiveCandidates(TENANT_ID, runId);
    await refreshObjectiveQuality(TENANT_ID, runId);
  await refreshObjectiveValidationQuietly(TENANT_ID, runId);
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

/**
 * Removes every objective the app suggested or inferred that the researcher
 * has not edited. Stated objectives (typed or imported) and anything edited
 * or rejected are left alone.
 */
export async function deleteSuggestedObjectives(runId: string) {
  const TENANT_ID = await requireTenantId();
  await withTenant(TENANT_ID, async (client) => {
    await client.query(
      `delete from objective_candidates
       where run_id = $1 and source = 'ai_suggested' and status != 'rejected' and edited = false`,
      [runId]
    );
    await syncResearchObjective(client, runId);
  });
  revalidatePath(`/runs/${runId}`);
}
