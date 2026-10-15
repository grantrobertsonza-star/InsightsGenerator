"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { generateObjectiveCandidates } from "./objectiveFramer";
import { syncResearchObjective } from "./runSync";
import { refreshObjectiveQuality } from "./objectiveQualityScorer";
import { refreshObjectiveValidationQuietly } from "./objectiveValidator";
import { normalizeObjectiveLine, parseObjectiveLines } from "./objectiveLines";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

export async function acceptObjectiveCandidate(runId: string, candidateId: string, editedText?: string) {
  await withTenant(TENANT_ID, async (client) => {
    const result = await client.query<{ candidate_text: string; source: string }>(
      "select candidate_text, source from objective_candidates where id = $1 and run_id = $2",
      [candidateId, runId]
    );
    const candidate = result.rows[0];
    if (!candidate) return;

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
  });

  await refreshObjectiveQuality(TENANT_ID, runId);
  await refreshObjectiveValidationQuietly(TENANT_ID, runId);
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
 */
export async function addOwnObjectiveCandidate(runId: string, candidateText: string) {
  const text = candidateText.trim();
  if (!text) return;

  await withTenant(TENANT_ID, async (client) => {
    // Idempotent on the exact same text (OBJ-SET-002: "repeated add requests create
    // duplicates"). A rejected candidate with the same text does not block a fresh add:
    // rejecting it was its own decision, not a reason to refuse the researcher adding it
    // again deliberately - migration 0083's partial unique index is scoped the same way.
    //
    // A pre-check-then-insert (the first version of this fix) is a race, not protection: two
    // concurrent identical requests - a double click, a retried submit after a slow response
    // - both pass the SELECT before either INSERT commits, and both land. Only a constraint
    // Postgres itself enforces at commit time actually closes that, so this now relies on
    // migration 0083's partial unique index via ON CONFLICT ... DO NOTHING, which no
    // concurrent pair of transactions can both get past.
    // OBJ-SET-002: withTenant runs this whole callback in one transaction on one client.
    // The ON CONFLICT insert below fails outright (not merely "no match") when migration
    // 0083 hasn't applied, because there is no such partial unique index for it to target -
    // and once ANY query errors inside a Postgres transaction, that transaction is aborted:
    // every further query on the same client fails with "current transaction is aborted,
    // commands ignored until end of transaction block" until a ROLLBACK happens. The
    // fallback's own SELECT/INSERT used to run straight into that aborted state (the catch
    // below only inspected the JS error, never rolled anything back), so a pre-migration
    // database didn't get a working check-then-insert fallback - it got a guaranteed second
    // failure on the fallback's first query, surfacing as an unhandled error instead of the
    // documented "not race-safe, but it works" degradation. A SAVEPOINT around the risky
    // insert gives the fallback a clean transaction to run its own queries in.
    await client.query("savepoint obj_cand_insert");
    try {
      const inserted = await client.query(
        `insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status)
         values ($1, $2, $3, 'Written directly by the researcher.', 'researcher_authored', 'accepted')
         on conflict (run_id, (trim(candidate_text))) where source = 'researcher_authored' and status <> 'rejected'
         do nothing`,
        [TENANT_ID, runId, text]
      );
      await client.query("release savepoint obj_cand_insert");
      if ((inserted.rowCount ?? 0) === 0) return; // a matching candidate already exists; nothing new to sync
    } catch (error) {
      // Migration 0083 not applied yet: no such partial unique index for ON CONFLICT to
      // target. Rolling back to the savepoint undoes just the failed insert attempt,
      // leaving the surrounding transaction (and this client) usable again, so the fallback
      // below runs in a valid transaction boundary instead of an aborted one. Falls back to
      // the old check-then-insert - not race-safe, but no worse than before this fix, and
      // this run keeps working rather than failing outright over a migration that hasn't
      // landed.
      const message = error instanceof Error ? error.message : String(error);
      if (!/no unique or exclusion constraint matching/.test(message)) throw error;
      await client.query("rollback to savepoint obj_cand_insert");
      const existing = await client.query(
        `select 1 from objective_candidates
         where run_id = $1 and source = 'researcher_authored' and status != 'rejected' and trim(candidate_text) = $2
         limit 1`,
        [runId, text],
      );
      if ((existing.rowCount ?? 0) > 0) return;
      await client.query(
        `insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status)
         values ($1, $2, $3, 'Written directly by the researcher.', 'researcher_authored', 'accepted')`,
        [TENANT_ID, runId, text]
      );
    }
    await syncResearchObjective(client, runId);
  });

  await refreshObjectiveQuality(TENANT_ID, runId);
  await refreshObjectiveValidationQuietly(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
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
