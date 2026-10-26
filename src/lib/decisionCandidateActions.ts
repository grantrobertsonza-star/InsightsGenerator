"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { generateDecisionCandidates } from "./decisionFramer";
import { markDecisionRefreshPending, refreshDecisionDependants } from "./decisionRefresh";
import { lockRunForContextChange, syncDecisionStatement } from "./runSync";
import { requireTenantId } from "./requestContext";

/**
 * What a decision change reports back. The change itself either committed (this result) or
 * threw. refreshError is set when the change was saved but the insights and recommendations
 * could not be updated to match it; they stay marked as owed a refresh (see decisionRefresh.ts).
 */
export type DecisionChangeResult = { ok: true; refreshError: string | null };

/**
 * Codex DEC500-F01: an accept or edit refused because its target changed. `currentText` is the
 * decision's wording as stored now, read under the same lock as the refusal (null when it was
 * deleted), so the editor can show it and keep the researcher's draft. Nothing was written.
 */
export type DecisionConflict = { ok: false; conflict: true; error: string; currentText: string | null };

const DECISION_EDIT_CONFLICT =
  "This decision was changed after you opened it, so your edit was not saved. Your wording is still in the box: use the current wording, or replace it with yours.";
const DECISION_GONE =
  "This decision is no longer in the project; it may have been deleted, so nothing was saved. Your wording is still in the box; reload to see the current list.";

// Runs only after the change committed, so nothing here may throw: a throw would reach the panel
// as "Not saved" about a change that was saved. Any failure (the marker lookup, the refreshes,
// revalidation) is reported as the refresh error instead; the committed marker stays, so the
// panel keeps offering the update and a retry runs the same path.
async function afterDecisionChange(runId: string): Promise<DecisionChangeResult> {
  const TENANT_ID = await requireTenantId();
  let refreshError: string | null;
  try {
    refreshError = await refreshDecisionDependants(TENANT_ID, runId);
  } catch (error) {
    refreshError = error instanceof Error && error.message ? error.message : String(error);
  }
  try {
    revalidatePath(`/runs/${runId}`);
  } catch (error) {
    refreshError ??= error instanceof Error && error.message ? error.message : String(error);
  }
  return { ok: true, refreshError };
}

/** Retries the insight and recommendation refresh owed after an earlier decision change. */
export async function retryDecisionRefresh(runId: string): Promise<DecisionChangeResult> {
  // G6: checked here as well as in the delegated action, so this entry point never relies on a callee.
  await requireTenantId();
  return afterDecisionChange(runId);
}



/**
 * editedText, when given, is a wording change the researcher made on the
 * review screen before accepting. The candidate's stored text is updated to
 * match and flagged accordingly, the same way a finding's origin is tagged, so
 * a later reader can see this wasn't accepted exactly as suggested.
 */
export async function acceptDecisionCandidate(
  runId: string,
  candidateId: string,
  editedText?: string,
  expectedText?: string,
): Promise<DecisionChangeResult | DecisionConflict> {
  const TENANT_ID = await requireTenantId();
  // DEC500-F01: `expectedText` is the wording the editor opened with. The run row is locked first
  // (as every decision change does), then the candidate row, and the save is refused when the
  // candidate is gone or now says something else, instead of overwriting another editor's change
  // or reporting a save that wrote nothing. A deleted and recreated decision has a new id, so an
  // editor opened on the old one is refused even when the wording matches.
  const refused = await withTenant(TENANT_ID, async (client): Promise<DecisionConflict | null> => {
    await lockRunForContextChange(client, runId, TENANT_ID);
    const result = await client.query<{ candidate_text: string; edited: boolean }>(
      "select candidate_text, edited from decision_candidates where id = $1 and run_id = $2 for update",
      [candidateId, runId]
    );
    const candidate = result.rows[0];
    if (!candidate) return { ok: false, conflict: true, error: DECISION_GONE, currentText: null };
    if (expectedText !== undefined && candidate.candidate_text.trim() !== expectedText.trim()) {
      return { ok: false, conflict: true, error: DECISION_EDIT_CONFLICT, currentText: candidate.candidate_text };
    }

    const trimmedEdit = editedText?.trim();
    const finalText = trimmedEdit || candidate.candidate_text;
    const editedThisCall = Boolean(trimmedEdit && trimmedEdit !== candidate.candidate_text);
    // Overnight queue, package 5 (DEC-001): `edited` is what decisionFramer.ts's regenerate
    // step reads to decide which AI-suggested candidates are safe to delete - `edited = false`
    // means "never touched by a human," and only that is cleared out when the framer re-runs.
    // Re-accepting an ALREADY-edited candidate with no new wording (editedText omitted, or
    // typed back to match what's already stored) previously computed wasEdited from nothing
    // but this one call's own trimmedEdit, so it reset the flag straight back to false - making
    // a researcher's own prior wording newly eligible for deletion on the next regenerate, even
    // though nothing about that wording was actually reverted. edited, once true, must stay
    // true: it is provenance ("has a human ever touched this"), not a description of this one
    // call's own action.
    const wasEdited = candidate.edited || editedThisCall;

    await client.query(
      "update decision_candidates set status = 'accepted', candidate_text = $1, edited = $2 where id = $3",
      [finalText, wasEdited, candidateId]
    );
    await syncDecisionStatement(client, runId);
    await markDecisionRefreshPending(client, TENANT_ID, runId);
    return null;
  });
  if (refused) return refused;
  // For a "validate" run this is the moment insight generation stops being a no-op (it reads the
  // decision statement that just changed); for a "generate" run it usually is one. Recommendations
  // are judged against the confirmed decisions in both modes, and a decision can be re-accepted
  // with edited text, so both refreshes run on every accept, not only the first.
  return afterDecisionChange(runId);
}

/**
 * Accepts every candidate still pending, exactly as each stands (no text
 * edits happen here). Rejected and already-accepted candidates are left
 * alone.
 */
export async function acceptAllDecisionCandidates(runId: string) {
  const TENANT_ID = await requireTenantId();
  await withTenant(TENANT_ID, async (client) => {
    await lockRunForContextChange(client, runId, TENANT_ID);
    await client.query("update decision_candidates set status = 'accepted' where run_id = $1 and status = 'pending'", [
      runId,
    ]);
    await syncDecisionStatement(client, runId);
    await markDecisionRefreshPending(client, TENANT_ID, runId);
  });
  return afterDecisionChange(runId);
}

/**
 * Permanently discards every candidate still pending, the same
 * can't-be-undone move as deleting one individually, just for the whole
 * batch at once. Accepted and already-rejected candidates are untouched.
 */
export async function deleteAllDecisionCandidates(runId: string) {
  const TENANT_ID = await requireTenantId();
  await withTenant(TENANT_ID, async (client) => {
    await lockRunForContextChange(client, runId, TENANT_ID);
    await client.query("delete from decision_candidates where run_id = $1 and status = 'pending'", [runId]);
  });
  revalidatePath(`/runs/${runId}`);
}

export async function rejectDecisionCandidate(runId: string, candidateId: string) {
  const TENANT_ID = await requireTenantId();
  await withTenant(TENANT_ID, async (client) => {
    await lockRunForContextChange(client, runId, TENANT_ID);
    await client.query("update decision_candidates set status = 'rejected' where id = $1 and run_id = $2", [
      candidateId,
      runId,
    ]);
    await syncDecisionStatement(client, runId);
    await markDecisionRefreshPending(client, TENANT_ID, runId);
  });
  return afterDecisionChange(runId);
}

/**
 * Puts a rejected candidate back into play. Restores it straight to
 * accepted, not to a pending state someone then has to accept again: since
 * everything starts accepted by default now, "restore" is just the
 * mirror of reject, an un-reject, not a second review step.
 */
export async function restoreDecisionCandidate(runId: string, candidateId: string) {
  const TENANT_ID = await requireTenantId();
  await withTenant(TENANT_ID, async (client) => {
    await lockRunForContextChange(client, runId, TENANT_ID);
    await client.query("update decision_candidates set status = 'accepted' where id = $1 and run_id = $2", [
      candidateId,
      runId,
    ]);
    await syncDecisionStatement(client, runId);
    await markDecisionRefreshPending(client, TENANT_ID, runId);
  });
  return afterDecisionChange(runId);
}

/**
 * Takes an accepted candidate out of play without rejecting it: it goes back
 * to pending, so it can be accepted again or rejected later. The decision
 * statement and everything built on it are refreshed.
 */
export async function unacceptDecisionCandidate(runId: string, candidateId: string) {
  const TENANT_ID = await requireTenantId();
  await withTenant(TENANT_ID, async (client) => {
    await lockRunForContextChange(client, runId, TENANT_ID);
    await client.query("update decision_candidates set status = 'pending' where id = $1 and run_id = $2", [
      candidateId,
      runId,
    ]);
    await syncDecisionStatement(client, runId);
    await markDecisionRefreshPending(client, TENANT_ID, runId);
  });
  return afterDecisionChange(runId);
}

/**
 * Adds a candidate the researcher wrote themselves, rather than one carried
 * over from the run's upfront text or proposed by the framer. Written as
 * already accepted, same as an AI-suggested one: the researcher typing
 * this in is itself the deliberate act of adding it to the run, so there's
 * no separate accept step to make them click through afterward. They can
 * still reject it like anything else if they change their mind.
 */
export async function addOwnDecisionCandidate(runId: string, candidateText: string) {
  const TENANT_ID = await requireTenantId();
  const text = candidateText.trim();
  if (!text) return;

  await withTenant(TENANT_ID, async (client) => {
    // A refresh can fail after this transaction commits. Serialise additions per owned run so
    // retrying that request (or overlapping submissions) reuses the researcher's persisted row.
    const owned = await client.query("select id from runs where id = $1 and tenant_id = $2 for update", [runId, TENANT_ID]);
    if (!owned.rowCount) throw new Error("That project is not available.");
    const existing = await client.query(
      "select id from decision_candidates where run_id = $1 and tenant_id = $2 and source = 'researcher_authored' and trim(candidate_text) = $3",
      [runId, TENANT_ID, text],
    );
    if (!existing.rowCount) {
      await client.query(
        `insert into decision_candidates (tenant_id, run_id, candidate_text, rationale, source, status)
         values ($1, $2, $3, 'Written directly by the researcher.', 'researcher_authored', 'accepted')`,
        [TENANT_ID, runId, text]
      );
    }
    await syncDecisionStatement(client, runId);
    await markDecisionRefreshPending(client, TENANT_ID, runId);
  });
  return afterDecisionChange(runId);
}

/**
 * Puts a candidate out of contention permanently, unlike reject, which just
 * moves it into the collapsed "rejected" list where it can still be
 * restored. Deleting an accepted candidate re-syncs runs.decision_statement
 * from whatever else is still accepted, rather than leaving it pointing at
 * text that no longer exists anywhere as a candidate.
 */
export async function deleteDecisionCandidate(runId: string, candidateId: string) {
  const TENANT_ID = await requireTenantId();
  await withTenant(TENANT_ID, async (client) => {
    await lockRunForContextChange(client, runId, TENANT_ID);
    await client.query("delete from decision_candidates where id = $1 and run_id = $2", [candidateId, runId]);
    await syncDecisionStatement(client, runId);
    await markDecisionRefreshPending(client, TENANT_ID, runId);
  });
  return afterDecisionChange(runId);
}

/**
 * Re-runs the framer, e.g. after the researcher has added more upfront
 * context on the run and wants a fresh pass rather than the first set of
 * suggestions. The framer replaces its own ai_suggested rows that the
 * researcher has not touched (pending or accepted, never edited), so a
 * candidate the researcher edited, wrote or rejected survives this untouched.
 *
 * Unlike refreshDecisionCandidates in page.tsx, which runs automatically
 * after extraction and swallows a failure so it never blocks the action the
 * researcher actually clicked, this is a direct user action: a failure
 * (an API error, a billing issue on the Anthropic account) is returned
 * rather than thrown, so the button's own click handler can show it inline
 * instead of the whole page crashing to Next's error overlay.
 */
export async function regenerateDecisionCandidates(
  runId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const TENANT_ID = await requireTenantId();
  try {
    await generateDecisionCandidates(TENANT_ID, runId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Logged the same way the automatic post-processing trigger logs its
    // failures, so a manual click that comes back empty leaves a record to
    // look at afterwards instead of only ever being seen once, in the
    // banner, by whoever happened to click the button.
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'decision_framer_error', $3)`,
        [TENANT_ID, runId, message]
      );
    }).catch(() => {});
    return { ok: false, error: message };
  }
}
