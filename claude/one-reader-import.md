# One reader for CSV, TSV and Excel

Grant, 24 October 2026 (14:31): the Python engine is the one reader for CSV and Excel previews, as it
already was for SPSS and Stata. Built in batch 26 against Codex TP500-F01/F02/F03 and IP1000-F01 to
F04. Contract for `api/parse-stats-file.py` (`_read_plain`, `read_table`), `src/lib/parseTable.ts`,
`documentTables.extractAndStoreDocumentTables` and `importPreviewIdentity.ts`.

## One read

The stored preview (`document_tables`) of a CSV, TSV or Excel file is the engine's `read_table`
answer, which is `_read_raw`: the same cached read the dictionary, categories, cross tabs and driver
columns use. The TypeScript reader (SheetJS cell inference, its own missing tokens, duplicate names and
flip) is retired. `parseTableDocument(storagePath, filename, { selectedSheet, layout })` asks the
engine (action `table`, signed like every engine action; the result is written to the file's converted
copy and read back, as `convert` does) and refuses an answer that is not a complete table.

## Reading rules

- **Encoding (CSV/TSV).** UTF-8 with or without a byte-order mark; UTF-16 when the file starts with a
  UTF-16 byte-order mark; otherwise Windows-1252 (Excel's "CSV" on Western-locale Windows). The encoding
  used is stored (`read_provenance.encoding`) and a non-UTF-8 read is shown on the Data quality tab. A
  file that is none of these is refused, naming the byte; no replacement characters are ever read in.
  Code points are kept exactly; nothing is normalised.
- **Delimiter.** `.tsv` is tab; a `.csv` delimiter is sniffed (`,` `;` tab `|`) from its first lines,
  defaulting to `,`.
- **Quoting.** Python's `csv` reader in strict mode: quoted fields, doubled quotes and line breaks inside
  quotes are read as written. A quoted value never closed, or text after a closing quote, is refused
  with the line before anything is published (IP1000-F04). A row with more values than the header is
  refused unless the extra values are empty (a trailing delimiter); a short row is padded with missing
  values; blank lines are skipped.
- **Excel.** Cells as the workbook holds them: text, number, logical or calendar value
  (`_excel_sheet_grid`, which converts each cell as pandas' openpyxl and xlrd readers do but does not
  build a DataFrame from them, because that step merged TRUE with 1 and FALSE with 0 in a column holding
  both, CAL-R1-F03; blank rows kept, rows padded to the widest). Sheet choice: the persisted `selected_sheet`, else the non-dictionary
  sheet with the most real data rows; a persisted sheet that is gone is answered as
  `sheetSelectionLost` (the app raises `SheetSelectionLostError`), never substituted.
- **Names.** Literal text (`_literal_text`), trimmed; allocated by `_dedupe_header_names` in both layouts
  (`claude/column-names-and-preview-identity.md`). Excel number cells as names are written without
  ".0", logical cells as TRUE/FALSE, calendar cells in ISO form.
- **Missing values.** A response value is missing when blank, a library missing value, or one of
  `_NA_STRING_TOKENS` after trimming (the declared policy, unchanged). Names are never put through it.
  A row (rows-as-cases) or a variable row (columns-as-cases) with nothing but missing cells and no name
  is skipped.
- **Types (`_typed_series`, both layouts).** An identifier-like name keeps every value as literal text.
  Otherwise a variable is numeric only when every value is a plain decimal number: no leading `+`, no
  leading zero on a multi-digit whole part, no thousands separators, no words such as `inf`, and no
  whole number beyond 2^53 (the stored preview holds numbers as JSON doubles, so a larger one would
  differ between preview and calculation). Whole numbers with no gaps are int64; otherwise float with
  missing as NaN. Anything else is text exactly as written, so `001`, `1`, `0001` and `+2` stay four
  codes (IP1000-F01). CSV `TRUE`/`FALSE` are text; Excel logical cells stay logical (stored `true`/`false`, shown as TRUE/FALSE by `rowCells.cellText` in every table preview, Codex B26-F02; a logical cell is an answer, never missing, in Data quality). Excel text and
  number cells in one mixed variable keep their own types. A logical cell in a variable that also holds
  other values is stored as its text, `TRUE` or `FALSE` (CAL-R1-F03): Python counts True as 1, so kept
  as a logical value it would be counted as the same answer as a 1. Reader `engine-plain-2026.10.26c`,
  dictionary version 14 (Excel caches rebuilt; CSV/TSV version-13 caches stay valid).
- **Dates (IP1000-F02).** A calendar cell (an Excel date-formatted number, read through openpyxl or
  xlrd) becomes ISO text: `2024-01-01` for a date with no time of day, `2024-01-01T10:30:00` otherwise,
  `10:30:00` for a time alone. No time zone is read or applied. The variable is listed in
  `read_provenance.dateColumns` and on the Data quality tab. CSV date text stays as written. A number
  with no date format stays a number.
- **Identifier formats.** Unchanged: a zero-padding Excel format on an identifier column is applied
  (`0007`); any other custom number format on one blanks the cell in preview and calculation alike and
  is reported (`unsupportedIdentifierColumns`).
- **Layouts.** Columns-as-cases is flipped by the engine for CSV/TSV/Excel. SPSS, Stata and SAS files
  refuse that layout in the stored table as in every calculation. Tables found in Word/PDF text are
  flipped in TypeScript (`transposeTable`) with the same naming rule.

## Provenance and freshness

`document_tables.read_provenance` (migration 0116): `{ reader, sheet, layout, encoding, dateColumns }`,
written with each engine-read table and cleared for a table read any other way. Older tables are
checked against a fresh read before they are shown (`importPreviewIdentity.ts`). The engine's
`DICTIONARY_VERSION` is 12 and the reader `engine-plain-2026.10.26` (the exact-number rule below): every
older cached dictionary of a CSV/TSV/Excel file, in either layout, is rebuilt on its next read (`crosstabs.minimumDictionaryVersion`); corrections live separately in
`documents.variable_overrides` and are applied on top, so a rebuild cannot lose them.

## Behaviour that changed for existing files

- A name that used to be read as a value (`NaN` became blank, `01` became `1`) now keeps its literal
  text, so a correction saved under the old name no longer applies to that variable; the variable shows
  without the correction until it is made again.
- Zero-padded and signed codes in a non-identifier column are text, not numbers; CSV `TRUE`/`FALSE` are
  text. One typing policy for numbers written as text, in any spelling (`_exact_decimal` and the
  integer branch, Codex B26-F01 and RP0-M01): a magnitude beyond 2^53 makes the variable text
  (`9007199254740993`, `9007199254740994.0`, `9.007199254740993e15`, `1e16`, `1e30`), even when the
  value happens to be a representable double; below that, a decimal or exponent spelling must round-trip
  (the double's shortest text must be the number written), so a spelling with more significant digits
  than a double holds is text too. 2^53 itself, `0.1`, `2.50` and `1e3` are numbers. Distinct written
  values therefore never merge. Excel number cells are doubles in the file and are not put through this
  rule. Tables stored by readers `engine-plain-2026.10.25` and `engine-plain-2026.10.26` are compared
  with a fresh read and withheld with "Read the file again" when they differ. Tables and findings calculated before this
  change keep their figures until recalculated.
- A CSV with malformed quoting, too many values on a row, or bytes that are not UTF-8/Windows-1252 text
  is refused where it used to be read with guesses.
- Every CSV/TSV/Excel dictionary is rebuilt once (slower first open of each file after the change).

## Limits

- Excel's 1904 date system is read as the workbook declares it, through openpyxl/xlrd; it is not
  separately tested here.
- Legacy encodings other than Windows-1252 and UTF-16 are refused, not guessed.
- Pages read the stored provenance without an engine call; a table without provenance costs one engine
  read per page view until the file is read again.
- Statistical output files (output sets) and coded-import workbooks still have their own readers
  (`outputIngest.ts`, `codedImportFile.ts`); they are not respondent data tables and are out of scope.
