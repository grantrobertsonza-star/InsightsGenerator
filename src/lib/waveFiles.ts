// The wave files of one project (projectWaves, ./waves.ts), read from the database. One reader for Wave tracking's
// file list and the tracker dashboard's "previous wave", so both always agree on which files are waves and in
// which order.
import { withTenantRead } from "./db";
import { normaliseDataSetup } from "./dataSetupShared";
import { projectWaves, type ProjectWaves } from "./waves";

export async function loadProjectWaves(tenantId: string, runId: string): Promise<ProjectWaves> {
  return withTenantRead(tenantId, async (client) => {
    const r = await client.query<{ id: string; source_filename: string; data_setup: unknown; uploaded_at: Date | string }>(
      `select id, source_filename, data_setup, uploaded_at from documents
       where run_id = $1 and kind = 'table' and ingestion_type = 'raw' and data_setup is not null
       order by uploaded_at asc`,
      [runId],
    );
    return projectWaves(r.rows.map((row) => ({ documentId: row.id, filename: row.source_filename, uploadedAt: row.uploaded_at instanceof Date ? row.uploaded_at.toISOString() : String(row.uploaded_at), setup: normaliseDataSetup(row.data_setup) })));
  });
}
