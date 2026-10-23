import type { PoolClient } from "pg";
import { withTenant, withTenantRead } from "./db";
import { supabaseAdmin } from "./supabaseAdmin";

/**
 * The converted copy the remote statistics parser writes next to a data file
 * (api/parse-stats-file.py: `<storage path>.converted.json`), respondent-level data. One rule for
 * where it lives, used by the parser's own clean-up and by document and project deletion
 * (Codex batch10 RR-F03), so a copy whose removal failed is still removed with its file.
 */
export function convertedCopyPath(storagePath: string): string {
  return `${storagePath}.converted.json`;
}

/**
 * Records a stored object to remove later, when removing it now failed: a pending cleanup on its
 * project, which Import shows with its retry and project deletion includes. The project is read
 * from the path (`<tenant>/<run>/...`); a path in no project's folder is refused.
 */
export async function queueOrphanStorageCleanup(storagePath: string, reason: string): Promise<void> {
  const m = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\//.exec(storagePath);
  if (!m) throw new Error("That stored object is not in a project's folder.");
  const [, tenantId, runId] = m;
  await withTenant(tenantId, async (client) => {
    const run = await client.query("select id from runs where id = $1 and tenant_id = $2", [runId, tenantId]);
    if (!run.rowCount) throw new Error("Project not found for storage cleanup.");
    await client.query("insert into trace(tenant_id,run_id,event,detail) values($1,$2,'document_storage_cleanup_pending',$3)", [
      tenantId,
      runId,
      JSON.stringify({ documentId: "converted-copy", storagePaths: [storagePath], reason }),
    ]);
  });
}

// Record intent before removing the last document reference: a later storage or trace outage
// must leave either the evidence row or an independently retryable list of orphan paths.
export async function queueDocumentStorageCleanup(client: PoolClient, tenantId: string, runId: string, documentId: string, storagePaths: string[]) {
  const result = await client.query<{ id: string }>(
    "insert into trace(tenant_id,run_id,event,detail) values($1,$2,'document_storage_cleanup_pending',$3) returning id",
    [tenantId, runId, JSON.stringify({ documentId, storagePaths })],
  );
  return result.rows[0].id;
}

export async function pendingDocumentStorageCleanupCount(tenantId: string, runId: string) {
  return withTenantRead(tenantId, async client => {
    const result = await client.query<{ count: string }>("select count(*) from trace where tenant_id=$1 and run_id=$2 and event='document_storage_cleanup_pending'", [tenantId, runId]);
    return Number(result.rows[0].count);
  });
}

export async function finishDocumentStorageCleanup(tenantId: string, runId: string, onlyId?: string) {
  const jobs = await withTenantRead(tenantId, async client => {
    const result = await client.query<{ id: string; detail: { storagePaths?: unknown } }>(
      "select id,detail from trace where tenant_id=$1 and run_id=$2 and event='document_storage_cleanup_pending' and ($3::bigint is null or id=$3::bigint)",
      [tenantId, runId, onlyId ?? null],
    );
    return result.rows;
  });
  for (const job of jobs) {
    await withTenant(tenantId, async client => {
      // Uploads hold this same run lock between their storage write and document insert.
      // A retry may win before an upload starts, but then the uploader refuses the consumed intent.
      const run = await client.query("select id from runs where id=$1 and tenant_id=$2 for update", [runId, tenantId]);
      if (!run.rowCount) throw new Error("Project not found for storage cleanup.");
      const current = await client.query<{ detail: { storagePaths?: unknown } }>("select detail from trace where id=$1 and tenant_id=$2 and run_id=$3 and event='document_storage_cleanup_pending'", [job.id, tenantId, runId]);
      if (!current.rowCount) return;
      const paths = current.rows[0].detail.storagePaths;
      if (!Array.isArray(paths) || !paths.length || !paths.every(p => typeof p === "string" && p.startsWith(`${tenantId}/${runId}/`))) {
        throw new Error("Storage cleanup contains an invalid object identity; no objects were removed.");
      }
      const referenced = (await client.query("select 1 from documents where tenant_id=$1 and (storage_path=any($2::text[]) or preview_storage_path=any($2::text[])) limit 1", [tenantId, paths])).rowCount;
      if (referenced) throw new Error("Storage cleanup is still referenced by a document; no objects were removed.");
      const { error } = await supabaseAdmin.storage.from("documents").remove(paths);
      if (error) throw new Error(`Storage cleanup is pending: ${error.message}`);
      // A failed completion write leaves an idempotent retry, never an untracked orphan.
      await client.query("delete from trace where id=$1 and tenant_id=$2 and run_id=$3 and event='document_storage_cleanup_pending'", [job.id, tenantId, runId]);
    });
  }
}
