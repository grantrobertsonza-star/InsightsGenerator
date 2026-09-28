import * as XLSX from "xlsx";
import { supabaseAdmin } from "./supabaseAdmin";

const BUCKET = "documents";

export type ParsedTable = {
  headers: string[];
  rows: Record<string, string | number | null>[];
};

/**
 * Reads a table/data document (CSV or Excel) out of storage and returns it
 * as rows keyed by column header, so the insight generator can reason about
 * it as structured data rather than raw text.
 */
export async function parseTableDocument(storagePath: string): Promise<ParsedTable> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`Could not download table from storage: ${error?.message}`);
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];

  const rows = XLSX.utils.sheet_to_json<Record<string, string | number | null>>(sheet, {
    defval: null,
  });

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

  return { headers, rows };
}
