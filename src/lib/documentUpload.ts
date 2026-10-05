import { withTenant } from "./db";
import { supabaseAdmin } from "./supabaseAdmin";

const BUCKET = "documents";

export const UPLOAD_KINDS = ["report", "table", "transcript"] as const;
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
  ingestionType?: TableIngestionType
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

  return withTenant(tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into documents (tenant_id, run_id, kind, source_filename, storage_path, ingestion_type)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [tenantId, runId, kind, file.name, storagePath, kind === "table" ? ingestionType : null]
    );
    return result.rows[0].id;
  });
}
