import { withTenantRead } from "./db";
import { parseTableDocument } from "./parseTable";

type StoredPreview = {
  document_id: string;
  table_index: number;
  headers: string[];
  rows: Record<string, string | number | null>[];
  row_count: number;
};

export type ImportPreviewIdentity = { error: string | null };

/** Stored workbook tables have no sheet provenance column. Compare their displayed values with
 * the current, explicitly selected sheet instead of treating a dictionary cache as proof. This
 * read never publishes a choice, replaces stored tables or invokes the statistical engine. */
export async function loadImportPreviewIdentities(
  tenantId: string,
  runId: string,
  tables: StoredPreview[],
): Promise<Map<string, ImportPreviewIdentity>> {
  const ids = [...new Set(tables.filter((t) => t.table_index < 100).map((t) => t.document_id))];
  const result = new Map<string, ImportPreviewIdentity>();
  if (ids.length === 0) return result;
  const recovery = (reason: string) => ({
    error: `Stored preview cannot be verified: ${reason} No cached rows or corrections are shown. ` +
      "Retry by reloading. If the file or selected sheet changed, re-upload the corrected file; " +
      "the existing evidence is kept until you deliberately replace it.",
  });
  let documents: { id: string; source_filename: string; storage_path: string; selected_sheet: string | null; kind: string }[];
  try {
    documents = await withTenantRead(tenantId, async (client) => (
      await client.query<typeof documents[number]>(
        "select id, source_filename, storage_path, selected_sheet, kind from documents where run_id = $1 and id = any($2::uuid[])",
        [runId, ids],
      )
    ).rows);
  } catch (error) {
    for (const id of ids) result.set(id, recovery(error instanceof Error ? error.message : "source identity lookup failed"));
    return result;
  }
  await Promise.all(ids.map(async (id) => {
    const doc = documents.find((d) => d.id === id);
    if (!doc) { result.set(id, recovery("the source document is unavailable")); return; }
    if (doc.kind !== "table" || !/\.(xlsx|xls)$/i.test(doc.source_filename)) return;
    if (!doc.selected_sheet) { result.set(id, recovery("the workbook has no confirmed data sheet")); return; }
    try {
      const parsed = await parseTableDocument(doc.storage_path, doc.selected_sheet);
      const stored = tables.filter((t) => t.document_id === id && t.table_index < 100);
      const matches = stored.every((t) =>
        t.headers.length > 0 && t.headers.every((h) => parsed.headers.includes(h)) &&
        t.row_count === parsed.rows.length && (t.row_count === 0 || t.rows.length > 0) &&
        t.rows.every((row, i) => parsed.rows[i] && t.headers.every((h) =>
          (row[h] ?? null) === (parsed.rows[i][h] ?? null))),
      );
      result.set(id, matches ? { error: null } : recovery(`the cached table differs from selected sheet "${doc.selected_sheet}"`));
    } catch (error) {
      result.set(id, recovery(error instanceof Error ? error.message : "the selected sheet could not be read"));
    }
  }));
  return result;
}
