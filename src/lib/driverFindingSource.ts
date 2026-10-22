// GT1000-F01 (Codex, 2026-10-21): how a driver finding is tied to its data file. Findings posted
// from a saved driver analysis carry source_document_id (addDriverFindings), like every other
// finding calculated from a file. Findings posted before 21 October 2026 do not: they name only
// their saved analysis (stated_stats.analysisId), which names the file. These helpers let deletion,
// its confirmation counts and support resolve both, one rule in one place.
import type { PoolClient } from "pg";

/** Whether driver_analyses exists (migration 0072). Without it no legacy driver finding can be resolved. */
export async function driverAnalysesPresent(client: PoolClient): Promise<boolean> {
  const r = await client.query<{ present: boolean }>("select to_regclass('public.driver_analyses') is not null as present");
  return r.rows[0]?.present === true;
}

/**
 * SQL condition, for a findings alias and a document id expression: a driver finding posted before
 * source_document_id was recorded whose saved analysis is on that document. Only usable when
 * driverAnalysesPresent is true.
 */
export function legacyDriverFindingOf(findingAlias: string, documentIdSql: string): string {
  return `(${findingAlias}.source_document_id is null and ${findingAlias}.pattern_type = 'driver'
           and ${findingAlias}.stated_stats->>'analysisId' in (select da.id::text from driver_analyses da where da.document_id = ${documentIdSql}))`;
}
