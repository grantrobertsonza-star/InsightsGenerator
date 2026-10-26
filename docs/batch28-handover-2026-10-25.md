# Handover: B26-F01, B26-F02, B27-F01 and V-B27-01 (main copy), 25 October 2026

Status: **implemented, ready for independent review.** Main copy, on top of batch27 (`afc1b39`). Follows
`docs/independent-batch26-27-review-main-2026-10-25.md` and, for B26-F01/F02,
`docs/independent-batch26-review-main-2026-10-25.md`. No migration. Nothing pushed or deployed.

Contracts updated: `claude/one-reader-import.md` (exact-number rule, logical-cell display) and
`claude/document-deletion-contract.md` (erase link count).

| Commit | What | Kind |
|---|---|---|
| repair commit | B26-F01, B26-F02, B27-F01, V-B27-01; tests | correctness |
| docs commit | This handover and the status line | |

## B26-F01 (S2): decimal and exponent spellings beyond exact range

`api/parse-stats-file.py` `_exact_decimal` applies the exact-number rule to every decimal and exponent
spelling before a number is accepted: the double's shortest text (`repr`) must be the same number as the
text written. `9007199254740993.0`, `9.007199254740993e15`, a spelling with more significant digits than
a double holds, and an overflow or underflow fail it, so the variable stays text, exactly as written, and
distinct source values stay distinct. `0.1`, `2.50`, `1e3` and `9007199254740992.0` (2^53 itself) pass and
stay numbers. The integer branch is unchanged (`_MAX_EXACT_WHOLE`).

Freshness of existing data:

- Reader `engine-plain-2026.10.26` (`TABLE_READER`, `ENGINE_TABLE_READER`): a table stored by
  `engine-plain-2026.10.25` is no longer shown on provenance alone; it is compared with a fresh read and
  withheld with "Read the file again" when it differs, as for any older table.
- `DICTIONARY_VERSION` 12 and `minimumDictionaryVersion` 12 for CSV/TSV/Excel: a version-11 dictionary
  that merged such values is rebuilt on its next read. Corrections are stored separately and survive.
- `ENGINE_VERSION` `2026.10.26-1`. Findings and tables calculated before keep their figures until
  recalculated, as the one-reader contract already states.

## B26-F02 (S3): Excel logical cells blank in the visible preview

`rowCells.TableCell` (`string | number | boolean | null`) is the authoritative stored-cell type, used by
`parseTable.ts`, `parseStatsFile.ts`, `documentTables.ts`, `importPreviewIdentity.ts`, `previewActions.ts`,
`dataSetup.ts`, `dataQuality.ts`, `tableDigestCharts.ts` and the page. `rowCells.cellText` is the one
display rule: `true`/`false` show as TRUE/FALSE (as Excel shows them and as the engine writes a logical
name), zero shows as 0, only a missing cell is blank. It is used by the Import Preview
(`TranscriptSetup.tsx`), the run page's table preview (`page.tsx`) and the finding source viewer
(`FindingsTable.tsx`). Stored values are not converted. Two consequences of the type change: Data quality
counts a logical cell as an answer, never missing (`dataQuality.isMissing`), and the table digest charts
logical cells under TRUE/FALSE.

## B27-F01 (S3): erase counted links from restored removal snapshots

`documentBin.eraseRemovedDocument` counts relationships, each once, by identity:

- links held by the file's current bin entry (the removal not restored): groundings and contradictions
  with another file's findings, in either direction, including a claim's own grounding by another file's
  finding (kept on the claim's row in the snapshot, which the earlier count missed);
- links another file's bin entry holds to one of this file's findings (they cannot come back once this
  finding is gone).

Snapshots of earlier, restored removals are still erased with the file (history cleanup unchanged) but
never counted. A link whose other finding was already erased was counted by that erase and is not counted
again. The atomic purge, the storage cleanup queue and the restore hand-off are unchanged.

## V-B27-01: the flipped-workbook check

Intended presentation, now explicit: one notice per refusal. After a layout change, the read attempted in
the page fails and is reported in the source header at once; the page then refreshes
(`TranscriptSetup.save`, new) so the Preview tab withholds the stored table with the reason from a fresh
read and its recovery, and the header's report is then not repeated (`SourceHeader` shows it only while
the preview is not marked unverified). Before this, whether the page refreshed depended on timing, which
is why the full run saw both notices and isolated runs saw one. `flipped-codebook-guard.check.mjs` now
waits for the settled state (the Preview notice holding the refusal), then asserts one refusal, its
re-export guidance, no "SPSS/Stata/SAS" framing and "No cached rows or corrections are shown", before and
after reload; the recovery part is unchanged.

## Files

- Engine: `api/parse-stats-file.py` (`_exact_decimal`; `TABLE_READER`, `DICTIONARY_VERSION`,
  `ENGINE_VERSION`).
- App: `rowCells.ts` (`TableCell`, `cellText`), `parseTable.ts`, `parseStatsFile.ts`, `documentTables.ts`,
  `importPreviewIdentity.ts`, `previewActions.ts`, `dataSetup.ts`, `dataQuality.ts`,
  `tableDigestCharts.ts`, `crosstabs.ts` (`minimumDictionaryVersion`), `documentBin.ts`,
  `TranscriptSetup.tsx`, `FindingsTable.tsx`, `page.tsx`.
- Tests: `exactNumberBoundary.db.test.ts` (new, 3), `cellText.test.ts` (new, 3),
  `documentBinIntegrity.db.test.ts` (B27-F01 test added); dictionary-version expectations moved to 12 in
  `dictionaryCacheUpgrade`, `engineCodeIdentity`, `engineLabelConflicts`, `sheetSelectionConsistency`,
  `crosstabConcurrentSave`; a type in `columnsAsCases`.
- Browser: `e2e/ui/logical-cells-and-exact-numbers.check.mjs` (new); `flipped-codebook-guard.check.mjs`.

## Checks run

Real disposable PostgreSQL 16 (migrations through 0117), the actual Python engine and the disposable
browser stack.

- `npx tsc --noEmit`: clean.
- `exactNumberBoundary.db.test.ts`: **3 passed**: four distinct decimal/exponent spellings beyond exact
  range in CSV and Excel text cells, both layouts, stored, reloaded, categorised (one each) and typed as
  text; safe decimal, exponent and 2^53 controls numeric; a table stored by the earlier reader with the
  rounded values withheld and a version-11 dictionary rebuilt at 12 with four categories; a failed re-read
  keeps the old table, still withheld; the valid re-read stores the written values and is shown.
- `cellText.test.ts`: **3 passed** (display rule, Data quality missing rule, digest categories).
- `documentBinIntegrity.db.test.ts`: **9 passed** (8 earlier and B27-F01: one link after 0, 1 and 3
  remove/restore cycles through the actual erase action and its message; a contradiction and a grounding
  after two cycles counted as 2; a claim's own grounding; both ends in the bin counted once across two
  erases; refusal while not in the bin, then one count). `documentBin.db.test.ts`: 9 passed.
- Mutation checks, each undone after: the exact-number rule removed (2 of 3 B26-F01 tests fail);
  `minimumDictionaryVersion` left at 11 (the legacy-cache test fails); batch27's `documentBin.ts` restored
  (the B27-F01 test fails with "2 links"). Restricting the count to the current removal alone is not
  separately detected, because counting by identity already removes the repeats; both are kept.
- Full library (`npx vitest run src/lib/__tests__ --pool=forks`): **1,744 passed, 72 skipped, 0 failed**
  (231 files passed, 1 skipped). A first run had 2 component files fail to load (`@/lib/rowCells` not
  mapped in their module mocks); fixed in those two tests, then the full rerun above.
- Browser: the new `logical-cells-and-exact-numbers`, `flipped-codebook-guard`, `one-reader-import` and
  `document-bin` checks **4 passed**; full browser suite (`npx playwright test -c
  e2e/ui/ui-check.config.mjs --workers=1`, no filters) **107 passed, 1 skipped, 0 failed**; smoke 1
  passed; `flipped-codebook-guard` alone, three repeats: **3 passed**. Screenshots inspected: TRUE, FALSE,
  0 and a blank cell in the Preview; the four large values as written.

Mocks: storage (in-memory stand-ins) and the model (never reached; the skipped browser check is the gated
real-provider one). The engine, database, actions and browser are real. Lint on the changed files: no error added; one unused-helper warning in the new test was removed (then that file rerun: 3 passed).

## Limits

- The exact-number rule keeps a variable as text when any one value cannot be held exactly; it does not
  offer exact decimal arithmetic for such values.
- The finding source viewer uses the same `cellText` rule; it is covered by the shared function's tests,
  not by its own browser journey.
- A link held by another file's bin entry to an erased finding is reported by the erase and, when that
  other file is restored, by its restore as lost.
