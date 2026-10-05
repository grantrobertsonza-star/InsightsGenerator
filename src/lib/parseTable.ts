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

  // A .docx or .pptx file is a zip archive too, just like .xlsx, so it gets
  // past XLSX's "is this a zip?" sniffing and only fails once it looks for
  // workbook.xml inside and doesn't find it, as "Could not find workbook" -
  // an accurate but opaque way of saying "this isn't a spreadsheet". The
  // most common real cause is a document uploaded as, or re-tagged to, the
  // "Table" kind when it's actually a report: this rephrases that specific
  // failure into something that tells a researcher what to actually do
  // about it, rather than a message that reads like an internal bug.
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `This file doesn't parse as a spreadsheet (${reason}). If it's a Word document or PDF that was ` +
      `uploaded as a "Table" document, delete it and re-upload it as a "Report" instead.`
    );
  }
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];

  const rows = XLSX.utils.sheet_to_json<Record<string, string | number | null>>(sheet, {
    defval: null,
  });

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

  return { headers, rows };
}
