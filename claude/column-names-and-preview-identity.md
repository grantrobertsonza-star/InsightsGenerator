# Column names as data, and the stored preview check

Codex TR500-F01 (2026-10-23).

A column's name is the researcher's data and is used unchanged as its canonical identity. Some names
are special to plain JavaScript objects: assigning `row["__proto__"] = 10` sets the object's prototype
rather than storing 10, and reading `row["constructor"]` from a row with no own value of that name
returns a function. Before this repair a `__proto__` column kept its header while every value in it
was lost, in both layouts, and the stored-preview check passed the damaged rows.

## The rule

`src/lib/rowCells.ts` is the one rule:

- `setCell(row, name, value)` defines the value as the row's own property. Every reader that builds
  rows keyed by column name uses it: the workbook/CSV reader (`parseTable.ts`), the columns-as-cases
  flip (`dataSetup.transposeTable`), tables read from documents (`documentTables.ts`) and the
  crosstab export rows (`crosstabs.ts`).
- `cellValue(row, name)` reads only the row's own value (undefined when it has none).

Rows built this way serialise to JSON with the column, and JSON parsing (the database, the engine's
replies) gives own properties back, so stored rows and everything read from them keep the values. No
name is renamed or dropped; a repeated name gets the usual " (2)" suffix.

## The stored preview check

`importPreviewIdentity.loadImportPreviewIdentities` compares the stored preview with a fresh read of
the selected sheet. A stored row now matches only when it holds its own value (null included) for
every header and that value equals the fresh read's own value. The reader writes every header on
every row it keeps, so a stored row without one was damaged; a missing or inherited property is never
read as "missing equals missing", and a reread through the same defect cannot certify it. A preview
damaged by the earlier reader is shown as not verified, with the usual recovery (read the file again).

## Agreement with the engine

The Python engine reads the file's own bytes with pandas, where these names are ordinary. Its case
count, valid counts and category counts for such columns now agree with what the app stores, in both
layouts (`reservedColumnNames.db.test.ts`).

## Not covered

Maps keyed by variable name elsewhere (question types, label lookups) are not part of this rule;
they hold settings, not data values. A sheet named `__proto__` is SheetJS's own concern.
