"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { generateObjectiveValidation } from "./objectiveValidator";
import { generateObjectiveCandidates } from "./objectiveFramer";
import { refreshObjectiveQuality } from "./objectiveQualityScorer";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

type Result = { ok: true } | { ok: false; error: string };

async function logError(runId: string, event: string, message: string) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query(
      `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, $3, $4)`,
      [TENANT_ID, runId, event, JSON.stringify({ message })],
    );
  }).catch(() => {});
}

/** Re-checks every stated objective and decision against the accepted insights. */
export async function checkObjectiveCoverage(runId: string): Promise<Result> {
  try {
    await generateObjectiveValidation(TENANT_ID, runId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logError(runId, "objective_validation_error", message);
    return { ok: false, error: message };
  }
}

/**
 * Proposes objectives for accepted insights that no stated objective or
 * decision points at. Suggestions land pending; nothing is scored against
 * one until the researcher accepts it.
 */
export async function suggestObjectivesFromUnmatched(runId: string): Promise<Result> {
  try {
    const headlines = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ headline: string }>(
        `select si.headline
         from synthesized_insights si
         where si.run_id = $1 and si.review_status = 'accepted'
           and exists (select 1 from objective_validations x where x.run_id = $1 and x.inferred = false)
           and not exists (
             select 1 from objective_validations ov
             where ov.run_id = $1 and ov.inferred = false and si.id = any(ov.synthesized_insight_ids)
           )
         order by si.created_at`,
        [runId],
      );
      return r.rows.map((x) => x.headline);
    });
    if (headlines.length === 0) {
      return { ok: false, error: "Every accepted insight is already covered by an objective." };
    }
    await generateObjectiveCandidates(TENANT_ID, runId, headlines);
    await refreshObjectiveQuality(TENANT_ID, runId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logError(runId, "objective_framer_error", message);
    return { ok: false, error: message };
  }
}
