import { runEngineConversion } from "./parseStatsFile";
import type { TableCell } from "./rowCells";
import type { DataSetup } from "./dataSetupShared";

/**
 * One reader for CSV, TSV and Excel files (Grant, 24 October 2026; Codex TP500-F01/F02, IP1000-F01 to
 * F04): the stored preview is the table the statistical engine itself reads (api/parse-stats-file.py,
 * read_table over _read_plain), the same read every dictionary, cross tab and driver calculation uses.
 * The TypeScript reader this replaces interpreted the same bytes separately (SheetJS cell inference,
 * its own missing tokens, duplicate names and flip) and disagreed with the engine on literal names,
 * codes, dates, text encoding and malformed files. Reading rules now live in one place, the engine.
 */
export type ParsedTable = {
  headers: string[];
  rows: Record<string, TableCell>[];
  /** IMP-SHIP-001: the workbook sheet read ("Sheet1" for a CSV/TSV, the name its persisted
   *  selection has always carried). Callers persist it as the document's sheet choice. */
  sheetName: string;
  /** IMP-SHIP-002: identifier columns whose custom Excel number format the engine cannot reproduce;
   *  their cells are blank in preview and calculation alike (see _apply_zero_padded_id_formats). */
  unsupportedIdentifierColumns: string[];
  /** The text encoding a CSV/TSV was read in ("utf-8", "utf-16" or "windows-1252"); null for Excel. */
  encoding: string | null;
  /** Variables holding calendar values, stored as ISO text ("2024-01-01", "2024-01-01T10:30:00"). */
  dateColumns: string[];
  /** The engine reader that produced this table (TABLE_READER in the engine). */
  reader: string;
};

/** What a source preview shows of a table (previewActions.ts, FindingsTable.tsx). */
export type PreviewTable = Pick<ParsedTable, "headers" | "rows" | "sheetName" | "unsupportedIdentifierColumns">;

/** IMP-SHIP-001: a persisted sheet choice that no longer names a sheet in the workbook (the file was
 * replaced with a different layout). Never answered by substituting another sheet: the researcher
 * re-confirms which sheet holds the data. A selection of null/undefined (nothing persisted yet) is the
 * first read, not an error. */
export class SheetSelectionLostError extends Error {
  readonly code = "SHEET_SELECTION_LOST" as const;
  constructor(readonly documentSheetName: string, readonly availableSheets: string[]) {
    super(
      `This document's previously selected sheet "${documentSheetName}" no longer exists in the workbook ` +
      `(available sheets: ${availableSheets.join(", ") || "(none)"}). The file was likely re-uploaded with ` +
      `different layout. Re-confirm which sheet holds this document's data before reading it again.`
    );
    this.name = "SheetSelectionLostError";
  }
}

/**
 * CSV, TSV, delimited text (.txt) and Excel: the files the engine's one plain-table reader reads
 * (TABLE_EXTS in api/parse-stats-file.py). Asked only of table documents, so a .txt transcript or
 * brief never reaches it.
 */
export function isPlainTableFileName(filename: string): boolean {
  return /\.(csv|tsv|txt|xlsx|xls)$/i.test(filename);
}

type EngineTable = Partial<ParsedTable> & {
  sheetSelectionLost?: { documentSheetName: string; availableSheets: string[] };
};

const isCell = (v: unknown) => v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/**
 * Reads a CSV, TSV or Excel document through the engine. `selectedSheet` is the persisted sheet choice,
 * used as given (a missing one raises SheetSelectionLostError); `layout` is the document's data layout,
 * applied by the engine (a columns-as-cases file comes back flipped, one row per case). The answer is
 * checked before use: an answer that is not a table (wrong shape, a row that is not an object holding a
 * plain value for every header) fails the read instead of being stored as an empty or partial table.
 */
export async function parseTableDocument(
  storagePath: string,
  sourceFilename: string,
  options: { selectedSheet?: string | null; layout?: DataSetup["layout"] } = {},
): Promise<ParsedTable> {
  const answer = await runEngineConversion<EngineTable>("table", storagePath, sourceFilename, {
    selectedSheet: options.selectedSheet ?? null,
    layout: options.layout ?? "rows_are_cases",
  });
  if (answer?.sheetSelectionLost) {
    throw new SheetSelectionLostError(answer.sheetSelectionLost.documentSheetName, answer.sheetSelectionLost.availableSheets ?? []);
  }
  const headers = answer?.headers;
  const rows = answer?.rows;
  const wellFormed =
    Array.isArray(headers) && headers.every((h) => typeof h === "string") && new Set(headers).size === headers.length &&
    Array.isArray(rows) &&
    rows.every((r) => r !== null && typeof r === "object" && !Array.isArray(r) && headers.every((h) => Object.hasOwn(r, h) && isCell((r as Record<string, unknown>)[h]))) &&
    typeof answer.sheetName === "string" && typeof answer.reader === "string";
  if (!wellFormed) {
    throw new Error(`The data reader's answer for ${sourceFilename} is not a complete table, so nothing was stored. Read the file again.`);
  }
  return {
    headers: headers!,
    rows: rows as Record<string, TableCell>[],
    sheetName: answer.sheetName!,
    unsupportedIdentifierColumns: Array.isArray(answer.unsupportedIdentifierColumns) ? answer.unsupportedIdentifierColumns : [],
    encoding: typeof answer.encoding === "string" ? answer.encoding : null,
    dateColumns: Array.isArray(answer.dateColumns) ? answer.dateColumns : [],
    reader: answer.reader!,
  };
}
