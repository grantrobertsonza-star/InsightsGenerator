"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { supabaseAdmin } from "./supabaseAdmin";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;
const BUCKET = "documents";

/**
 * Deletes a single uploaded document from a run (e.g. a duplicate re-import,
 * or one you no longer want in the pool), rather than having to delete and
 * recreate the whole run. Findings that were extracted from it, or generated
 * from its data, have nothing meaningful left to point at once it's gone,
 * so they're removed alongside it rather than left dangling.
 */
export async function deleteDocument(runId: string, documentId: string) {
  const document = await withTenant(TENANT_ID, async (client) => {
    const result = await client.query<{ storage_path: string; preview_storage_path: string | null }>(
      "select storage_path, preview_storage_path from documents where id = $1 and run_id = $2",
      [documentId, runId]
    );
    return result.rows[0];
  });

  if (!document) return;

  // Storage files aren't known to Postgres, so they're cleaned up here
  // before the document row (and its findings) are deleted, same as deleteRun.
  const storagePaths = [document.storage_path, document.preview_storage_path].filter(
    (path): path is string => Boolean(path)
  );
  if (storagePaths.length > 0) {
    await supabaseAdmin.storage.from(BUCKET).remove(storagePaths);
  }

  await withTenant(TENANT_ID, async (client) => {
    // source_table_id points at a document_tables row, not this document
    // directly (see 0023_document_tables.sql, which repointed it away from
    // documents.id), so a table-computed finding has to be reached through
    // that join; matching source_table_id = $1 directly, as this used to,
    // never matches post-0023 and silently left those findings behind to
    // throw a foreign-key violation on the delete below once their
    // document_tables row went with the document.
    await client.query(
      `delete from findings
       where source_document_id = $1
          or source_table_id in (select id from document_tables where document_id = $1)`,
      [documentId]
    );
    await client.query("delete from documents where id = $1", [documentId]);
  });

  revalidatePath(`/runs/${runId}`);
}
