"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { archiveAndDeleteSynthesizedInsight } from "./synthesizedInsightArchive";
import { checkRunStability } from "./insightSynthesizer";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

/**
 * Synthesized insights come out of insightSynthesizer.ts already
 * review_status = 'accepted', same auto-accept-by-default convention as
 * decisions, objectives, and recommendations: a researcher is overriding a
 * default, not clearing a backlog. Accept/reject here just flip that flag
 * in place, same as acceptRecommendation/rejectRecommendation; nothing is
 * archived until it's actually deleted.
 */
export async function acceptSynthesizedInsight(runId: string, synthesizedInsightId: string) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query(
      "update synthesized_insights set review_status = 'accepted' where id = $1 and run_id = $2",
      [synthesizedInsightId, runId]
    );
  });
  revalidatePath(`/runs/${runId}`);
}

export async function rejectSynthesizedInsight(runId: string, synthesizedInsightId: string) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query(
      "update synthesized_insights set review_status = 'rejected' where id = $1 and run_id = $2",
      [synthesizedInsightId, runId]
    );
  });
  revalidatePath(`/runs/${runId}`);
}

/**
 * The one operation that actually removes a synthesized insight, so it's
 * the one that snapshots to synthesized_insight_history first (see
 * synthesizedInsightArchive.ts) rather than just deleting outright the way
 * deleteRecommendation does: the researcher explicitly asked for a record
 * of what gets deleted here, not just of what gets rejected.
 */
export async function deleteSynthesizedInsight(runId: string, synthesizedInsightId: string) {
  await withTenant(TENANT_ID, async (client) => {
    await archiveAndDeleteSynthesizedInsight(client, { runId, synthesizedInsightId });
  });
  revalidatePath(`/runs/${runId}`);
}

/**
 * The tier-two reproducibility check (see checkRunStability's doc comment
 * in insightSynthesizer.ts): explicit, on demand, never run automatically.
 * Writes stability_testable_count / stability_reappeared_count /
 * stability_checked_at onto every currently accepted synthesized insight
 * in one pass, overwriting whatever an earlier check left there.
 */
export async function checkStability(runId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await checkRunStability(TENANT_ID, runId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'insight_stability_check_error', $3)`,
        [TENANT_ID, runId, message]
      );
    }).catch(() => {});
    return { ok: false, error: message };
  }
}
