import { createHash, randomUUID } from "node:crypto";
import { withTenant } from "./db";
import { runOwned } from "./runOwnership";
import { supabaseAdmin } from "./supabaseAdmin";
import { assertImportFileSupported } from "./importLimits";
import { queueDocumentStorageCleanup, finishDocumentStorageCleanup } from "./documentStorageCleanup";

/**
 * IMP-008: the same file (same bytes) already stored as the same kind in this project. Not a
 * failure: a retried batch must add each good file exactly once, so the repeat is refused and
 * reported by name instead of becoming a second document that double counts.
 */
export class DuplicateUploadError extends Error {
  constructor(
    readonly fileName: string,
    readonly existingFileName: string,
  ) {
    super(`${fileName} is already in this project${existingFileName !== fileName ? ` (as ${existingFileName})` : ""}, so it was not added again.`);
    this.name = "DuplicateUploadError";
  }
}

/** Hex SHA-256 of an upload's bytes: its content identity (IMP-008). */
export function contentSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

const BUCKET = "documents";

// "evidence": a brief or proposal, context for the project and not mined for findings (the same kind
// Set Objectives stores); uploadable from Import data since 2026-10-19.
// "technical": methodology, fieldwork, sampling, weighting or analysis documentation (Grant,
// 2026-10-24; migration 0112), read for the Research assistant to quote; never mined for findings.
// "indicator": published statistics by area and period (Grant, 2026-10-28; migration 0126), read by
// indicatorData.ts into series and observations; never mined for findings.
export const UPLOAD_KINDS = ["report", "table", "transcript", "instrument", "evidence", "technical", "indicator"] as const;

/** Said when a technical document is refused because migration 0112 is not applied. */
export const TECHNICAL_MIGRATION_MESSAGE =
  "Technical documents need the database update 0112_technical_documents.sql. Nothing was stored; apply it and add the file again.";
/** Said when Indicator data is refused because migration 0126 is not applied (same text as indicatorData.ts). */
export const INDICATOR_UPLOAD_MIGRATION_MESSAGE =
  "Indicator data needs the database update 0126_indicator_observations.sql. Nothing was stored; apply it and add the file again.";
/** Kinds added by a migration: before it, the kind check refuses the insert and this is said instead. */
const KIND_MIGRATION_MESSAGE: Partial<Record<UploadKind, string>> = {
  technical: TECHNICAL_MIGRATION_MESSAGE,
  indicator: INDICATOR_UPLOAD_MIGRATION_MESSAGE,
};
// "codebook" (Grant, 2026-10-26; migration 0118): a data file's variable list with labels and answer
// codes, read and linked like a questionnaire.
export const INSTRUMENT_TYPES = ["questionnaire", "interview_guide", "focus_group_guide", "codebook"] as const;
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

/** What lay under a failed storage write, for diagnosis: the network error's code and message. */
export type StorageFailureCause = { code: string | null; message: string };

/**
 * The innermost cause of a storage client error. supabase-js reports a network failure as a
 * StorageUnknownError whose `originalError` is fetch's TypeError("fetch failed"), and that error's
 * `cause` is what actually happened (UND_ERR_SOCKET, ECONNRESET, UND_ERR_HEADERS_TIMEOUT, ...).
 * Addresses are replaced, because a storage address can carry a signed token; nothing else is read.
 * Null when there is nothing beneath the top-level message.
 */
export function storageFailureCause(error: unknown): StorageFailureCause | null {
  let current: unknown = error;
  let deepest: { code?: unknown; message?: unknown } | null = null;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const next = (current as { originalError?: unknown; cause?: unknown }).originalError ?? (current as { cause?: unknown }).cause;
    if (!next || typeof next !== "object") break;
    deepest = next as { code?: unknown; message?: unknown };
    current = next;
  }
  if (!deepest) return null;
  const code = typeof deepest.code === "string" && /^[A-Z0-9_]{2,60}$/.test(deepest.code) ? deepest.code : null;
  const message = String(deepest.message ?? "")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[address]")
    .replace(/\b(token|apikey|key|signature|authorization)=\S+/gi, "$1=[hidden]")
    .replace(/Bearer\s+\S+/gi, "Bearer [hidden]")
    .slice(0, 300);
  if (!code && !message) return null;
  return { code, message };
}

/**
 * A storage write failed. The message names the file, the storage client's message and, when there is
 * one, the underlying cause in plain words, so a failure such as "fetch failed" can be told apart
 * (Codex's 120 MB check, batch 65); `failureCause` carries the same for the upload_error trace.
 */
export class StorageWriteError extends Error {
  readonly failureCause: StorageFailureCause | null;
  constructor(fileName: string, error: { message: string }) {
    const cause = storageFailureCause(error);
    // Without a cause the message is exactly what it always was.
    const why = cause ? `. The connection reported: ${[cause.code, cause.message].filter(Boolean).join(", ")}.` : "";
    super(`Upload of ${fileName} failed: ${error.message}${why}`);
    this.failureCause = cause;
  }
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
  assertImportFileSupported(file.name, file.size);
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
  const storagePath = `${tenantId}/${runId}/${Date.now()}-${randomUUID()}-${safeFileName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  // IMP-008: refuse a second copy of the same bytes as the same kind in this project, before
  // anything is uploaded. Migration-guarded (0098): before it is applied there is no content
  // identity to check, so uploads behave exactly as before.
  const sha256 = contentSha256(buffer);
  const dedupe = await withTenant(tenantId, async (client) => {
    // SEC1: ownership first. The duplicate probe answers with an existing file's name, so run before
    // the check it would tell a caller another organisation's file name for a project it does not own.
    if (!(await runOwned(client, tenantId, runId))) throw new Error("Project not found for upload.");
    const probe = await client.query<{ available: boolean }>(
      `select exists (select 1 from information_schema.columns
                      where table_name = 'documents' and column_name = 'content_sha256') as available`,
    );
    if (probe.rows[0]?.available !== true) return { available: false as const };
    const existing = await client.query<{ source_filename: string }>(
      "select source_filename from documents where run_id = $1 and tenant_id = $4 and kind = $2 and content_sha256 = $3 limit 1",
      [runId, kind, sha256, tenantId],
    );
    return { available: true as const, existing: existing.rows[0]?.source_filename ?? null };
  });
  if (dedupe.available && dedupe.existing !== null) throw new DuplicateUploadError(file.name, dedupe.existing);

  // Commit intent before the external write. If insertion and subsequent cleanup both fail,
  // this record survives independently and the existing Import retry can discover the object.
  const cleanupId = await withTenant(tenantId, async client => {
    const run = await client.query("select id from runs where id=$1 and tenant_id=$2", [runId, tenantId]);
    if (!run.rowCount) throw new Error("Project not found for upload.");
    return queueDocumentStorageCleanup(client, tenantId, runId, "pending-upload", [storagePath]);
  });

  try {
    return await withTenant(tenantId, async (client) => {
      const run = await client.query("select id from runs where id=$1 and tenant_id=$2 for update", [runId, tenantId]);
      if (!run.rowCount) throw new Error("Project not found for upload.");
      const intent = await client.query("select id from trace where id=$1 and tenant_id=$2 and run_id=$3 and event='document_storage_cleanup_pending'", [cleanupId, tenantId, runId]);
      if (!intent.rowCount) throw new Error("This upload was cleaned up before it started. Retry the file.");
      // Cleanup takes the same lock, so it cannot remove bytes between upload and insertion.
      const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(storagePath, buffer, { contentType: file.type || undefined });
      if (uploadError) throw new StorageWriteError(file.name, uploadError);
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
      const id = result.rows[0].id;
      // IMP-008: recorded in the same transaction as the insert. The partial unique index
      // (0098) rejects it when a concurrent retry stored the same bytes first; the whole insert
      // then rolls back and the storage object is cleaned up below.
      if (dedupe.available) {
        await client.query("update documents set content_sha256 = $2 where id = $1", [id, sha256]);
      }
      await client.query("delete from trace where id=$1 and tenant_id=$2 and run_id=$3", [cleanupId, tenantId, runId]);
      return id;
    });
  } catch (error) {
    try {
      await finishDocumentStorageCleanup(tenantId, runId, cleanupId);
    } catch (cleanupError) {
      const original = error instanceof Error ? error.message : String(error);
      const cleanup = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      throw new Error(`${original} File cleanup remains pending in Import; use Retry file cleanup. ${cleanup}`);
    }
    // A concurrent retry stored the same bytes first (unique index from 0098): a duplicate,
    // reported as such - the storage object was cleaned up above like any failed insert.
    // Before migration 0112 (technical) or 0126 (indicator) the kind check refuses the document; the
    // insert rolled back and the stored object was cleaned up above, so nothing is left behind.
    const kindMessage = KIND_MIGRATION_MESSAGE[kind];
    if (kindMessage && (error as { code?: string })?.code === "23514" && /documents_kind_check/.test(String((error as { constraint?: string })?.constraint ?? (error as Error).message))) {
      throw new Error(kindMessage);
    }
    if ((error as { code?: string })?.code === "23505" && /documents_run_kind_content_uidx/.test(String((error as { constraint?: string })?.constraint ?? (error as Error).message))) {
      throw new DuplicateUploadError(file.name, file.name);
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
 * implying a status was saved when it was not. False covers both a pending migration and a
 * document that is no longer there (DI-F05); the callers' messages name both.
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
    // Codex DI-F05: true only when this tenant's document row was updated. A deleted document (for
    // example removed while it was being processed) or another tenant's (row-level security hides it)
    // updates no row, and that is reported as not recorded rather than as recorded.
    const updated = await withTenant(tenantId, async (client) => {
      const r = await client.query("update documents set processing_status = $1 where id = $2 and tenant_id = $3", [status, documentId, tenantId]);
      return r.rowCount ?? 0;
    });
    return updated === 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/processing_status/.test(message)) throw error;
    // Pre-migration-0079 database (no column), or pre-migration-0088 (column exists but
    // its check constraint does not yet allow 'incomplete'): nothing was recorded.
    return false;
  }
}
