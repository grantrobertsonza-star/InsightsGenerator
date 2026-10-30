# Batch 68 handover: indicator data repairs NEW10K-F01 to F03 (29 October 2026)

Status: **implemented, ready for independent review.** Tier A (engine, persistence boundary, availability
rule) and B (status label, selector). No migration.

Source: Codex, independent new-area stress review (10,000 cases; `docs/independent-new-areas10000-review-2026-10-28.md`).

## NEW10K-F01 (S2): impossible months accepted, then lost from the chart

- Engine `_ind_period` keeps the SDMX shape check and adds `_ind_period_in_calendar`: months 01 to 12, ISO
  weeks 01 to 53, dates that exist. A file with 2024-M13 or 2024-M00 is refused naming the period.
- Server boundary: `validateIndicatorResult` checks every stored period with `indicatorPeriodValid`
  (`src/lib/indicatorLayouts.ts`), the mirror of the engine rule, kept equal by a test that runs both on the
  same 25 periods.
- Chart: `periodAxis` fills an axis only when every period is a real one; a month 13 stored before this fix
  stays on the axis as written, with its value, instead of being counted as January of the next year.
- Recovery: a reread of a file now holding month 13 is refused naming it, and the previous version stays in
  use with its values (`indicatorData.db.test.ts`, step 3 of the failed-reread test).
- Tests: `indicatorData.test.ts` (rule mirror; engine refuses M13/M00 and reads M01/M12; server refuses),
  `indicatorDisplay.test.ts` (axis and chart point at its own period). Five fail on the code before the fix.

## NEW10K-F02 (S2): a country with only confidential values disappeared from the selector

- `loadIndicatorCatalogue` offers, for each series, the areas with values and the areas whose every cell in
  that series is withheld as confidential (`selectableAreas`; new field `withheldOnlyAreaCodes`). Another
  series' areas are never offered.
- The area heading says "1 with values, 1 with every value withheld as confidential for this series";
  choosing such a country shows "Withheld (confidential)" in the table, never 0 or "No value".
- Tests: `indicatorData.db.test.ts` (ZAF value, KEN only confidential, a second measure with GBR alone; reread
  keeps the same choices; fails on the old rule), browser `indicator-status-withheld`.

## NEW10K-F03 (S3): a published indicator file showed "Read failed"

- `processingState` (`src/lib/importSources.ts`): Indicator data is "Read" when its read is published
  (status "ready"), whatever its text preview, which it never has; a refused first read stays "Read failed".
  The report rule (no text is a failed read) is unchanged.
- Tests: `importSources.test.ts` (fails on the old rule), browser `indicator-status-withheld` (row, header and
  the Read failed filter, after upload and after a reload).

## Why the earlier tests missed these

The engine tests used real periods only; the catalogue tests had no country without a single value; the
status rule had no indicator case. Each family now has its boundary and recovery cases.

## Checks

Gates on the final tree (`83665a3` in the cloud; batches 66, 67, 68, 53 and D1 on top of `16253c5b`): tsc and eslint clean; engine self-test passed; library 304 files, 2,315 tests passed, 91 skipped, 0 failed (real disposable PostgreSQL, run on `0bcbfc0`, which differs only in the control check); full browser suite 140 passed, 1 skipped (the real-model check), 0 failed; smoke 1 passed. New browser check `indicator-status-withheld` passed in the final gates.

Contract `claude/indicator-data.md` and registry rows updated.
