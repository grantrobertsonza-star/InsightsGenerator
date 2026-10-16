import type { PoolClient } from "pg";
import { withTenant, withTenantRead } from "./db";
import { supabaseAdmin } from "./supabaseAdmin";

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
