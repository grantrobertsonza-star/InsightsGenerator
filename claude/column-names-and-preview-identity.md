# Column names as data, and the stored preview check

Codex TR500-F01 (2026-10-23); TP500-F01 to F03 and the one reader (batch 26, 2026-10-25).

A column's name is the researcher's data and is used unchanged as its canonical identity. Some names
are special to plain JavaScript objects: assigning `row["__proto__"] = 10` sets the object's prototype
rather than storing 10, and reading `row["constructor"]` from a row with no own value of that name
returns a function. Before TR500-F01 a `__proto__` column kept its header while every value in it was
lost, in both layouts, and the stored-preview check passed the damaged rows.

## Names are literal, and allocated by one rule

CSV, TSV and Excel files are read only by the engine (`claude/one-reader-import.md`). A name is the
header cell's (or, columns-as-cases, the first cell's) literal text: `NaN`, `null`, `None`, `NA`, `01`,
`TRUE` and `Infinity` are names, never values, missing markers or numbers (TP500-F01). Repeated names
are allocated by `_dedupe_header_names` in both layouts: literal names are reserved first, so
`q, q, q (2)` become `q, q (3), q (2)` and the column literally named `q (2)` keeps its values
(TP500-F02). The stored preview, the dictionary, corrections and every calculation use these names.
`dataSetup.allocateVariableNames` is the same rule for tables found in Word/PDF text.

## Own properties

`src/lib/rowCells.ts` is the one rule for objects keyed by a name:

- `setCell(obj, name, value)` defines the value as an own property. Used by every builder of rows keyed
  by column name (`dataSetup.transposeTable`, tables read from documents in `documentTables.ts`, the
  crosstab export rows) and, since TP500-F03, by `saveVariableOverride` for the correction map.
- `cellValue(obj, name)` reads only an own value (undefined when there is none). Used by the stored
  preview check, the correction map's read in `saveVariableOverride` and the ask-a-table lookup in
  `crosstabAsk.ts`.

The engine's answers are JSON, and JSON parsing gives own properties, so a `__proto__` column read by
the engine keeps its values. TP500-F03: a first correction of a variable named `__proto__` used to be
assigned through the prototype setter and dropped by JSON while the save reported success; it is now
stored, reloads, combines with a second field and clears like any other (`oneReaderImport.db.test.ts`).

## The stored preview check

`importPreviewIdentity.loadImportPreviewIdentities` decides whether a stored CSV/TSV/Excel table may be
shown as the file's data:

- a table whose `read_provenance` (migration 0116) names the current engine reader
  (`ENGINE_TABLE_READER`, kept equal to the engine's `TABLE_READER` by `engineTableReader.test.ts`),
  the document's persisted sheet (workbooks) and its current layout is that read; it is shown after a
  structural check that every stored row holds its own value for every header;
- any other table (stored by the retired TypeScript reader, an earlier engine reader, before 0116, or
  under another sheet or layout) is compared value by value with a fresh engine read, and withheld when
  they differ, with "Read the file again" on the Preview tab (`ReadFileAgainButton`, which replaces
  only the stored table).

A missing or inherited property is never read as "missing equals missing".

## Not covered

Maps keyed by variable name that hold settings rather than data (question-type definitions, label
lookups) are built with `Object.fromEntries`/`Object.entries`, which use own properties; they are not
otherwise audited here. A sheet named `__proto__` is the workbook library's own concern.
