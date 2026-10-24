import * as XLSX from "xlsx";
import { supabaseAdmin } from "./supabaseAdmin";
import { assertImportFileSupported, assertImportCaseCount } from "./importLimits";
import { setCell } from "./rowCells";

const BUCKET = "documents";

export type ParsedTable = {
  headers: string[];
  rows: Record<string, string | number | null>[];
  /** IMP-SHIP-001: the workbook sheet this table was actually read from. Always set, even
   *  for a single-sheet workbook or a CSV (where it's the sheet's own name, or "Sheet1" for
   *  a CSV, which XLSX.read gives every CSV it parses) - callers that persist a document's
   *  sheet choice need this even when there was no real choice to make. */
  sheetName: string;
  /** IMP-SHIP-002 (Codex round 2, "define supported identifier-format behavior"): headers
   *  of id-like columns whose Excel cell format is a custom numeric pattern this pipeline
   *  cannot guarantee the Python/pandas side can replicate (anything beyond a plain
   *  all-zero zero-padding pattern like "0000" - see _ZERO_PAD_FORMAT_RE in
   *  api/parse-stats-file.py). This preview itself always reads the cell's own formatted
   *  text correctly via SheetJS's `.w`, so it is never wrong on its own; this list exists
   *  so a caller can surface "this identifier column's formatting may not match the
   *  calculated values" instead of the two sides silently disagreeing with no signal
   *  either side was even aware of a risk. Empty when every id-like column is either
   *  plain text, unformatted, or zero-padding only. */
  unsupportedIdentifierColumns: string[];
};

/** IMP-SHIP-001 (Codex round 2, "a missing selected sheet must produce an explicit
 * recovery state, never automatic substitution"): thrown when a caller passes a
 * `selectedSheet` that no longer names a real sheet in this workbook (the document was
 * re-uploaded with a different sheet layout, say). Previously this silently fell back to
 * independently re-deriving a sheet, which is exactly the kind of "continue with an
 * unconfirmed selection" the new instruction rules out - a stale, no-longer-valid
 * provenance value must surface as an explicit, recognizable failure instead, so a caller
 * (eventually the UI) can prompt the document's sheet choice to be re-confirmed rather
 * than silently serving data from a sheet nobody approved.
 *
 * Only a *named but missing* sheet triggers this. A `selectedSheet` of `null`/`undefined`
 * (nothing has ever been persisted for this document) is not an error - that is the
 * legitimate first-ever read, and still resolves via `pickDataSheet`. */
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

// A sheet whose name looks like a codebook/dictionary/notes page rather than
// the actual data, same test api/parse-stats-file.py's _read_plain runs
// (_DICT_SHEET_RE) before it picks the largest remaining sheet as the data
// sheet. Kept identical on purpose: a workbook with a "Cover" or "Codebook"
// sheet ahead of "Data" must resolve to the same sheet in the preview as it
// does when the file is actually calculated from, or a researcher can
// approve a different sheet than the one the numbers come from.
const DICT_SHEET_RE = /variable|dictionary|codebook|label|metadata|legend|value|code|lookup|readme|notes|schema/i;

// The same literal tokens pandas' read_csv/read_excel treat as missing by
// default (pandas.io.parsers.STR_NA_VALUES). Python's own reader applies
// this automatically; SheetJS does not, so without this a preview can show
// a literal "NA" or "NULL" as if it were real data when it will calculate
// as a missing value once read with the Python/pandas side of the pipeline.
const NA_TOKENS = new Set([
  "", "#N/A", "#N/A N/A", "#NA", "-1.#IND", "-1.#QNAN", "-NaN", "-nan",
  "1.#IND", "1.#QNAN", "<NA>", "N/A", "NA", "NULL", "NaN", "None", "n/a", "nan", "null",
]);

// IMP-SHIP-002: ported verbatim from api/parse-stats-file.py's _ID_HEADER_TOKENS /
// _header_tokens / _is_id_like_header. A header naming an identifier ("ID",
// "Respondent ID", "Case_ID", "RespID", "UUID") is read as literal text here too, so a
// leading-zero identifier like "001" keeps its zero instead of SheetJS's usual per-cell
// numeric inference silently reading it as the number 1 - the same reason Python forces
// these columns to a string dtype. Matched by whole token, not substring, so an ordinary
// word that happens to end in "id" (Avoid, Valid, Solid, Void) is left to its normal,
// inferred type, exactly as on the Python side.
const ID_HEADER_TOKENS = new Set(["id", "ids", "uuid", "guid"]);

// Mirrors api/parse-stats-file.py's _ZERO_PAD_FORMAT_RE exactly: the one custom Excel
// number format this pipeline guarantees parity for on an id-like column (plain
// all-zero digit placeholders, e.g. "0000"). Any other custom format on an id-like
// column is flagged via `unsupportedIdentifierColumns` rather than silently assumed safe.
const ZERO_PAD_FORMAT_RE = /^0+$/;
const GENERAL_FORMAT_RE = /^general$/i;

function headerTokens(name: string): string[] {
  const spaced = name.replace(/(?<=[a-z0-9])(?=[A-Z])/g, " ");
  const cleaned = spaced.replace(/[^A-Za-z0-9]+/g, " ");
  return cleaned
    .split(/\s+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
}

function isIdLikeHeader(name: string): boolean {
  return headerTokens(name).some((t) => ID_HEADER_TOKENS.has(t));
}

/**
 * IMP-003: the same whitespace/duplicate-header disambiguation api/parse-stats-file.py's
 * _read_plain applies to a repeated header ("q, q, q (2)" -> "q", "q (2)", "q (3)"),
 * ported statement-for-statement so the two sides can never assign a colliding header a
 * different canonical name. `used` starts as every already-trimmed header (so a generated
 * name never collides with a genuine one), and a generated name that would itself already
 * belong to another real column is bumped past it rather than reused.
 */
function dedupeHeaders(headers: string[]): string[] {
  if (new Set(headers).size === headers.length) return headers;
  const used = new Set(headers);
  const counts = new Map<string, number>();
  const renamed: string[] = [];
  for (const h of headers) {
    const count = (counts.get(h) ?? 0) + 1;
    counts.set(h, count);
    if (count === 1) {
      renamed.push(h);
      continue;
    }
    let n = count;
    let candidate = `${h} (${n})`;
    while (used.has(candidate)) {
      n += 1;
      candidate = `${h} (${n})`;
    }
    counts.set(h, n);
    used.add(candidate);
    renamed.push(candidate);
  }
  return renamed;
}

/**
 * IMP-SHIP-001 (Codex round 2): counts this sheet's actual DATA rows (any row, after the
 * header row, with at least one non-blank cell) - the same measure api/parse-stats-file.py
 * now ranks candidate sheets by. This replaced ranking by the sheet's formatted `!ref`
 * extent, which Codex's Sparse/Dense fixture showed could disagree with Python's own old
 * parsed-dataframe-size ranking: a sheet formatted out to a large empty range (borders,
 * number formats, column widths applied across cells with no actual values) inflated its
 * `!ref` dimension far past its real content, so a 1-data-row sheet formatted to A1:J101
 * out-ranked a genuinely 10-row sheet. Counting only rows that actually have a value
 * removes the disagreement at its source, rather than only papering over it with
 * provenance persistence once two readers have already reached different answers.
 */
function countDataRows(workbook: XLSX.WorkBook, sheetName: string): number {
  const sheet = workbook.Sheets[sheetName];
  const ref = sheet?.["!ref"];
  if (!ref) return 0;
  const range = XLSX.utils.decode_range(ref);
  let count = 0;
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell || cell.v === undefined) continue;
      // Codex round 3: a cell must not count as "data" for ranking purposes merely
      // because it has non-blank text - a literal "NA"/"NULL" typed into a cell is
      // exactly the kind of value the rest of this file (and _read_plain's own
      // `_normalize_na_strings` pass) already treats as missing once actually read, so
      // ranking must apply the identical trimmed-NA-token rule or the two sides can
      // disagree on which sheet has more real data purely because one of them contains
      // literal missing-value tokens. Mirrors api/parse-stats-file.py's
      // `_is_blank_or_na_token` exactly: trim, then check for empty or a known token.
      const text = String(cell.v).trim();
      if (text !== "" && !NA_TOKENS.has(text)) {
        count++;
        break;
      }
    }
  }
  return count;
}

function pickDataSheet(workbook: XLSX.WorkBook): string {
  const names = workbook.SheetNames;
  const candidates = names.filter((n) => !DICT_SHEET_RE.test(n));
  const pool = candidates.length > 0 ? candidates : names;
  return pool.reduce((best, n) => (countDataRows(workbook, n) > countDataRows(workbook, best) ? n : best), pool[0]);
}

function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell) return "";
  if (cell.w !== undefined) return String(cell.w);
  if (cell.v !== undefined) return String(cell.v);
  return "";
}

/**
 * Reads a table/data document (CSV or Excel) out of storage and returns it
 * as rows keyed by column header, so the insight generator can reason about
 * it as structured data rather than raw text.
 *
 * IMP-SHIP-001: `selectedSheet`, when given, is a sheet name a prior read of this same
 * document already resolved (persisted on documents.selected_sheet) - used directly,
 * without re-deriving a choice. If it no longer names a real sheet in this workbook (a
 * re-uploaded file could have dropped it), this throws `SheetSelectionLostError` rather
 * than silently substituting a different sheet - see that class's own comment. Omitted
 * entirely (no sheet chosen for this document yet) falls back to picking a sheet the same
 * way as before. Either way the sheet actually used is returned as `sheetName`, so a
 * caller can persist it as the new authoritative choice when none was supplied.
 */
export async function parseTableDocument(storagePath: string, selectedSheet?: string | null): Promise<ParsedTable> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`Could not download table from storage: ${error?.message}`);
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  assertImportFileSupported("", buffer.length);

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
    workbook = XLSX.read(buffer, {
      type: "buffer",
      // IMP-SHIP-002/item 6 (Codex round 2): cellStyles is required for SheetJS to
      // populate cell.z (the cell's Excel number-format string). Without it, every
      // cell.z is undefined and the unsupported-identifier-format detection below can
      // never fire, silently losing the "or explicitly report unsupported formatting"
      // half of the identifier contract.
      cellStyles: true,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `This file doesn't parse as a spreadsheet (${reason}). If it's a Word document or PDF that was ` +
      `uploaded as a "Table" document, delete it and re-upload it as a "Report" instead.`
    );
  }
  let dataSheetName: string;
  if (selectedSheet) {
    if (!workbook.SheetNames.includes(selectedSheet)) {
      throw new SheetSelectionLostError(selectedSheet, workbook.SheetNames);
    }
    dataSheetName = selectedSheet;
  } else {
    dataSheetName = workbook.SheetNames.length > 1 ? pickDataSheet(workbook) : workbook.SheetNames[0];
  }
  const sheet = workbook.Sheets[dataSheetName];

  const ref = sheet["!ref"];
  if (!ref) return { headers: [], rows: [], sheetName: dataSheetName, unsupportedIdentifierColumns: [] };
  const range = XLSX.utils.decode_range(ref);
  const headerRowIndex = range.s.r;

  const rawHeaders: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRowIndex, c })];
    rawHeaders.push(cellText(cell).trim());
  }
  const headers = dedupeHeaders(rawHeaders);
  const idLike = headers.map((h) => isIdLikeHeader(h));
  const unsupportedIdentifierColumns = new Set<string>();

  const rows: Record<string, string | number | null>[] = [];
  for (let r = headerRowIndex + 1; r <= range.e.r; r++) {
    const row: Record<string, string | number | null> = {};
    let rowHasValue = false;
    for (let i = 0; i < headers.length; i++) {
      const c = range.s.c + i;
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      let value: string | number | null;
      if (!cell || cell.v === undefined) {
        value = null;
      } else if (idLike[i]) {
        // Codex round 2, "define supported identifier-format behavior": flag the column
        // when its format is something other than plain text or zero-padding, so a caller
        // knows the Python/pandas side may not be able to reproduce this exact value.
        const unsupportedFormat =
          typeof cell.v === "number" &&
          !!cell.z &&
          !GENERAL_FORMAT_RE.test(cell.z) &&
          !ZERO_PAD_FORMAT_RE.test(cell.z);
        if (unsupportedFormat) {
          unsupportedIdentifierColumns.add(headers[i]);
          // Overnight queue, "resolve the unsupported-ID disagreement": this branch used to
          // still return the cell's own rendered text (e.g. "123,456") even after flagging
          // the column, while api/parse-stats-file.py's _apply_zero_padded_id_formats
          // already nulled the identical cell - identical bytes produced formatted text in
          // TypeScript and null in Python, exactly the disagreement a crosstab/case-join
          // consumer of "the same identifier" could silently act on differently depending
          // on which reader touched it last. There is no general Excel number-format
          // interpreter here (deliberately out of scope - see the comment on
          // _apply_zero_padded_id_formats), so this cannot be upgraded to "preserve
          // identical canonical identifiers": the only consistent contract achievable is
          // to BLOCK the value on both sides - null it - rather than let either side guess.
          // A null here is an explicit, visible gap (already handled by row-dropna logic
          // and by anything that joins on this column) instead of a value that looks
          // confirmed but silently disagrees with Python's.
          value = null;
        } else {
          // IMP-SHIP-002: an id-like header is read from the cell's own formatted text, the
          // same way Python's dtype=str trick for an id-like column keeps a leading-zero
          // identifier like "001" intact instead of letting numeric inference collapse it to 1.
          const text = cell.w !== undefined ? String(cell.w) : String(cell.v);
          value = NA_TOKENS.has(text.trim()) ? null : text;
        }
      } else if (typeof cell.v === "string") {
        value = NA_TOKENS.has(cell.v.trim()) ? null : cell.v;
      } else if (typeof cell.v === "number" || typeof cell.v === "boolean") {
        value = cell.v as number;
      } else {
        const text = cell.w !== undefined ? String(cell.w) : null;
        value = text === null || NA_TOKENS.has(text.trim()) ? null : text;
      }
      if (value !== null) rowHasValue = true;
      setCell(row, headers[i], value);
    }
    // Mirrors Python's `df.dropna(how="all")` in _read_plain, run after the same NA-token
    // normalization: a row with nothing but blank/NA cells across every column is dropped
    // entirely rather than kept as a row of nulls, so preview and calculated row counts agree.
    if (rowHasValue) {
      rows.push(row);
      assertImportCaseCount(rows.length);
    }
  }

  return { headers, rows, sheetName: dataSheetName, unsupportedIdentifierColumns: [...unsupportedIdentifierColumns] };
}
