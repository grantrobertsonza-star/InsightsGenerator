"use server";

import { withTenant } from "./db";
import { supabaseAdmin } from "./supabaseAdmin";
import { parseTableDocument, type ParsedTable } from "./parseTable";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;
const BUCKET = "documents";

export type PreviewResult =
  | { kind: "pdf"; url: string }
  | { kind: "table"; table: ParsedTable }
  | { error: string };

/**
 * Returns what the "view source" side panel needs to show a finding's source.
 * A finding carries one of two different kinds of source id, and they are
 * NOT interchangeable: source_document_id is a real documents.id, while
 * source_table_id is a document_tables.id (repointed away from documents.id
 * by 0023_document_tables.sql) -- the specific table a generated finding
 * came from, not the document it was extracted out of. Looking a
 * source_table_id up in the documents table, as this used to, never matches
 * post-0023 and always silently returned "Document not found" for every
 * table-computed finding's preview.
 *
 * A table source is previewed directly from the document_tables row's own
 * already-parsed headers/rows, rather than by re-parsing the original file
 * from storage: that row is specifically the one table the finding came
 * from (a Word or PDF document can hold several), and re-parsing the
 * original file doesn't even work when that file is a Word document or PDF
 * rather than a spreadsheet -- XLSX.read has nothing to find in it. The
 * run_id check on both lookups keeps this scoped to the run the finding
 * actually belongs to, matching every other finding-related query.
 */
export async function getDocumentPreviewUrl(
  runId: string,
  source: { sourceDocumentId: string | null; sourceTableId: string | null }
): Promise<PreviewResult> {
  if (source.sourceTableId) {
    const tableRow = await withTenant(TENANT_ID, async (client) => {
      const result = await client.query<{ headers: unknown; rows: unknown }>(
        "select headers, rows from document_tables where id = $1 and run_id = $2",
        [source.sourceTableId, runId]
      );
      return result.rows[0];
    });

    if (!tableRow) {
      return { error: "Source table not found." };
    }

    return {
      kind: "table",
      table: {
        headers: tableRow.headers as string[],
        rows: tableRow.rows as Record<string, string | number | null>[],
      },
    };
  }

  if (!source.sourceDocumentId) {
    return { error: "This finding has no source document to preview." };
  }

  const document = await withTenant(TENANT_ID, async (client) => {
    const result = await client.query<{
      preview_storage_path: string | null;
      source_filename: string;
      storage_path: string;
      kind: string;
    }>(
      "select preview_storage_path, source_filename, storage_path, kind from documents where id = $1 and run_id = $2",
      [source.sourceDocumentId, runId]
    );
    return result.rows[0];
  });

  if (!document) {
    return { error: "Document not found." };
  }

  if (document.kind === "table") {
    // A CSV/Excel document with no detected-table rows yet (never
    // extracted): fall back to parsing the raw file directly, same as
    // before, rather than showing nothing.
    try {
      const table = await parseTableDocument(document.storage_path);
      return { kind: "table", table };
    } catch (err) {
      return {
        error: `Could not read "${document.source_filename}" as a table: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      };
    }
  }

  if (!document.preview_storage_path) {
    return {
      error: `No preview is available yet for "${document.source_filename}". Try extracting findings from it first.`,
    };
  }

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(document.preview_storage_path, 3600);

  if (error || !data) {
    return { error: `Could not create a preview link: ${error?.message ?? "unknown error"}` };
  }

  return { kind: "pdf", url: data.signedUrl };
}
