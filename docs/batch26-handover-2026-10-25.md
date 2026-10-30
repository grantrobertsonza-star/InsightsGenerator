# Handover: one reader for CSV, TSV and Excel (main copy), 25 October 2026

Status: **implemented, ready for independent review.** Main copy, on top of batch25. Grant's decision
of 24 October (14:31): the Python engine is the one reader for CSV and Excel previews, as it already
was for SPSS and Stata. Addresses the seven open import findings: **TP500-F01, F02, F03** and
**IP1000-F01 to F04**. **Migration 0116** (additive) for Grant to apply. Nothing pushed or deployed.

Contracts: `claude/one-reader-import.md` (new) and `claude/column-names-and-preview-identity.md`
(updated). The CSM dashboard's duplicate table number, which was to go with this batch, was already
fixed in batch 19 (CT500-F02).

| Commit | What | Kind |
|---|---|---|
| repair commit | One reader; the seven findings; migration 0116; tests | correctness |
| docs commit | This handover and the status line | |

## The change

The stored preview of a CSV, TSV or Excel file is now the engine's own read (`read_table` over
`_read_raw`, the cached read the dictionary, categories, cross tabs and driver columns use). The
TypeScript reader is retired: `parseTable.ts` asks the engine (signed action `table`, result via the
converted copy, as `convert` does) and refuses an answer that is not a complete table. Within the
engine, library value inference is no longer used for these files: cells are read as written and typed
by one rule (`_typed_series`) in both layouts.

## By finding

- **TP500-F01 (literal names).** Header names and columns-as-cases row names are their literal text
  (`_literal_text`): `NaN`, `null`, `None`, `NA`, `01`, `TRUE`, `Infinity` stay names, never values or
  missing markers. The dictionary names the same variables as the stored table.
- **TP500-F02 (duplicate names).** One allocation rule in both layouts (`_dedupe_header_names`): literal
  names are reserved first, so `q, q, q (2)` give `q, q (3), q (2)` and the row literally named
  `q (2)` keeps its own values. Codex's repro: preview and calculation both give mean 250 for `q (2)`
  and 25 for `q (3)`, CSV and Excel. Tables found in Word/PDF text use the same rule in TypeScript
  (`dataSetup.allocateVariableNames`). The engine comment that described the rule wrongly is corrected.
- **TP500-F03 (`__proto__` correction).** `saveVariableOverride` reads the existing entry as an own
  property and writes it as a defined own property (`rowCells.cellValue`/`setCell`), so a first
  correction of any name is stored and a successful save means a stored correction. The ask-a-table
  lookup in `crosstabAsk.ts` reads corrections the same way.
- **IP1000-F01 (codes).** A variable is numeric only when every value is a plain decimal number (no
  leading `+`, no leading zero on a multi-digit whole part, no thousands separators, no words such as
  `inf`, no whole number beyond 2^53). `001`, `1`, `0001` and `+2` stay four codes in preview and
  categories. Identifier-like names keep literal text, as before.
- **IP1000-F02 (dates).** Excel date-formatted cells become ISO dates (`2024-01-01`, or with the time
  of day where there is one); the variables are recorded and named on the Data quality tab. The integer
  control 61, 25569, 36526, 45292 reads 1900-03-01, 1970-01-01, 2000-01-01, 2024-01-01, in preview and
  categories, in both layouts. CSV date text stays as written; an unformatted number stays a number.
- **IP1000-F03 (encoding).** One decoding policy before parsing: UTF-8 with or without BOM; UTF-16 with
  its BOM; otherwise Windows-1252, recorded and shown ("read as Windows-1252"); anything else refused,
  naming the byte. Code points are kept exactly (accents, combining marks, CJK, emoji) for comma,
  semicolon and tab files.
- **IP1000-F04 (malformed CSV).** The CSV is parsed with Python's `csv` reader in strict mode: an
  unterminated quoted value, text after a closing quote, or a row with more values than the header is
  refused with the line before anything is published, and the calculation refuses the same bytes. A
  failed re-read keeps the earlier stored table; a valid replacement recovers.

## Freshness of existing data

- **Stored tables.** `document_tables.read_provenance` (migration 0116) records reader, sheet, layout,
  encoding and date columns. A table with the current reader's provenance is shown after a structural
  check; any other (the retired reader's tables included) is compared with a fresh engine read and,
  when they differ, withheld with "Read the file again" on its Preview tab (replaces only the stored
  table). CSV tables are now checked too, not only workbooks.
- **Dictionaries.** `DICTIONARY_VERSION` 11: every cached dictionary of a CSV/TSV/Excel file is
  rebuilt once on its next read. Corrections are stored separately and survive.
- **Changed behaviour** (also in the contract): a name that used to be read as a value now keeps its
  literal text, so a correction saved under the old name no longer applies to that variable; codes,
  CSV TRUE/FALSE and very large whole numbers are text; malformed or wrongly encoded CSVs are refused.
  Findings and tables calculated before keep their figures until recalculated.
- SPSS/Stata/SAS files now refuse a columns-as-cases layout in the stored table too, as every
  calculation already did. A flipped workbook whose Codebook declares weights or multiple-response
  sets is refused at the read (Preview tab), no longer previewed and refused only in Variables.

## Files

- Engine: `api/parse-stats-file.py` (`_read_plain` rewritten; `_typed_series`, `_decode_plain_text`,
  `_csv_grid`, `_flipped_frame`, `read_table`; `_flip_types`, `_converts_exactly`,
  `_normalize_na_strings` removed; signed action `table`); `scripts/parse_stats_worker.py`,
  `scripts/parse_stats_local.py` (dispatch).
- App: `parseTable.ts` (rewritten), `parseStatsFile.ts` (`runEngineConversion`), `documentTables.ts`,
  `importPreviewIdentity.ts`, `previewActions.ts`, `dataSetup.ts`, `variableOverrides.ts`,
  `crosstabAsk.ts`, `crosstabs.ts` (`minimumDictionaryVersion`), `page.tsx`, `ImportQualityPanel.tsx`
  (read notes; recovery button), `ReadFileAgainButton.tsx` (new), `FindingsTable.tsx` (type).
- `supabase/migrations/0116_document_table_read_provenance.sql` (new).
- Tests: `oneReaderImport.db.test.ts` (new, 7: one per finding, real database and actual engine),
  `engineTableReader.test.ts` (new); `importPreviewIdentity.test.ts` rewritten (12, actual engine);
  updated for the one reader: `sheetSelectionConsistency`, `previewAuthority`, `columnsAsCases`,
  `dictionaryCacheUpgrade`, `engineCodeIdentity` (a whole number beyond 2^53 is text now),
  `engineLabelConflicts`, `reservedColumnNames`, `labelDiagnosticsNotice`, `importVariablesHydration`.
- Browser: `e2e/ui/one-reader-import.check.mjs` (new).

## Checks run

Real disposable PostgreSQL 16 (migrations through 0116), the actual Python engine (pandas 3.0.5,
openpyxl 3.1.5, xlrd 2.0.1, pyreadstat 1.2.8 in this sandbox) and the disposable browser stack.

- `npx tsc --noEmit`: clean.
- `oneReaderImport.db.test.ts`: **7 passed**, one per finding, through the actual extraction,
  dictionary, categories, driver columns and correction actions, each checked against values written
  out from the source bytes. Mutation checks, each undone after: names put through the missing-token
  rule (F01 fails); sequential duplicate allocation (F02 fails); codes read as numbers (IP01 fails);
  dates left unconverted (IP02 fails); a legacy decode before UTF-8 (IP03 and F01 fail); lenient CSV
  quoting (IP04 fails); the prototype assignment restored (F03 fails).
- Full library (`npx vitest run src/lib/__tests__ --pool=forks`): **1,729 passed, 72 skipped, 0 failed**
  (229 files).
- Full browser suite (`npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`): 104 passed,
  1 skipped, 2 failed, both checks written for the retired reader:
  - `flipped-codebook-guard` expected the refusal on the Variables tab of a file the old reader still
    previewed; the one reader refuses the read itself, so the refusal and its re-export guidance are on
    the Preview tab. The check now looks there; the recovery part is unchanged.
  - `raw-file-reopen` used a storage download as its proof that a layout change re-reads the file; the
    local engine runner keeps a recent download, so a re-read need not download. The rewritten stored
    table (row version) is now the positive control, as the check already also asserted.
  Rerun of those two and the new `one-reader-import` check: **3 passed**. Smoke: 1 passed.
- New browser check `one-reader-import`: malformed CSV refused and still refused after reload with no
  table stored; Windows-1252 CSV stored with its accents and the codes 001, 1, 0001, and the Data
  quality note shown; Excel dates stored as calendar dates and noted; a table the old reader stored
  withheld on its Preview tab and replaced by "Read the file again". Screenshots inspected.

Mocks: storage (in-memory stand-ins) and the model (never reached). The engine, database, actions and
browser are real.

## Limits

- Excel's 1904 date system is read as the workbook declares it (openpyxl/xlrd), not separately tested.
- Legacy encodings other than Windows-1252 and UTF-16 are refused rather than guessed.
- Until a file is read again, a table without provenance costs one engine read per page view.
- Output-set files and coded-import workbooks keep their own readers (not respondent data tables).
- A correction saved under a name the old reader produced is not moved to the variable's new name.
