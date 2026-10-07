import type { PoolClient } from "pg";
import { withTenantRead } from "./db";
import {
  availableNetNewSources,
  classifyInputCompleteness,
  type DiscoverySource,
  type InputCompleteness,
} from "./discoveryClassification";

export type RunInputCompleteness = {
  state: InputCompleteness;
  hasReport: boolean;
  hasData: boolean;
  /** Which sources of net-new insight are open for this input. */
  netNewSources: DiscoverySource[];
};

/**
 * What the client actually supplied for a run, read from what was
 * uploaded rather than from entry_point (which records which door the
 * researcher walked in through, not what turned out to be behind it: a
 * "validate" run can arrive with tables attached, a "generate" run with
 * only a narrative).
 *
 * A report or transcript counts as the report side: it carries claims in
 * words. Data is any extracted table, raw or aggregated: it is the only
 * thing a statistic can be recomputed from or a stated figure cross-checked
 * against. Supporting 'evidence' documents are neither, so they do not
 * change the answer.
 *
 * Takes an open client so a route that already holds a tenant-scoped
 * transaction can call it without opening a second one.
 */
export async function loadInputCompleteness(
  client: PoolClient,
  runId: string,
): Promise<RunInputCompleteness> {
  const result = await client.query<{ has_report: boolean; has_data: boolean }>(
    `select
       exists (select 1 from documents where run_id = $1 and kind in ('report', 'transcript')) as has_report,
       exists (select 1 from document_tables where run_id = $1) as has_data`,
    [runId],
  );
  const row = result.rows[0] ?? { has_report: false, has_data: false };
  const state = classifyInputCompleteness({
    hasReport: row.has_report,
    hasData: row.has_data,
  });
  return {
    state,
    hasReport: row.has_report,
    hasData: row.has_data,
    netNewSources: availableNetNewSources(state),
  };
}

export async function getRunInputCompleteness(
  tenantId: string,
  runId: string,
): Promise<RunInputCompleteness> {
  return withTenantRead(tenantId, (client) => loadInputCompleteness(client, runId));
}
