import { withTenantRead } from "./db";
import { isPlainTableFileName, parseTableDocument } from "./parseTable";
import { loadDataSetupWithStatus } from "./dataSetup";
import { cellValue, type TableCell } from "./rowCells";

/** The engine reader whose stored tables are shown without a fresh read (TABLE_READER in
 * api/parse-stats-file.py; engineTableReader.test.ts keeps the two equal). */
export const ENGINE_TABLE_READER = "engine-plain-2026.10.26";

type StoredPreview = {
  document_id: string;
  table_index: number;
  headers: string[];
  rows: Record<string, TableCell>[];
  row_count: number;
  /** document_tables.read_provenance (migration 0116); absent or null when not recorded. */
  read_provenance?: unknown;
};

export type ImportPreviewIdentity = { error: string | null };

type Provenance = { reader?: unknown; sheet?: unknown; layout?: unknown };

/**
 * Whether each stored CSV/TSV/Excel table may be shown as the file's data. A stored table must be what
 * the engine's one reader reads from the file now (parseTable.ts), under the document's persisted sheet
 * and layout:
 *  - a table whose read_provenance names the current engine reader, that sheet and that layout is that
 *    read, and is shown after a structural check (every sampled row holds its own value for every header);
 *  - any other table (read by the retired TypeScript preview reader, by an earlier engine reader, before
 *    migration 0116, or under another sheet or layout) is compared value by value with a fresh engine
 *    read, and withheld with a recovery notice when they differ. That is how a preview the old reader
 *    stored with different names, codes or dates (Codex TP500/IP1000) stops being shown.
 * This never publishes a sheet choice and never replaces a stored table; reading the file again does.
 */
export async function loadImportPreviewIdentities(
  tenantId: string,
  runId: string,
  tables: StoredPreview[],
): Promise<Map<string, ImportPreviewIdentity>> {
  const ids = [...new Set(tables.filter((t) => t.table_index < 100).map((t) => t.document_id))];
  const result = new Map<string, ImportPreviewIdentity>();
  if (ids.length === 0) return result;
  const recovery = (reason: string) => ({
    error: `Stored preview cannot be verified: ${/[.!?]$/.test(reason.trim()) ? reason.trim() : `${reason.trim()}.`} No cached rows or corrections are shown. ` +
      "Read the file again to replace the stored table with what the file holds. If the file or selected " +
      "sheet changed, re-upload the corrected file; the existing evidence is kept until you deliberately replace it.",
  });
  let documents: {
    id: string;
    source_filename: string;
    storage_path: string;
    selected_sheet: string | null;
    kind: string;
    ingestion_type: string | null;
  }[];
  try {
    documents = await withTenantRead(tenantId, async (client) => (
      await client.query<typeof documents[number]>(
        "select id, source_filename, storage_path, selected_sheet, kind, ingestion_type from documents where run_id = $1 and id = any($2::uuid[])",
        [runId, ids],
      )
    ).rows);
  } catch (error) {
    for (const id of ids) result.set(id, recovery(error instanceof Error ? error.message : "source identity lookup failed"));
    return result;
  }
  // Each stored row must hold its own value (null included) for every header (Codex TR500-F01): a
  // missing or inherited property is never read as a value.
  const own = (row: Record<string, unknown>, h: string) => Object.hasOwn(row, h);
  await Promise.all(ids.map(async (id) => {
    const doc = documents.find((d) => d.id === id);
    if (!doc) { result.set(id, recovery("the source document is unavailable")); return; }
    if (doc.kind !== "table" || !isPlainTableFileName(doc.source_filename)) return;
    const isWorkbook = /\.(xlsx|xls)$/i.test(doc.source_filename);
    if (isWorkbook && !doc.selected_sheet) { result.set(id, recovery("the workbook has no confirmed data sheet")); return; }
    let layout: "rows_are_cases" | "columns_are_cases" = "rows_are_cases";
    if (doc.ingestion_type === "raw") {
      const setup = await loadDataSetupWithStatus(tenantId, doc.id);
      if (!setup.ok) {
        result.set(id, recovery(`the file's layout setting could not be read (${setup.error})`));
        return;
      }
      layout = setup.setup.layout;
    }
    const stored = tables.filter((t) => t.document_id === id && t.table_index < 100);
    const structurallyWhole = stored.every((t) =>
      t.headers.length > 0 && (t.row_count === 0 || t.rows.length > 0) && t.rows.every((row) => t.headers.every((h) => own(row, h))),
    );
    const current = stored.every((t) => {
      const p = (t.read_provenance ?? null) as Provenance | null;
      return !!p && p.reader === ENGINE_TABLE_READER && p.layout === layout &&
        (isWorkbook ? p.sheet === doc.selected_sheet : true);
    });
    if (current) {
      result.set(id, structurallyWhole ? { error: null } : recovery("a stored row is missing a value for one of its columns"));
      return;
    }
    try {
      const parsed = await parseTableDocument(doc.storage_path, doc.source_filename, { selectedSheet: doc.selected_sheet, layout });
      const matches = structurallyWhole && stored.every((t) =>
        t.headers.every((h) => parsed.headers.includes(h)) &&
        t.row_count === parsed.rows.length &&
        t.rows.every((row, i) => parsed.rows[i] && t.headers.every((h) =>
          own(parsed.rows[i], h) && cellValue(row, h) === cellValue(parsed.rows[i], h))),
      );
      result.set(id, matches ? { error: null } : recovery(
        isWorkbook
          ? `the stored table differs from what the file's selected sheet "${doc.selected_sheet}" holds now (it may have been read by an earlier version of the reader)`
          : "the stored table differs from what the file holds now (it may have been read by an earlier version of the reader)",
      ));
    } catch (error) {
      result.set(id, recovery(error instanceof Error ? error.message : "the file could not be read"));
    }
  }));
  return result;
}
