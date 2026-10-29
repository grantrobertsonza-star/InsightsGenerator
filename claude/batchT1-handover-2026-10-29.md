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
