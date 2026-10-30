"use server";

import { loadImportPreviewIdentities } from "./importPreviewIdentity";
import type { TableCell } from "./rowCells";
import { withTenant } from "./db";
import { supabaseAdmin } from "./supabaseAdmin";
import { isPlainTableFileName, parseTableDocument, type ParsedTable, type PreviewTable } from "./parseTable";
import { resolveAuthoritativeSheet } from "./crosstabs";
import { readProvenanceAvailable } from "./documentTables";
import { requireTenantId } from "./requestContext";
import { RUN_NOT_AVAILABLE, runAccessible } from "./runOwnership";
import { loadDataSetupWithStatus } from "./dataSetup";

const BUCKET = "documents";

export type PreviewResult =
  | { kind: "pdf"; url: string }
  | { kind: "table"; table: PreviewTable }
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
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { error: RUN_NOT_AVAILABLE };
  if (source.sourceTableId) {
    const tableRow = await withTenant(TENANT_ID, async (client) => {
      const result = await client.query<{ headers: string[]; rows: Record<string, TableCell>[]; document_id: string; table_index: number; row_count: number; read_provenance: unknown }>(
        // read_provenance is migration 0116's; before it, null (the table is then checked by a fresh read).
        `select headers, rows, document_id, table_index, jsonb_array_length(rows)::int as row_count,
                ${(await readProvenanceAvailable(client)) ? "read_provenance" : "null::jsonb as read_provenance"}
           from document_tables where id = $1 and run_id = $2`,
        [source.sourceTableId, runId]
      );
      return result.rows[0];
    });

    if (!tableRow) {
      return { error: "Source table not found." };
    }

    const identities = await loadImportPreviewIdentities(TENANT_ID, runId, [tableRow]);
    const error = identities.get(tableRow.document_id)?.error;
    if (error) return { error };

    return {
      kind: "table",
      table: {
        headers: tableRow.headers as string[],
        rows: tableRow.rows as Record<string, TableCell>[],
        // document_tables has no sheet concept of its own (it's the already-extracted
        // table a Word/PDF/CSV/Excel document produced, not a live re-read of the
        // workbook), so there's no sheet name to report here.
        sheetName: "",
        unsupportedIdentifierColumns: [],
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
      selected_sheet: string | null;
      ingestion_type: string | null;
    }>(
      "select preview_storage_path, source_filename, storage_path, kind, selected_sheet, ingestion_type from documents where id = $1 and run_id = $2",
      [source.sourceDocumentId, runId]
    );
    return result.rows[0];
  });

  if (!document) {
    return { error: "Document not found." };
  }

  if (document.kind === "table") {
    // A CSV/Excel document previewed straight from the raw file.
    //
    // IMP-002 / IMP-SHIP-001 (P2a repair): this preview is one of the readers that decides which
    // workbook sheet is a document's data, so it follows the same publish-then-adopt protocol as
    // extraction (documentTables.ts), the variable dictionary and buildCrosstab (crosstabs.ts).
    // It used to return whatever its own parse picked without ever confirming it, so while another
    // reader's competing choice was being published (selected_sheet still null here) the researcher
    // could be shown one sheet's rows while every calculation then used a different sheet.
    // Guarantees, in order:
    //  - the sheet this read used is published through resolveAuthoritativeSheet before anything is
    //    returned (a no-op when a selection is already persisted);
    //  - if another reader's choice won, the file is re-parsed against the winner, so the returned
    //    rows and sheetName are the authoritative sheet's;
    //  - if the selection cannot be confirmed (persistence failure of any kind), no table is
    //    returned at all - an error naming the recovery is, never the unconfirmed rows;
    //  - a persisted sheet that no longer exists keeps parseTableDocument's explicit
    //    SheetSelectionLostError recovery message; nothing is substituted.
    // Limit: this confirms the selection at the time of this call only. Its write is the same
    // single conditional UPDATE every other reader uses (first writer wins, losers read back the
    // winner); no lock is held across the parse.
    const sourceDocumentId = source.sourceDocumentId;
    const readFailure = (err: unknown) => ({
      error: `Could not read "${document.source_filename}" as a table: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    });
    // The file itself, as written (rows as cases): the engine's one reader, the same read calculations use.
    if (!isPlainTableFileName(document.source_filename)) {
      return { error: `"${document.source_filename}" is not a CSV or Excel file, so it has no table preview here. Open it from Import data.` };
    }
    // The header row choice (decision 9) is applied, unlike the layout: which row names the variables is part of
    // reading the file as written, and without it a file whose title rows detection misses could not be shown at
    // all. A choice that cannot be read shows no table rather than one read another way.
    let headerRowsSkipped: number | null = null;
    if (document.ingestion_type === "raw") {
      const setup = await loadDataSetupWithStatus(TENANT_ID, sourceDocumentId);
      if (!setup.ok) return { error: `Could not read the header row setting of "${document.source_filename}", so no preview is shown. Try again. (${setup.error})` };
      headerRowsSkipped = setup.setup.headerRowsSkipped;
    }
    let table: ParsedTable;
    try {
      table = await parseTableDocument(document.storage_path, document.source_filename, { selectedSheet: document.selected_sheet, headerRowsSkipped });
    } catch (err) {
      return readFailure(err);
    }
    let authoritative: string;
    try {
      authoritative = await resolveAuthoritativeSheet(
        TENANT_ID,
        sourceDocumentId,
        document.selected_sheet,
        table.sheetName,
      );
    } catch (err) {
      return {
        error:
          `Could not confirm which sheet of "${document.source_filename}" holds its data, so no preview is ` +
          `shown (showing an unconfirmed sheet could differ from what calculations use). Try again; if this ` +
          `keeps happening, check the Tracking panel. (${err instanceof Error ? err.message : "unknown error"})`,
      };
    }
    if (authoritative !== table.sheetName) {
      try {
        table = await parseTableDocument(document.storage_path, document.source_filename, { selectedSheet: authoritative, headerRowsSkipped });
      } catch (err) {
        return readFailure(err);
      }
    }
    return { kind: "table", table };
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
