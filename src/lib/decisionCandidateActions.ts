"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { generateDecisionCandidates } from "./decisionFramer";
import { refreshInsights } from "./insightGenerator";
import { refreshRecommendations } from "./recommendationAgent";
import { syncDecisionStatement } from "./runSync";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

/**
 * editedText, when given, is a wording change the researcher made on the
 * review screen before accepting. The candidate's stored text is updated to
 * match and flagged accordingly, the same way a finding's origin is tagged, so
 * a later reader can see this wasn't accepted exactly as suggested.
 */
export async function acceptDecisionCandidate(runId: string, candidateId: string, editedText?: string) {
  await withTenant(TENANT_ID, async (client) => {
    const result = await client.query<{ candidate_text: string }>(
      "select candidate_text from decision_candidates where id = $1 and run_id = $2",
      [candidateId, runId]
    );
    const candidate = result.rows[0];
    if (!candidate) return;

    const trimmedEdit = editedText?.trim();
    const finalText = trimmedEdit || candidate.candidate_text;
    const wasEdited = Boolean(trimmedEdit && trimmedEdit !== candidate.candidate_text);

    await client.query(
      "update decision_candidates set status = 'accepted', candidate_text = $1, edited = $2 where id = $3",
      [finalText, wasEdited, candidateId]
    );
    await syncDecisionStatement(client, runId);
  });

  // For a "validate" run, this is the moment generateInsights stops being a
  // no-op: it reads runs.decision_statement, which just changed. For a
  // "generate" run, insights were already generated earlier from the
  // findings alone, so this is a no-op there (nothing new to cover) unless
  // documents are reprocessed later.
  await refreshInsights(TENANT_ID, runId);

  // Also the moment recommendations stop being a no-op, in both modes: an
  // action is judged against a confirmed decision either way, and this is
  // where runs.decision_statement first becomes non-null for a "generate"
  // run (it was already set for "validate" before this call, but a
  // decision can be re-accepted with edited text, so this still needs to
  // run every time, not just the first).
  await refreshRecommendations(TENANT_ID, runId);

  revalidatePath(`/runs/${runId}`);
}

/**
 * Accepts every candidate still pending, exactly as each stands (no text
 * edits happen here). Rejected and already-accepted candidates are left
 * alone.
 */
export async function acceptAllDecisionCandidates(runId: string) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update decision_candidates set status = 'accepted' where run_id = $1 and status = 'pending'", [
      runId,
    ]);
    await syncDecisionStatement(client, runId);
  });

  await refreshInsights(TENANT_ID, runId);
  await refreshRecommendations(TENANT_ID, runId);

  revalidatePath(`/runs/${runId}`);
}

/**
 * Permanently discards every candidate still pending, the same
 * can't-be-undone move as deleting one individually, just for the whole
 * batch at once. Accepted and already-rejected candidates are untouched.
 */
export async function deleteAllDecisionCandidates(runId: string) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("delete from decision_candidates where run_id = $1 and status = 'pending'", [runId]);
  });
  revalidatePath(`/runs/${runId}`);
}

export async function rejectDecisionCandidate(runId: string, candidateId: string) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update decision_candidates set status = 'rejected' where id = $1 and run_id = $2", [
      candidateId,
      runId,
    ]);
    await syncDecisionStatement(client, runId);
  });
  revalidatePath(`/runs/${runId}`);
}

/**
 * Puts a rejected candidate, or a candidate an acceptance elsewhere
 * superseded, back into play. Distinct from adding a brand new candidate,
 * this is for a researcher who changes their mind rather than one who
 * thinks of something new.
 */
/**
 * Puts a rejected candidate back into play. Restores it straight to
 * accepted, not to a pending state someone then has to accept again: since
 * everything starts accepted by default now, "restore" is just the
 * mirror of reject, an un-reject, not a second review step.
 */
export async function restoreDecisionCandidate(runId: string, candidateId: string) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update decision_candidates set status = 'accepted' where id = $1 and run_id = $2", [
      candidateId,
      runId,
    ]);
    await syncDecisionStatement(client, runId);
  });

  await refreshInsights(TENANT_ID, runId);
  await refreshRecommendations(TENANT_ID, runId);

  revalidatePath(`/runs/${runId}`);
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
  const text = candidateText.trim();
  if (!text) return;

  await withTenant(TENANT_ID, async (client) => {
    await client.query(
      `insert into decision_candidates (tenant_id, run_id, candidate_text, rationale, source, status)
       values ($1, $2, $3, 'Written directly by the researcher.', 'researcher_authored', 'accepted')`,
      [TENANT_ID, runId, text]
    );
    await syncDecisionStatement(client, runId);
  });

  await refreshInsights(TENANT_ID, runId);
  await refreshRecommendations(TENANT_ID, runId);

  revalidatePath(`/runs/${runId}`);
}

/**
 * Puts a candidate out of contention permanently, unlike reject, which just
 * moves it into the collapsed "rejected" list where it can still be
 * restored. Deleting an accepted candidate re-syncs runs.decision_statement
 * from whatever else is still accepted, rather than leaving it pointing at
 * text that no longer exists anywhere as a candidate.
 */
export async function deleteDecisionCandidate(runId: string, candidateId: string) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("delete from decision_candidates where id = $1 and run_id = $2", [candidateId, runId]);
    await syncDecisionStatement(client, runId);
  });
  revalidatePath(`/runs/${runId}`);
}

/**
 * Re-runs the framer, e.g. after the researcher has added more upfront
 * context on the run and wants a fresh pass rather than the first set of
 * suggestions. The framer only clears out its own pending, ai_suggested
 * rows before writing new ones, so anything already accepted or rejected by
 * the researcher survives this untouched.
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
