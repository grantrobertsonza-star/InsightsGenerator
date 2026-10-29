# Batch T1: handover (29 October 2026, evening)

Status: implemented, ready for independent review. On top of U1 (branch `x1`, worktree b93). Grant's outstanding
requests from today, worked through in order.

## Export all tables (Grant: "we also need to be able to export all tables not just one at a time")

- **On screen.** The table list in Cross tabs has "Export these N: Excel · PowerPoint · PDF" for the tables it
  lists, in the order shown. Under All tables, or when the list is longer than 150 tables (too long for a link),
  it reads "Export every table of this file" and exports every saved table of the open data file.
- **Route.** `crosstab/export` accepts `tableIds` (up to 500, in order) or `documentId`, as well as the existing
  single `tableId`. Each id is checked to be a saved table of this project; evidence tables are never exported.
- **Missing tables.** If a listed table is no longer saved (deleted meanwhile, or another project's), the export
  is refused with the count and a reload hint. It is never left out silently.
- **Workbook.** An Excel file with several tables starts with a Contents sheet: number, sheet name (linked),
  table title and data file. Sheet names are cut to 28 characters, so the title is needed.
- **Tests.**
  - `exportAllTables.db.test.ts` (5, real database and actual engine; 4 fail without the change): screen order
    and Contents, one file only, the refusal, malformed ids, and one PowerPoint of three tables.
  - `crosstab-wave-copy.check.mjs` step 5 downloads the workbook in the browser.
- **Not changed.** The measures exported are the defaults (column %, n, letters, NET) when several tables are
  exported; a single table's link still carries that table's own choices.

## Non-answer labels in level findings (registry gap)

- **Before.** `descriptiveFindings.ts` kept its own don't-know pattern. It missed "Not sure" (so a 5-point scale
  followed by Not sure was read as six points) and treated "Don't know which brand" as a non-answer, against
  Grant's decision 7.
- **Change.**
  - `src/lib/nonAnswerLabel.ts` `isNonAnswerLabel` is the engine's `_DK_RE`, written once for TypeScript.
    `nonAnswerLabel.test.ts` runs the engine's own pattern on 29 labels and requires the same verdict for each.
  - Level findings use it. "None of the above" and "Other (...)" stay out of the ranking, as before: they are
    answers, but they sit outside any ordering.
- **Tests.** `descriptiveFindings.test.ts` has 2 new tests, both failing without the change: Not sure after a
  scale, and a don't-know naming its subject.
- **Freshness.** Level findings are generated when a summary table's findings are made. Existing findings keep
  their wording until regenerated; none is changed silently.

## "NA" in a column of country codes (Grant's decision 5)

- **Decision.** "NA" stays missing, as pandas and every reader treat it, with a warning where it may be
  Namibia's code.
- **Change.**
  - The engine's one reader (`_typed_series`, both layouts, CSV, TSV and Excel) records a column as an NA-code
    column when all three hold:
    - one of its cells reads "NA";
    - its remaining values are text with at least three different codes;
    - four in five of them are two or three capital letters.
  - The list travels with the table's read provenance (`naCodeColumns`) and through the engine's read cache.
  - The Data quality tab's read notes say which variables, that "NA" was read as missing, and how to keep
    Namibia: recode the cells and upload again.
- **Unknown, not false.** Tables read before this have no `naCodeColumns`, so they show no warning. The reader
  version is unchanged on purpose: that version marks tables as built with an earlier method (R1-F01), and this
  change does not alter a single value. Reading the file again records the warning.
- **Tests.**
  - `oneReaderImport.db.test.ts` "decision 5" (actual engine, real database), covering CSV and the wide Excel
    layout:
    - the values are kept, with NA missing, and the categories follow;
    - a words column is not flagged;
    - a codes column without NA is not flagged.
  - `one-reader-import.check.mjs` step 3b checks the warning in the browser.

## Title rows above a table's header (Grant's decision 9, first part)

- **Before.** A CSV starting with a title line was refused: its next row had more values than the "header".
  An Excel sheet starting with a title took the title as its header, with names such as "Variable 2".
- **Change.** The engine's one reader sets aside up to 14 leading rows holding at most one written value, when
  the next row holds two or more.
  - Any written text counts, "NA" included (L1's literal-name case).
  - A CSV's header width is taken from that row.
  - A file whose rows never hold two values (one variable) is read from its first row, as before.
  - The title text is recorded (`titleRows`) and named on the Data quality tab.
- **Reader version.** `TABLE_READER` is now 2026.10.29a, so a table stored before this, or before batch 55's
  reading repairs, is checked against a fresh read when shown (importPreviewIdentity). It is withheld with
  "Read the file again" only where the two differ.
- **Not done.** The second part of decision 9, choosing the header row by hand on Import, needs the choice
  passed to every engine call (about 30 call sites, like the sheet and layout). It is recorded for a batch of its
  own.
- **Tests.**
  - `oneReaderImport.db.test.ts` "decision 9": CSV with two title rows and a blank line, Excel with a title and
    a blank row, a one-variable file, and a plain file.
  - Conformance L1: 324 pass, 0 fail. The first attempt counted "NA" as missing and failed the
    literal-NA-header case, so the rule now counts written text.
  - `one-reader-import.check.mjs` step 3c.

## Objectives filled from an imported brief without a click (Grant, 19:09: "objectives were not extracted automatically")

- **Before.** A brief filled Objectives only when chosen under "Fill in from a brief or proposal" and saved.
- **Change.** When Objectives first opens on a project that meets all of these, the form fills itself from the
  brief, through the same save as the Save button:
  - no business problem;
  - no objectives;
  - no fill yet, and no failed fill;
  - exactly one document imported as the brief, and at most one as the proposal.
- **What the save keeps.** Blank fields only. The same lineage, so an objective the researcher edited or deleted
  is not brought back. A failure is recorded and shown with "Try the fill again". The form says what it is
  filling while it works.
- **Never repeats.** Once a fill has run or failed, or anything is written, the condition is no longer met.
- **Limits.**
  - The fill happens when Objectives is opened, not at the moment of import. The overview's "No objectives yet"
    stays until then.
  - With two briefs nothing is chosen for the researcher.
- **Tests.** `objective-auto-fill.check.mjs` (browser, scripted model) checks the objective and business problem
  appear without a click, and that a reload does not read the brief again. The save itself is covered by
  `briefFillFromImport.db.test.ts`.

## Word, PDF and PowerPoint tables (path B: B-02, B-03, B-05, B-06; Grant's decision 11, "fix their failures")

- **B-02, banner groups.** The model is asked for each column's group from a row spanning several columns, and a
  column is named by it ("Wave 1: Yes"). A repeated name without a group becomes "Yes (2)" and is never
  overwritten. Before, rows kept only the last "Yes", and Wave 1's values were lost.
- **B-03, tables across reading parts.** Pages are read five at a time. A table on the last page of one part and
  one on the first page of the next are joined into one table when they have the same columns and the second has
  no title of its own (or the same one). The note says it continues.
- **B-05, pages.** A page the part did not read is never recorded as the table's page. The note says so.
- **B-06, row widths.** Rows longer or shorter than the columns are kept as read (surplus cells dropped, missing
  cells blank) and counted in the notes.
- **Recording.** The notes are recorded with the tables, in the same transaction (trace
  `document_table_reading_notes`). Showing them on the Import screen is left for the Tables redesign.
- **Tests.**
  - `documentTableShape.test.ts` (6, with boundaries).
  - Conformance L4 `documents.test.ts`: B-02, B-03, B-05 and B-06 pass. B-06's check now accepts "flagged", as
    its own expectation states.
  - L4's remaining failures there are research-basis items outside path B, as before: a picture of a table, chart
    data as a table, and two end-to-end claim checks.
  - The L4 runner's stand-in model now answers the group of each column, as the schema asks.

## D2b part 3: driver performance values for importance against performance

- **What it computes.** Each predictor's performance figure (`driverPerformance.ts`, one rule for the file and
  for each segment; the two copies in `drivers.ts` now call it):
  - a 0/1 indicator: its share (measure "share"), never a mean or top two;
  - a scale of 3 to 11 points: the share in its top two answers (measure "topTwo"), with the mean.
  - anything else (age, a long numeric): the mean only.
- **The scale top.** It comes from the engine (`driver_columns` `scaleTop`): the highest declared substantive
  answer, so a declared top nobody chose counts and a non-answer never does (the D3AR-F01 rule). Without an
  answer list it is the highest answer seen, and `scaleStated` says so. Before, the top two counted from the
  highest answer seen, so a scale where nobody chose 5 counted 3 and 4.
- **Non-answers.** `driver_columns` drops them through the answer-domain owner `_non_answer_codes` (labelled
  don't know and declared user-missing codes). Before, it used its own copy of the label rule only.
- **Mixed scales.** `performanceScales` is "mixed" when the predictors are not one kind on one scale, for example
  0/1 indicators beside 0 to 10 scores. It is on the report (`performanceScales`), so the view can state the
  caution.
- **Not built yet.** The importance against performance chart itself, which belongs to the driver page redesign
  (D5).
- **Older reports.** Reports saved before this have no `measure`, `scaleTop` or `performanceScales`. They read as
  before, and a recalculation adds them.
- **Tests.**
  - `driverPerformance.test.ts` (7, hand-computed, weighted included).
  - Engine self-test "D2b" (3): 6 = Don't know dropped, scale top 5 with no one choosing it, and no answer list.
    The two scale-top checks fail without the change.
  - The driver suites: 89 passed.

## The Brand tracking dashboard closing by itself (Grant, 29 October 2026, 21:27)

"The tracking dashboard shows the menu for a short while then goes." A wave read again under the new table reader
marks the file as being processed; the page refreshes and Analytics shows the file's processing view, which unmounts
its tools, so every open workspace came back closed. `useKeptOpen` (`src/app/runs/[id]/useKeptOpen.ts`) keeps which
workspace is open per run, file and place for the page's life, so the dashboard (and Driver, NPS, Chart, Wave
tracking, CSM and Brand Health workspaces) reopens and calculates again after such a refresh; closing it clears it.
Tier B. Proof: `keptOpenWorkspace.test.tsx` (mounted: open, unmount, remount still open; another file closed; closing
clears). With the previous plain `useState`, the remount comes back closed (the reported behaviour). Not yet shown in
a browser check that forces the refresh; the existing tracker-dashboard check covers opening.
