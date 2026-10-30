"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { generateObjectiveValidation, refreshObjectiveValidationQuietly } from "./objectiveValidator";
import { generateObjectiveCandidates } from "./objectiveFramer";
import { coverageFreshnessNote, insightsNoItemCites, loadObjectiveCoverage } from "./objectiveCoverage";
import { refreshObjectiveQuality } from "./objectiveQualityScorer";
import { requireTenantId } from "./requestContext";
import { RUN_NOT_AVAILABLE, runAccessible } from "./runOwnership";

type Result = { ok: true } | { ok: false; error: string };

async function logError(runId: string, event: string, message: string) {
  const TENANT_ID = await requireTenantId();
  await withTenant(TENANT_ID, async (client) => {
    await client.query(
      `insert into trace (tenant_id, run_id, event, detail) select $1, $2, $3, $4 where exists (select 1 from runs where id = $2 and tenant_id = $1)`,
      [TENANT_ID, runId, event, JSON.stringify({ message })],
    );
  }).catch(() => {});
}

/** Re-checks every stated objective and decision against the accepted insights. */
export async function checkObjectiveCoverage(runId: string): Promise<Result> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
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
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    // "Not cited by any objective" is only known from coverage that is current (CE-1): an out-of-date
    // check may miss an insight accepted since, or cite one since rejected.
    // Coverage first, on its own connections (B39-F01), then the accepted insights.
    const coverage = await loadObjectiveCoverage(TENANT_ID, runId);
    const read = await withTenant(TENANT_ID, async (client) => {
      if (coverage.freshness.state !== "current") return { stale: coverageFreshnessNote(coverage.freshness) ?? "Check coverage first.", headlines: [] };
      const accepted = await client.query<{ id: string; headline: string }>(
        "select id, headline from synthesized_insights where run_id = $1 and review_status = 'accepted' order by created_at, id",
        [runId],
      );
      return { stale: null, headlines: insightsNoItemCites(coverage.rows, accepted.rows).map((x) => x.headline) };
    });
    if (read.stale) return { ok: false, error: read.stale };
    const headlines = read.headlines;
    if (headlines.length === 0) {
      return { ok: false, error: "Every accepted insight is already covered by an objective." };
    }
    await generateObjectiveCandidates(TENANT_ID, runId, headlines);
    await refreshObjectiveQuality(TENANT_ID, runId);
    await refreshObjectiveValidationQuietly(TENANT_ID, runId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logError(runId, "objective_framer_error", message);
    return { ok: false, error: message };
  }
}
