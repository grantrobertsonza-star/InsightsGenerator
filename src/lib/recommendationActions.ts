"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { generateRecommendations, generateSynthesizedRecommendations } from "./recommendationAgent";
import { refreshRecommendationQuality } from "./recommendationQualityScorer";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

type RecommendationFields = {
  action_text: string;
  owner_role: string;
  owner_feasibility_note: string;
  timeline: string;
  metric: string;
  priority: "high" | "medium" | "low";
  assumptions_and_risks: string;
  alternatives_considered: string;
};

/**
 * Unlike decision and objective candidates, recommendations have no single
 * "the accepted one" slot on the run: an insight set plausibly supports
 * several actions side by side, so accepting one never un-accepts another.
 * Accepting here just moves this row from pending to accepted; it's the
 * researcher signing off on it as a real action item, not a selection
 * among competing options.
 */
export async function acceptRecommendation(runId: string, recommendationId: string) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update recommendations set status = 'accepted' where id = $1 and run_id = $2", [
      recommendationId,
      runId,
    ]);
  });
  revalidatePath(`/runs/${runId}`);
}

export async function rejectRecommendation(runId: string, recommendationId: string) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update recommendations set status = 'rejected' where id = $1 and run_id = $2", [
      recommendationId,
      runId,
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
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update recommendations set status = 'accepted' where id = $1 and run_id = $2", [
      recommendationId,
      runId,
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
 */
export async function updateAndAcceptRecommendation(
  runId: string,
  recommendationId: string,
  fields: RecommendationFields
) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query(
      `update recommendations
       set action_text = $1, owner_role = $2, owner_feasibility_note = $3, timeline = $4, metric = $5,
           priority = $6, assumptions_and_risks = $7, alternatives_considered = $8, status = 'accepted',
           edited = true
       where id = $9 and run_id = $10`,
      [
        fields.action_text,
        fields.owner_role,
        fields.owner_feasibility_note,
        fields.timeline,
        fields.metric,
        fields.priority,
        fields.assumptions_and_risks,
        fields.alternatives_considered,
        recommendationId,
        runId,
      ]
    );
  });
  // An edited recommendation's old score no longer describes it. Separate
  // from the update above so editing keeps working before migration 0045.
  try {
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `update recommendations
         set rec_actionability_score = null, rec_feasibility_score = null, rec_evidence_score = null,
             rec_impact_score = null, rec_quality_score = null, rec_quality_tier = null,
             rec_quality_rationale = null
         where id = $1 and run_id = $2`,
        [recommendationId, runId]
      );
    });
  } catch {
    // Quality columns not there yet.
  }
  await refreshRecommendationQuality(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
}

/**
 * Adds a recommendation the researcher wrote themselves, tied to a specific
 * insight, rather than one the agent proposed. Written as already accepted,
 * same as a self-authored decision or objective candidate now: typing it in
 * is the deliberate act of adding it as an action item, so there's no extra
 * accept click to make them do afterward.
 */
export async function addOwnRecommendation(
  runId: string,
  insightId: string,
  fields: RecommendationFields
) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query(
      `insert into recommendations
         (tenant_id, run_id, insight_id, action_text, owner_role, owner_feasibility_note, timeline, metric,
          priority, assumptions_and_risks, alternatives_considered, source, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'researcher_authored', 'accepted')`,
      [
        TENANT_ID,
        runId,
        insightId,
        fields.action_text,
        fields.owner_role,
        fields.owner_feasibility_note,
        fields.timeline,
        fields.metric,
        fields.priority,
        fields.assumptions_and_risks,
        fields.alternatives_considered,
      ]
    );
  });
  revalidatePath(`/runs/${runId}`);
}

export async function deleteRecommendation(runId: string, recommendationId: string) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("delete from recommendations where id = $1 and run_id = $2", [recommendationId, runId]);
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
  try {
    await generateRecommendations(TENANT_ID, runId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'recommendation_agent_error', $3)`,
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
 * accepted, same reasoning as its pre-insight counterpart.
 */
export async function addOwnSynthesizedRecommendation(
  runId: string,
  synthesizedInsightId: string,
  fields: RecommendationFields
) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query(
      `insert into recommendations
         (tenant_id, run_id, synthesized_insight_id, action_text, owner_role, owner_feasibility_note, timeline,
          metric, priority, assumptions_and_risks, alternatives_considered, source, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'researcher_authored', 'accepted')`,
      [
        TENANT_ID,
        runId,
        synthesizedInsightId,
        fields.action_text,
        fields.owner_role,
        fields.owner_feasibility_note,
        fields.timeline,
        fields.metric,
        fields.priority,
        fields.assumptions_and_risks,
        fields.alternatives_considered,
      ]
    );
  });
  await refreshRecommendationQuality(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
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
  try {
    await generateSynthesizedRecommendations(TENANT_ID, runId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'synthesized_recommendation_agent_error', $3)`,
        [TENANT_ID, runId, message]
      );
    }).catch(() => {});
    return { ok: false, error: message };
  }
}
