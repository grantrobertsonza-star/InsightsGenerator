import type { PoolClient } from "pg";
import { withTenant, withTenantRead } from "./db";
import { refreshInsights } from "./insightGenerator";
import { refreshRecommendations } from "./recommendationAgent";

// Insights and recommendations are judged against the accepted business decisions
// (runs.decision_statement). A decision change commits first and the two refreshes run after it,
// because they call the model and can take long or fail. A refresh that fails after the change
// committed used to leave the change saved, the dependants silently built on the old decisions,
// and the researcher told "Not changed". The change now records that a refresh is owed, in the same
// transaction, and the marker is cleared only by a refresh that succeeds; until then the decisions
// panel says the insights and recommendations are not up to date and offers to update them.
const PENDING_EVENT = "decision_refresh_pending";

/** Records, inside the transaction that changes the accepted decisions, that dependants are owed a refresh. */
export async function markDecisionRefreshPending(client: PoolClient, tenantId: string, runId: string): Promise<void> {
  await client.query("insert into trace(tenant_id,run_id,event,detail) values($1,$2,$3,'{}'::jsonb)", [tenantId, runId, PENDING_EVENT]);
}

/**
 * Refreshes the insights and recommendations for the current accepted decisions. Returns null on
 * success, or the reason it failed (the change itself stays saved and stays marked as owed).
 *
 * Only markers recorded before the refresh started are cleared: the refreshes read
 * runs.decision_statement after that point, so every change those markers stand for is covered.
 * A change committed while the refresh runs adds a newer marker, which stays.
 */
export async function refreshDecisionDependants(tenantId: string, runId: string): Promise<string | null> {
  const covered = await withTenantRead(tenantId, async (client) => {
    const r = await client.query<{ max: string | null }>("select max(id)::text as max from trace where tenant_id=$1 and run_id=$2 and event=$3", [tenantId, runId, PENDING_EVENT]);
    return r.rows[0]?.max ?? null;
  });
  // Both refreshes log and return their failures rather than throw (automatic triggers rely on
  // that); a throw here can still come from the logging itself.
  const problems: string[] = [];
  try {
    const insights = await refreshInsights(tenantId, runId);
    if (insights) problems.push(`insights: ${insights}`);
    for (const r of await refreshRecommendations(tenantId, runId)) problems.push(`recommendations: ${r}`);
  } catch (error) {
    problems.push(error instanceof Error && error.message ? error.message : String(error));
  }
  if (problems.length > 0) return problems.join("; ");
  if (covered !== null) {
    // If clearing fails the marker stays, and the panel keeps offering an update that is no
    // longer needed: the safe direction. The refresh itself succeeded, so this is not an error.
    await withTenant(tenantId, (client) =>
      client.query("delete from trace where tenant_id=$1 and run_id=$2 and event=$3 and id <= $4::bigint", [tenantId, runId, PENDING_EVENT, covered]),
    ).catch(() => undefined);
  }
  return null;
}

/**
 * Whether the insights and recommendations are still owed a refresh after a decision change.
 * null when this could not be checked: unknown is shown as unknown, never as up to date.
 */
export async function decisionRefreshPending(tenantId: string, runId: string): Promise<boolean | null> {
  try {
    return await withTenantRead(tenantId, async (client) => {
      const r = await client.query("select 1 from trace where tenant_id=$1 and run_id=$2 and event=$3 limit 1", [tenantId, runId, PENDING_EVENT]);
      return (r.rowCount ?? 0) > 0;
    });
  } catch {
    return null;
  }
}
