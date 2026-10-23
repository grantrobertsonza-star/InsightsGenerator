"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { convertedCopyPath, finishDocumentStorageCleanup, queueDocumentStorageCleanup } from "./documentStorageCleanup";
import { requireTenantId } from "./requestContext";
import { driverAnalysesPresent, legacyDriverFindingOf } from "./driverFindingSource";

/**
 * Deletes a single uploaded document from a run (e.g. a duplicate re-import,
 * or one you no longer want in the pool), rather than having to delete and
 * recreate the whole run. Findings that were extracted from it, or generated
 * from its data, have nothing meaningful left to point at once it's gone,
 * so they're removed alongside it rather than left dangling.
 */
export async function deleteDocument(runId: string, documentId: string) {
  const TENANT_ID = await requireTenantId();
  const cleanupId = await withTenant(TENANT_ID, async (client) => {
    // Lock the owned document before queuing paths or deleting dependent human work.
    const owned = await client.query<{ storage_path: string; preview_storage_path: string | null }>("select storage_path,preview_storage_path from documents where id=$1 and run_id=$2 and tenant_id=$3 for update", [documentId, runId, TENANT_ID]);
    if (!owned.rowCount) return null;
    const document = owned.rows[0];
    // With its converted copy (Codex batch10 RR-F03): normally already removed by the parser, but a
    // failed removal must go with the file. Removing a copy that was never made is not an error.
    const storagePaths = [document.storage_path, document.preview_storage_path, convertedCopyPath(document.storage_path)].filter((path): path is string => Boolean(path));
    const cleanupId = storagePaths.length ? await queueDocumentStorageCleanup(client, TENANT_ID, runId, documentId, storagePaths) : null;
    // source_table_id points at a document_tables row, not this document
    // directly (see 0023_document_tables.sql, which repointed it away from
    // documents.id), so a table-computed finding has to be reached through
    // that join; matching source_table_id = $1 directly, as this used to,
    // never matches post-0023 and silently left those findings behind to
    // throw a foreign-key violation on the delete below once their
    // document_tables row went with the document.
    // GT1000-F01: driver findings posted before they recorded source_document_id are reached
    // through their saved analysis, before the analysis itself goes with the document (cascade).
    const legacyDrivers = (await driverAnalysesPresent(client)) ? ` or ${legacyDriverFindingOf("findings", "$1")}` : "";
    await client.query(
      `delete from findings
       where source_document_id = $1
          or source_table_id in (select id from document_tables where document_id = $1)${legacyDrivers}`,
      [documentId]
    );
    // Scoped by run_id too, the same ownership check already done above when
    // the document's storage paths were read, so a delete can never reach a
    // document outside the run this call was made for.
    const result = await client.query("delete from documents where id = $1 and run_id = $2", [documentId, runId]);
    if (result.rowCount === 0) {
      throw new Error("That document was not found in this run.");
    }
    return cleanupId;
  });

  if (cleanupId) {
    // The durable pending record stays visible in Import until storage and completion both succeed.
    await finishDocumentStorageCleanup(TENANT_ID, runId, cleanupId).catch(() => {});
  }

  revalidatePath(`/runs/${runId}`);
}

export async function retryDocumentStorageCleanup(runId: string): Promise<{ ok: boolean; error?: string }> {
  const TENANT_ID = await requireTenantId();
  try {
    await finishDocumentStorageCleanup(TENANT_ID, runId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
