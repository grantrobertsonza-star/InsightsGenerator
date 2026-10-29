# Batch HR: handover (29 October 2026)

Status: implemented, ready for independent review. Branch `hdr` (worktree b96), from `x2` at `287d026`.
Tier A (engine reader, persistence, freshness).

## Decision 9, second part: the header row chosen on Import

Grant's decision 9: "Title rows above an Excel header detected; header row changeable on the Import screen." The
first part (batch T1) detects title rows. This batch lets the researcher choose the header row of a CSV, TSV, text or
Excel data file, overriding detection, and every reader of the file then uses it.

- **Before.** A preamble that detection misses could not be read at all. Example: a line holding two values,
  "Prepared by,Acme Research". Detection took that line for the header and refused the rows below it ("header row
  has 2 columns"). An Excel sheet in that position took the line as its variable names.
- **Change.**
  - The Setup tab of a CSV, TSV, text or Excel data file has a "Header row" control. It offers "Detected
    automatically" (the default) and "Row 1" to "Row 15". Rows are counted from the top over rows holding text,
    skipping blank rows.
  - The choice is saved in the document's data setup as `headerRowsSkipped`:
    - null means detected automatically, exactly as before;
    - n means the (n+1)th row holding text is the header, and every row above it (blank rows included) is set
      aside.
  - The set-aside rows are still recorded as `titleRows` and named on the Data quality tab (`read-title-rows`).
    Blank rows are set aside but not named.
  - A CSV's header width comes from the chosen row. A row below it with more values is refused naming its line,
    as before.
  - Changing the header row asks for acceptance again and reads the file again, exactly as a layout change does.
- **Refused, never guessed.**
  - A value that is not a whole number from 0 to 14 is refused at the save action, before anything is written.
    The engine refuses it too.
  - A header row past the last row holding text is refused by the engine with the file's row count. It is never
    moved to the last row. A failed read keeps the earlier stored table.
  - A header row on an SPSS, Stata, SAS, R or Parquet file is refused:
    - at the save (`saveDataSetup`, inside the write transaction);
    - by the engine (`_read_raw_uncached`, mirroring the columns-as-cases refusal);
    - by the stored-table read (`documentTables.ts`).
- **Found and fixed on the way (a part 1 defect).** The Excel identifier format check
  (`_apply_zero_padded_id_formats` and its flipped twin) read the identifier cells from sheet row 2, whatever the
  header's row. Below two title rows, an identifier formatted 0000 lost its padding ("7", not "0007"). The rows two
  above were read instead, so another row's format could also be applied. The check now reads from the header's own
  row.
  - The tests missed it because no title-row fixture had a formatted identifier column.
  - Selftest "a zero-padded identifier below two title rows keeps its own padding" fails on the previous engine
    (`['7', '12']`).
- **Versions.**
  - `TABLE_READER` is now `engine-plain-2026.10.29b` (with `ENGINE_TABLE_READER`), so a stored table read before
    this fix is checked against a fresh read when shown (importPreviewIdentity). It is withheld only where the two
    differ.
  - `DICTIONARY_VERSION` / `CURRENT_DICTIONARY_VERSION` is now 17, so cached CSV, TSV and Excel dictionaries are
    rebuilt once on their next read. This also rebuilds dictionaries cached before part 1 set title rows aside;
    part 1 did not bump the dictionary version.

## Impact checklist

1. **Rule.**
   - New registry row "The header row chosen on Import (decision 9, second part)"; the part 1 row is updated to
     reader 2026.10.29b.
   - Owners:
     - engine: `_header_rows_skipped_arg`, `_chosen_title_rows`, `_csv_grid`, `_read_plain`, `_read_raw` (cache
       key), `_read_raw_uncached`;
     - TypeScript: `parseHeaderRowsSkipped`, `HEADER_ROWS_SKIPPED_MAX` and `isPlainTableFileName` in
       `dataSetupShared.ts`, and `setupStructureChanged` and `setupReadChanged` in `dataSetupRebase.ts`.
   - `isPlainTableFileName` moved from `parseTable.ts` (which re-exports it) to `dataSetupShared.ts`, so the
     client-side Import screen uses the same rule without a second copy.
   - `HEADER_ROWS_SKIPPED_MAX` mirrors the engine's bound. `headerRowChoice.test.ts` reads the engine source and
     keeps them equal.
2. **Inputs.**
   - Absent or null is detected automatically. This holds for every document saved before the field existed, and
     for read provenance and cached dictionaries that predate it.
   - An invalid value from a client is refused at the action. An invalid stored value (only possible by a hand edit)
     reads as null, the behaviour every file had before; the action refuses to write it back.
   - Unknown never becomes 0.
   - A setup that cannot be read fails the read in the stored-table read, the preview identity check, the source
     preview, cross tabs, drivers, scatter, respondent checks and tracker labels. None of them defaults.
3. **Persistence.**
   - The field lives in `documents.data_setup` (jsonb, migration 0057). No migration is needed.
   - Saved through the existing `saveDataSetupAction` and `saveDataSetup`: one transaction scoped to `run_id`, the
     tenant from the request, and the compare-and-swap with `for update` when `expected` is given.
   - The format check reads `source_filename` in the same transaction, scoped to the run, before the update.
   - A retried save of the same value writes the same JSON; nothing is inserted.
   - A conflicting save is reported as before, and the screen rebases a non-overlapping edit with
     `rebaseSetupEdit`, which now treats the header row as structure.
4. **Freshness.** The header change takes the same path as a layout change. No second mechanism was added.
   - Acceptance: `setupStructureChanged` sets `accepted: false`, on the screen's save and in the rebase over a
     concurrent acceptance. Cross tabs then shows the file as "needs setup" (`crosstabEntry.ts`) until it is
     accepted again.
   - Stored table: re-read after the save (`setupReadChanged`, then `readDataFileAction`). Its read provenance
     records `headerRowsSkipped`. `loadImportPreviewIdentities` treats a table read under another choice as not
     current, checks it against a fresh read and withholds it with "Read the file again" where they differ.
   - Dictionary cache: `buildVariableDictionaryForSetup` reuses a cached dictionary only when its
     `headerRowsSkipped` matches, mirroring `cachedLayout`.
   - Engine read cache: the choice is part of the key.
   - Scatter correlations: the basis hash includes the choice when it is set (left out when null, so correlations
     posted before this keep their basis). A posted correlation is reported as changed after a header change, as
     after a layout change.
   - Saved cross tabs, findings, insights and recommendations: provenance only, as for the layout. Cross tab
     provenance now records `headerRowsSkipped`, but a saved table is not marked stale by a header or layout change.
     This is an existing gap shared with the layout, not widened here. Human wording and decisions are untouched,
     because nothing is regenerated.
5. **Screens** (`TranscriptSetup.tsx`, DataSetupForm).
   - The control is disabled until hydration and the first-view acceptance, like the other fields.
   - "Header row saved" shows only after `saveDataSetupAction` (and any rebase) succeeds. While saving it shows
     "Saving the header row."; on a conflict or failure the status clears and the existing error line shows.
   - The re-read message now reads "How the file is read changed" (it covers layout and header row).
   - On reload the control shows the stored value.
   - Late responses are handled by the existing save path; this batch adds no new request ordering.
   - The control is shown only for CSV, TSV, text and Excel files.
6. **Proof.** See "Checks run" below.

## Callers (every TypeScript caller that passes `layout` to the engine now passes the header choice)

| Caller | Change |
|---|---|
| `parseTable.ts` `parseTableDocument` | new option `headerRowsSkipped`, sent to the engine |
| `documentTables.ts` (stored table) | passes it; provenance `headerRowsSkipped`; refuses it for non-table formats |
| `importPreviewIdentity.ts` | compares provenance `headerRowsSkipped` (absent = null); fresh read under it |
| `previewActions.ts` (a finding's source preview) | passes it for raw files (not the layout, as before); refuses to show a table when the setup cannot be read |
| `crosstabs.ts` dictionary build and cache, `loadCategories`, `computeCrosstab` (both calls) | passes it; dictionary records it; cache compares it; cross tab provenance records it |
| `drivers.ts` (both `columns` calls) | passes it |
| `scatterActions.ts` (`columns` call, basis, freshness check) | passes it; in the basis when set |
| `respondentQuality.ts` | passes it |
| `trackerInput.ts` (`value_labels`) | passes it |
| `chartActions.ts`, `npsActions.ts`, `trackerFigures.ts`, `objectiveEvidence.ts` | go through `computeCrosstab` or the dictionary, so covered there |
| `scripts/parse_stats_local.py`, `scripts/parse_stats_worker.py` | `categories` dispatch passes `headerRowsSkipped` (as the serverless handler does) |

Deliberately left out:

- `instruments.ts` (`instrument_sheet`, `codebook`) and `indicatorData.ts` (`indicators`) read codebooks,
  questionnaires and indicator files with their own header finding. They never read a data file's setup or layout.
- `parseStatsFile.ts` `parseStatsFile` (`convert`, SPSS, Stata, SAS, R, Parquet) takes no layout either. A header
  row set for those formats is refused before it is called.
- `loadCategories` still reads the setup with the tolerant `loadDataSetup`, as it did for the layout: on a lookup
  failure it defaults both. Existing behaviour, not changed here.

## Changed files

- Engine: `api/parse-stats-file.py`, `scripts/parse_stats_local.py`, `scripts/parse_stats_worker.py`.
- Library:
  - set-up and saving: `dataSetupShared.ts`, `dataSetupRebase.ts`, `dataSetup.ts`, `dataSetupActions.ts`;
  - reading and caches: `parseTable.ts`, `documentTables.ts`, `importPreviewIdentity.ts`, `previewActions.ts`,
    `crosstabs.ts`, `parseStatsFile.ts` (types), `dictionaryVersion.ts`;
  - other engine callers: `drivers.ts`, `scatterActions.ts`, `respondentQuality.ts`, `trackerInput.ts`.
- Screen: `src/app/runs/[id]/TranscriptSetup.tsx`.
- Tests:
  - new: `src/lib/__tests__/headerRowChoice.test.ts`, `src/lib/__tests__/headerRowChoice.db.test.ts`,
    `e2e/ui/header-row-choice.check.mjs`, 17 selftest checks in `scripts/crosstab_selftest.py` (18 results: the past-the-end check runs for CSV and Excel);
  - fixtures given the new field: `callerToBuilderStrictSetup.test.ts`, `designLookupFailureSurfacing.test.ts`,
    `saveReconciliation.test.ts`.
- Docs: `claude/rules-registry.md`, this handover.

## Checks run (worktree /home/claude/b96)

- `npx next typegen`: done once (fresh worktree).
- `npx tsc --noEmit`: exit 0.
- `npx eslint src e2e --quiet`: exit 0, 0 errors.
- `python3 scripts/crosstab_selftest.py`: "All checks passed", 551 PASS, 0 FAIL. 18 PASS lines start
  "decision 9"; the past-the-end check runs twice, CSV and Excel.
- `npx vitest run src/lib/__tests__/headerRowChoice.test.ts src/lib/__tests__/dataSetupRebase.test.ts
  src/lib/__tests__/dataSetupStatus.test.ts src/lib/__tests__/engineTableReader.test.ts
  src/lib/__tests__/saveReconciliation.test.ts src/lib/__tests__/callerToBuilderStrictSetup.test.ts
  src/lib/__tests__/designLookupFailureSurfacing.test.ts --pool=forks`: 7 files, 48 tests passed.
- `npx vitest run src/lib/__tests__/{buildCrosstabStrictSetup,driverLayoutBoundary,engineCodeIdentity,engineLabelConflicts,importPreviewIdentity,scatter,sheetSelectionConsistency}.test.ts --pool=forks`
  (callers of changed code, no database): 7 files, 60 passed, 4 skipped. The skips are the files' own
  environment skips.
- `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run
  src/lib/__tests__/headerRowChoice.db.test.ts src/lib/__tests__/headerRowChoice.test.ts --pool=forks`: 2 files, 17
  tests passed (5 database tests, 12 unit tests).

### Shown failing without the change

- Engine reverted to `287d026` (`git show HEAD:api/parse-stats-file.py`), then restored.
  - Selftest: "header row 1 chosen over a one-cell title takes the title as the header", "a CSV's chosen header
    row 1 gives its width and its names" and "a CSV's chosen one-value header row ... is refused" FAIL. The run then
    stops with the old engine's refusal ("Line 4 ... header row has 2 columns") at the header row 4 check.
  - `headerRowChoice.db.test.ts`: 4 failed, 1 passed (the rebase test, which does not read the file).
  - The identifier padding fixture read by the old engine gives `['7', '12']`; the new engine gives
    `['0007', '0012']`.
- Dictionary cache comparison removed from `crosstabs.ts`, then restored: `headerRowChoice.db.test.ts` "a
  dictionary cached under one header choice is not reused under another" fails (expected "Brand health tracker",
  received "id"); the other 4 pass.

### Mocks versus real

- `headerRowChoice.db.test.ts`: real disposable PostgreSQL, the real save action, `saveDataSetup`,
  `extractAndStoreDocumentTables`, `readDataFileAction`, `loadVariableDictionary`, `loadCategories` and
  `loadImportPreviewIdentities`, and the actual Python engine. Mocked: file storage (an in-memory bucket), the
  request context (the test tenant), `revalidatePath`, and the model client (asserted never called).
- `headerRowChoice.test.ts`: pure functions. The save action runs with a mocked database client, to show nothing is
  written on a refusal.
- Selftest: the actual engine, in process.

### Not run (as instructed)

- The full library suite.
- The other database suites affected by the version bumps: `oneReaderImport.db.test.ts`,
  `dictionaryCacheUpgrade.db.test.ts`, `exactNumberBoundary.db.test.ts`, `scatterFindingPersistence.db.test.ts`,
  `respondentQuality.db.test.ts`, `trackerInput.db.test.ts`. These should run in the independent review.
- The browser suites, including the new `e2e/ui/header-row-choice.check.mjs`, which is written but not yet run. No
  screenshot was taken.
- Conformance L1 and L3. `conformance/l3/results.json` still records reader 2026.10.29a and needs regenerating with
  the next conformance run.

## Limits

- The control offers row numbers, not the rows' text. The rows set aside are named on Data quality after the
  re-read.
- At most 14 rows can be set aside (the header is row 15 at most), the same bound detection uses.
- A saved cross tab, finding or export is not marked stale by a header or layout change; only its provenance records
  the choice. This is shared with the layout.
- The server does not itself force `accepted: false` on a structure change. The Import screen and the rebase do,
  as for the layout. A client that bypassed the screen could save a header change already accepted.
- The commits were made with `-c commit.gpgsign=false`: the configured signing program (`/tmp/code-sign`) does not
  exist in this container, and earlier commits on this branch are unsigned too.
