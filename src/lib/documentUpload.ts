import { withTenant } from "./db";
import { supabaseAdmin } from "./supabaseAdmin";

const BUCKET = "documents";

export const UPLOAD_KINDS = ["report", "table", "transcript", "instrument"] as const;
export const INSTRUMENT_TYPES = ["questionnaire", "interview_guide", "focus_group_guide"] as const;
export type InstrumentTypeChoice = (typeof INSTRUMENT_TYPES)[number];
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const TABLE_INGESTION_TYPES = ["raw", "aggregated"] as const;
export type TableIngestionType = (typeof TABLE_INGESTION_TYPES)[number];

/**
 * Which pipeline a document goes through used to be guessed from its file
 * extension, but a PDF or Word file could just as easily be a polished
 * report or a raw interview transcript, extension alone can't tell those
 * apart. Rather than guess (or bury the distinction in a checkbox someone
 * has to remember to tick), the person picks it explicitly as part of the
 * upload, and that's the one source of truth for what happens to the file.
 */
export function isUploadKind(value: FormDataEntryValue | null): value is UploadKind {
  return typeof value === "string" && (UPLOAD_KINDS as readonly string[]).includes(value);
}

/**
 * Same reasoning as isUploadKind, one level further in for Table uploads
 * specifically: raw (case-level, one row per respondent) and aggregated
 * (an already-tabulated cross-tab) get genuinely different statistical
 * treatment downstream (see 0038_table_ingestion_type.sql and
 * generateFindingsFromTable.ts), and nothing about a file's own shape
 * reliably tells those apart, so this is never inferred, only chosen.
 */
export function isTableIngestionType(value: FormDataEntryValue | null): value is TableIngestionType {
  return typeof value === "string" && (TABLE_INGESTION_TYPES as readonly string[]).includes(value);
}

/**
 * Stores one uploaded file as a document row of the given kind. This is
 * the one piece of storage-upload-then-insert logic shared by every place
 * a report, table or transcript can be uploaded: the run page's "Upload a
 * document" form, and the project-setup form that imports documents at
 * creation time alongside a brief or proposal, so a researcher doesn't
 * have to create the project first and then separately go find the upload
 * section to bring their actual data in.
 */
export async function storeUploadedDocument(
  tenantId: string,
  runId: string,
  kind: UploadKind,
  file: File,
  ingestionType?: TableIngestionType,
  instrumentType?: InstrumentTypeChoice,
): Promise<string> {
  // The DB constraint (0038_table_ingestion_type.sql) would catch a missing
  // value here too, but failing before the file is even uploaded to storage
  // gives a clearer error and skips an otherwise-wasted upload.
  if (kind === "table" && !ingestionType) {
    throw new Error(
      "A Table upload needs to say whether it's raw case-level data or an already-aggregated table."
    );
  }
  // Tenant-scoped path: even though this bucket is only ever touched by
  // server code using the secret key, every object still lives under the
  // tenant's own folder, so nothing has to change here when client-facing
  // storage policies are added later.
  // The storage path uses a sanitized version of the file name, since
  // characters like "%", "#" or "?" are reserved in URLs and break the
  // Storage API's request encoding. The real file name is kept as-is in
  // source_filename for display everywhere else.
  const safeFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const storagePath = `${tenantId}/${runId}/${Date.now()}-${safeFileName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: file.type || undefined });

  if (uploadError) {
    throw new Error(`Upload of ${file.name} failed: ${uploadError.message}`);
  }

  try {
    return await withTenant(tenantId, async (client) => {
      // The instrument column only exists once migration 0060 is applied, so
      // it is only named for instrument uploads and every other upload is
      // unaffected until then.
      const result =
        kind === "instrument"
          ? await client.query<{ id: string }>(
              `insert into documents (tenant_id, run_id, kind, source_filename, storage_path, instrument_type)
               values ($1, $2, $3, $4, $5, $6)
               returning id`,
              [tenantId, runId, kind, file.name, storagePath, instrumentType ?? "questionnaire"]
            )
          : await client.query<{ id: string }>(
              `insert into documents (tenant_id, run_id, kind, source_filename, storage_path, ingestion_type)
               values ($1, $2, $3, $4, $5, $6)
               returning id`,
              [tenantId, runId, kind, file.name, storagePath, kind === "table" ? ingestionType : null]
            );
      return result.rows[0].id;
    });
  } catch (error) {
    // The file is already in storage but has no document row to point at it:
    // clean it up rather than leaving an orphaned object with nothing in the
    // database to show it exists or to let a retry find and reuse it. Best
    // effort; if the cleanup itself fails, the original insert error is still
    // the one that reaches the caller, not this one, but the cleanup failure
    // itself is recorded rather than silently dropped - without this, a
    // double failure (insert fails, then cleanup also fails) left an
    // orphaned storage object with literally nothing, anywhere, saying it
    // existed or needed attention.
    // IMP-007: `.remove()` can reject outright, not just resolve with an `{ error }` - a
    // rejection here used to escape this catch block as a brand-new thrown error, replacing
    // the original insert failure (`error`) with the cleanup failure instead of adding to it,
    // and the `throw error;` below never ran, so neither the insert failure nor the cleanup
    // failure was ever recorded. Both shapes are now folded into the same recorded trace, and
    // the original insert error is always what this function throws.
    let cleanupError: { message: string } | null = null;
    try {
      const { error: cleanupErr } = await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
      cleanupError = cleanupErr;
    } catch (thrown) {
      cleanupError = { message: thrown instanceof Error ? thrown.message : String(thrown) };
    }
    if (cleanupError) {
      await withTenant(tenantId, async (client) => {
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'document_storage_cleanup_failed', $3)`,
          [tenantId, runId, JSON.stringify({ storagePath, insertError: error instanceof Error ? error.message : String(error), cleanupError: cleanupError.message })]
        );
      }).catch(() => {});
    }
    throw error;
  }
}

/**
 * Records whether a document's last processing attempt actually produced usable data,
 * independent of whether the upload that stored it succeeded - storage succeeding only
 * means the bytes are safely kept, not that anything could be read out of them. Shared
 * by the explicit single-document processing actions (page.tsx) and by storeAndRead
 * (documentUploadActions.ts), whose best-effort read-on-upload used to leave this unset
 * on failure: the document then showed as freshly added with no hint that it came back
 * empty until the researcher happened to notice, or separately clicked a processing
 * action that repeated the same failure. Best-effort and migration-guarded like the
 * other document_tables/variable_overrides columns this file's neighbours touch: a
 * pre-migration-0079 database has no processing_status column yet, so this is silently
 * a no-op there rather than a hard failure over a column that doesn't exist yet.
 */
/**
 * Counter-review on ANA-QUAL-001: this used to return void, so a status write that was
 * silently swallowed by the migration guard below (a pre-0088 database rejecting
 * 'incomplete' via its check constraint, same as a pre-0079 database having no column at
 * all) was indistinguishable from one that actually succeeded - the caller had no way to
 * know the document's processing_status was NOT updated, and a document could keep
 * showing a stale prior status (most dangerously a stale "ready" left over from an
 * earlier, fully-successful run) while today's run, which actually left coding
 * incomplete, believed it had recorded that. Returning whether the write actually took
 * effect lets a caller that cares (extractThemes.ts's three apply-codebook call sites, in
 * particular - see their own comments) tell the two apart and say so, rather than
 * implying a status was saved when it was not.
 */
export async function markDocumentProcessingStatus(
  tenantId: string,
  documentId: string,
  // ANA-QUAL-001: 'incomplete' (migration 0088) is a transcript whose coding batches came
  // back without full per-unit coverage - not a failure (it still produced usable findings),
  // but not a clean run either. See extractThemes.ts's applyCodebook/incompleteBatches.
  status: "ready" | "incomplete" | "failed",
): Promise<boolean> {
  try {
    await withTenant(tenantId, async (client) => {
      await client.query("update documents set processing_status = $1 where id = $2", [status, documentId]);
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/processing_status/.test(message)) throw error;
    // Pre-migration-0079 database (no column), or pre-migration-0088 (column exists but
    // its check constraint does not yet allow 'incomplete'): nothing was recorded.
    return false;
  }
}
