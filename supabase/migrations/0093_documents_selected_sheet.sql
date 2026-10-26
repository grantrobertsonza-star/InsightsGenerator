-- IMP-SHIP-001: a multi-sheet Excel workbook's "data sheet" used to be picked
-- independently on two different code paths - src/lib/parseTable.ts (preview /
-- findings-extraction, SheetJS-based, picks the sheet with the largest declared
-- `!ref` dimension range) and api/parse-stats-file.py's _read_plain (dictionary /
-- crosstab / driver-columns calculations, pandas-based, picks the sheet with the
-- largest actually-parsed size). A workbook with one sparse-but-formatted sheet
-- and one dense sheet could get a DIFFERENT sheet picked by each side, so a
-- researcher could approve a preview of one dataset while every calculation ran
-- against a different one with no indication the two had ever disagreed.
--
-- This column makes whichever side resolves a workbook's sheet FIRST the single
-- authoritative choice for that document from then on: the other side reads this
-- column and, when it names a sheet that still exists in the workbook, uses that
-- sheet directly instead of re-deriving its own pick. Null until the first read
-- happens (a document with only one sheet never needs this, and is left null).
alter table documents
  add column if not exists selected_sheet text;

comment on column documents.selected_sheet is
  'IMP-SHIP-001: the workbook sheet name a prior preview/extraction/dictionary read '
  'resolved as this document''s data sheet. Null until first resolved, or for a '
  'single-sheet workbook, a CSV/TSV file, or an SPSS/Stata/SAS file (no sheet '
  'ambiguity to record). Once set, every later read of this document must use this '
  'sheet rather than independently re-picking one, so preview and calculation can '
  'never silently disagree about which sheet a document''s data comes from.';
