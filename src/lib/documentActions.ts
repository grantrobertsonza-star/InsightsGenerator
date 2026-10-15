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

  // The database row goes first, storage cleanup second - the reverse of how this used to
  // run. Removing storage first meant a database failure afterward (a dropped connection, a
  // constraint this code doesn't know about) left the original evidence already gone from
  // storage with a document row still sitting there pointing at nothing, no way to tell the
  // delete "didn't happen" apart from one that silently lost the file. Deleting the database
  // row first instead means the worst case of a later storage failure is an orphaned object
  // left in the bucket: wasted space, not lost evidence or a misleading document that looks
  // alive but isn't. The database delete is also the one a researcher can retry and see
  // reflected immediately; storage cleanup that fails afterward is recorded instead of thrown,
  // since the document is, correctly, already gone by then.
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
    // Scoped by run_id too, the same ownership check already done above when
    // the document's storage paths were read, so a delete can never reach a
    // document outside the run this call was made for.
    const result = await client.query("delete from documents where id = $1 and run_id = $2", [documentId, runId]);
    if (result.rowCount === 0) {
      throw new Error("That document was not found in this run.");
    }
  });

  const storagePaths = [document.storage_path, document.preview_storage_path].filter(
    (path): path is string => Boolean(path)
  );
  if (storagePaths.length > 0) {
    // IMP-007: `.remove()` can fail two different ways - resolve with an `{ error }` (handled
    // below), or reject outright (a dropped connection, a network error). Only the first used
    // to be caught: a rejection escaped this function entirely, after the database row was
    // already gone, with no trace row recorded at all - the one case this whole block exists to
    // cover. Both shapes are now funneled into the same recorded-cleanup-failure path.
    let removeError: { message: string } | null = null;
    try {
      const { error } = await supabaseAdmin.storage.from(BUCKET).remove(storagePaths);
      removeError = error;
    } catch (thrown) {
      removeError = { message: thrown instanceof Error ? thrown.message : String(thrown) };
    }
    if (removeError) {
      // The document is already gone from the database, which is the state that matters to
      // every reader of this run, so this is recorded for cleanup rather than thrown back at
      // whoever clicked delete - they would have no useful way to "retry" a delete that, from
      // the app's point of view, already succeeded.
      await withTenant(TENANT_ID, async (client) => {
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'document_storage_cleanup_failed', $3)`,
          [TENANT_ID, runId, JSON.stringify({ documentId, storagePaths, message: removeError.message })]
        );
      }).catch(() => {});
    }
  }

  revalidatePath(`/runs/${runId}`);
}
