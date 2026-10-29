"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { generateRecommendations, generateSynthesizedRecommendations } from "./recommendationAgent";
import { refreshRecommendationQuality } from "./recommendationQualityScorer";
import { requireTenantId } from "./requestContext";
import {
  addResearcherRecommendation,
  isRequestKey,
  parseRecommendationFields,
  saveRecommendationEdit,
  type RecommendationAddResult,
  type RecommendationEditResult,
  type RecommendationFields,
} from "./recommendationWrites";


// SEC1: each status change and delete below names tenant_id, so another organisation's
// recommendation matches no row and is left unchanged (the same no-op as a recommendation that no
// longer exists), whether or not row-level security applies to the connection.

/**
 * Unlike decision and objective candidates, recommendations have no single
 * "the accepted one" slot on the run: an insight set plausibly supports
 * several actions side by side, so accepting one never un-accepts another.
 * Accepting here just moves this row from pending to accepted; it's the
 * researcher signing off on it as a real action item, not a selection
 * among competing options.
 */
export async function acceptRecommendation(runId: string, recommendationId: string) {
  const TENANT_ID = await requireTenantId();
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update recommendations set status = 'accepted' where id = $1 and run_id = $2 and tenant_id = $3", [
      recommendationId,
      runId,
      TENANT_ID,
    ]);
  });
  revalidatePath(`/runs/${runId}`);
}

export async function rejectRecommendation(runId: string, recommendationId: string) {
  const TENANT_ID = await requireTenantId();
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update recommendations set status = 'rejected' where id = $1 and run_id = $2 and tenant_id = $3", [
      recommendationId,
      runId,
      TENANT_ID,
    ]);
  });
  revalidatePath(`/runs/${runId}`);
}

/**
 * Restores a rejected recommendation straight to accepted, not to a
 * pending state someone then has to accept again: since everything starts
 * accepted by default now, "restore" is just the mirror of reject.
 */
export async function restoreRecommendation(runId: string, recommendationId: string) {
  const TENANT_ID = await requireTenantId();
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update recommendations set status = 'accepted' where id = $1 and run_id = $2 and tenant_id = $3", [
      recommendationId,
      runId,
      TENANT_ID,
    ]);
  });
  revalidatePath(`/runs/${runId}`);
}

/**
 * Saves an edit to a recommendation's fields, marking it accepted at the
 * same time (this is always reached via a "save and accept" action on the
 * review screen, never a bare save), and flags it edited the same way an
 * edited decision candidate is, so a later reader can see this wasn't
 * accepted exactly as the agent proposed it.
 *
 * `expected` is the fields as the editor opened them (Codex REC500-F01): a stale
 * or deleted target is refused with what is stored now, and nothing is saved.
 * The old quality score is cleared in the same transaction (REC500-F02); see
 * recommendationWrites.saveRecommendationEdit.
 */
export async function updateAndAcceptRecommendation(
  runId: string,
  recommendationId: string,
  fields: RecommendationFields,
  expected?: RecommendationFields
): Promise<RecommendationEditResult> {
  const TENANT_ID = await requireTenantId();
  const checked = parseRecommendationFields(fields);
  if (!checked || (expected !== undefined && !parseRecommendationFields(expected))) {
    return { ok: false, error: "This recommendation could not be saved: a field is missing or its priority is not high, medium or low." };
  }
  const result = await saveRecommendationEdit(TENANT_ID, runId, recommendationId, checked, expected);
  if (!result.ok) return result;
  // The edit and the cleared score are committed; scoring the new wording is a separate model call.
  // Its failure leaves the recommendation unscored (shown as not scored), never with the old score.
  await refreshRecommendationQuality(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
  return { ok: true };
}

/**
 * Adds a recommendation the researcher wrote themselves, tied to a specific
 * insight, rather than one the agent proposed. Written as already accepted,
 * same as a self-authored decision or objective candidate now: typing it in
 * is the deliberate act of adding it as an action item, so there's no extra
 * accept click to make them do afterward. `requestKey` is the add form's own
 * identity, sent again on a retry (Codex REC500-F03); see
 * recommendationWrites.addResearcherRecommendation.
 */
export async function addOwnRecommendation(
  runId: string,
  insightId: string,
  fields: RecommendationFields,
  requestKey: string
): Promise<RecommendationAddResult> {
  const TENANT_ID = await requireTenantId();
  const checked = parseRecommendationFields(fields);
  if (!checked) return { ok: false, error: "This recommendation needs an action, and a priority of high, medium or low." };
  if (!isRequestKey(requestKey)) return { ok: false, error: "This form could not be identified. Reload the page and add the recommendation again." };
  const result = await addResearcherRecommendation(TENANT_ID, runId, { kind: "insight", id: insightId }, checked, requestKey);
  if (result.ok) revalidatePath(`/runs/${runId}`);
  return result;
}

export async function deleteRecommendation(runId: string, recommendationId: string) {
  const TENANT_ID = await requireTenantId();
  await withTenant(TENANT_ID, async (client) => {
    await client.query("delete from recommendations where id = $1 and run_id = $2 and tenant_id = $3", [recommendationId, runId, TENANT_ID]);
  });
  revalidatePath(`/runs/${runId}`);
}

/**
 * Re-runs the agent for whatever insights don't have a recommendation yet.
 * Unlike the decision and objective framers, this never deletes anything
 * before writing: generateRecommendations only ever proposes for insights
 * that don't already have one, so a click here can only add rows, never
 * remove or replace a pending suggestion someone hasn't looked at yet. A
 * failure is returned rather than thrown, same reasoning as
 * regenerateDecisionCandidates: the button's own handler shows it inline.
 */
export async function regenerateRecommendations(
  runId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const TENANT_ID = await requireTenantId();
  try {
    await generateRecommendations(TENANT_ID, runId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) select $1, $2, 'recommendation_agent_error', $3 where exists (select 1 from runs where id = $2 and tenant_id = $1)`,
        [TENANT_ID, runId, message]
      );
    }).catch(() => {});
    return { ok: false, error: message };
  }
}

/**
 * Adds a recommendation the researcher wrote themselves, tied to a
 * synthesized insight rather than a pre-insight -- the mirror of
 * addOwnRecommendation for the funnel-output layer. Written as already
 * accepted, same reasoning as its pre-insight counterpart; the anchor must
 * still be accepted (the picker only offers accepted insights).
 */
export async function addOwnSynthesizedRecommendation(
  runId: string,
  synthesizedInsightId: string,
  fields: RecommendationFields,
  requestKey: string
): Promise<RecommendationAddResult> {
  const TENANT_ID = await requireTenantId();
  const checked = parseRecommendationFields(fields);
  if (!checked) return { ok: false, error: "This recommendation needs an action, and a priority of high, medium or low." };
  if (!isRequestKey(requestKey)) return { ok: false, error: "This form could not be identified. Reload the page and add the recommendation again." };
  const result = await addResearcherRecommendation(TENANT_ID, runId, { kind: "synthesized", id: synthesizedInsightId }, checked, requestKey);
  if (!result.ok) return result;
  if (!result.alreadySaved) await refreshRecommendationQuality(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
  return result;
}

/**
 * Re-runs the synthesized-insight recommendation agent for whatever
 * accepted synthesized insights don't have one yet. The mirror of
 * regenerateRecommendations for the funnel-output layer; same
 * never-deletes, return-rather-than-throw contract.
 */
export async function regenerateSynthesizedRecommendations(
  runId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const TENANT_ID = await requireTenantId();
  try {
    await generateSynthesizedRecommendations(TENANT_ID, runId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) select $1, $2, 'synthesized_recommendation_agent_error', $3 where exists (select 1 from runs where id = $2 and tenant_id = $1)`,
        [TENANT_ID, runId, message]
      );
    }).catch(() => {});
    return { ok: false, error: message };
  }
}

/**
 * CE-2: the researcher chooses the decisions a recommendation serves, from the project's current
 * decisions, against what they saw (recommendationDecisions.ts setServedDecisions). All or nothing.
 */
export async function setServedDecisionsAction(
  runId: string,
  recommendationId: string,
  chosenKeys: unknown,
  expectedServed: unknown,
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const TENANT_ID = await requireTenantId();
  if (!Array.isArray(chosenKeys) || chosenKeys.length > 100 || !chosenKeys.every((k) => typeof k === "string") || typeof expectedServed !== "string")
    return { ok: false, error: "The decisions chosen were not understood. Reload and try again." };
  try {
    const { setServedDecisions } = await import("./recommendationDecisions");
    const r = await withTenant(TENANT_ID, (client) => setServedDecisions(client, TENANT_ID, runId, recommendationId, chosenKeys, expectedServed));
    if (r.changed) revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
