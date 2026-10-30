# Batch 54 handover: Indicator data (28 October 2026)

Status: **implemented, ready for independent review.** Branch `indicator-data` (worktree `b67`), based on
`66ce928`. Not pushed. Migration 0126 written, not applied to any database. Browser check written and
parsed, **not run** (the lead runs the browser gates).

## Extension the same day (Grant's answers and files)

1. **Values limit** (answer 2): indicator data counts values, not rows. `maxIndicatorValues` = 500,000 in
   `api/import-limits.json`, shared with `importLimits.ts`; set from measurement (table in
   `claude/indicator-data.md`; `scripts/measure_indicator_limits.py`, `indicatorLimitMeasure.db.test.ts`).
   The 100 MB byte limit is kept; raw data keeps its 100,000-case limit. The long FinData export (249,113
   rows, 94 MB) is now read, with observations identical to the wide download.
2. **Status markers** (answer 3): values whose status is not normal are open shapes of their own on the
   chart, with a symbol legend and a line under the chart naming each status in the file's words.
3. **IMF data portal wide** (`imf_wide`): SERIES_CODE identity, codes from its parts, FREQUENCY a
   breakdown (never mixed), UNIT the unit, SCALE the multiplier, dataset description kept once and shown
   under the source line. The 90.6 MB IL file (2,745,880 values) is refused by the values limit.
4. **OECD SDMX-CSV** (`oecd_sdmx`): code and label columns paired by position; codes-only variant read with
   labels unknown; UNIT_MEASURE and CURRENCY are breakdowns, so a chart never mixes currencies; values
   withheld as confidential are listed and shown as withheld, never zero.
6. **OECD reference notes** (Grant approved attaching them): the "Unfiltered reference information"
   file is accepted as Indicator data and read as notes (layout `oecd_notes`): English text only, keyed by
   the dimension codes it names ("~" any), stored with its dataflow in `indicator_notes` (migration 0126).
   Notes that match a charted series of the same dataflow are shown under the chart and in a CSV notes
   section; they never change values. A notes file of another dataflow is accepted and says it matches no
   data yet. Same persistence rules (one transaction, ownership under the lock, reread replaces, bin,
   restore and erase). Pinned by `indicator_selftest.py` (129 notes counted independently; the NLD 2009
   break-in-series note; a "~" note for all areas; escaped quotes; another dataflow),
   `indicatorDisplay.test.ts` (matching, CSV section) and `indicatorData.db.test.ts`.
5. Answer 1 (OECD/IMF SDMX) was then met by items 3 and 4 with Grant's files.

Measurements (engine in a fresh process; save path on the disposable database):
- 500,000 values wide: engine 3.6 s, 322 MB; save 17.5 s, +144 MB. 1,000,000: 7.7 s and 36.6 s (too close
  to 60 s with a remote database). Save writes about 30,000 values a second and binds first.
- Long FinData built from the wide download (94 MB, 249,113 rows): engine 13.2 s, 1,158 MB peak; save
  8.9 s.
- IMF IL (90.6 MB): refused at the limit after 7 s at 958 MB; without the limit it reads in 25 s at
  1,394 MB with a 138 MB answer. IMF WPAIAX (4.9 MB, 13,908 values): 0.4 s, 124 MB.
- OECD filtered download (1,052 rows): 918 values, 134 blank of which 34 withheld as confidential.

## What was asked

Grant: World Bank and similar published statistics were suggested as Raw data and would be analysed as if
each row were a person. "How would I then plot each country on an indicator over time from the table?"
Decision: an Indicator data type. Contract: `claude/indicator-data.md`.

## What was built

1. **Upload type** "Indicator data" (`indicatorFiles`, `documents.kind = 'indicator'`) for .csv, .tsv,
   .txt, .xlsx, .xls, with the hint asked for. Suggested from a CSV, TSV or text file's first lines
   (`sampleLooksLikeIndicatorData`), only while the type is still the panel's own suggestion; before the
   name rules for tables. The data dictionary fixture is not suggested.
2. **Reader**: engine action `indicators` (`indicator_observations`), one stated rule per layout:
   Data360 / SDMX long, Data360 wide, WDI wide, label and value (Findex). Tidy observations with area,
   indicator and breakdown codes and labels, period, value as written, unit code and label, unit
   multiplier, status and note, layout and provenance. Everything else refused by name (list in the
   contract). Signed like the other actions, answered through the converted copy, known to the local
   worker (protocol 5) and the one-shot runner.
3. **Persistence**: migration 0126 (kind check gains `indicator`; `indicator_reads`,
   `indicator_series`, `indicator_observations`, row-level security). One-transaction publish under the
   document row lock, stage then publish, failure recorded beside the previous version.
4. **View**: an "Indicator data" tab on the file: indicator, varying breakdowns, up to 12 areas; Plot line
   chart (gaps for years with no value, dots on every value), unit and source under it, a table, and a CSV
   of what is shown.

Out of scope, not built (next steps): checking report claims against indicator data, comparing indicator
data with survey results, significance tests, maps.

## Impact checklist

1. **Rule.** New rules, registry rows added (`claude/rules-registry.md`, Reading files): layout and
   refusals (engine owner; mirror `sampleLooksLikeIndicatorData`, pinned equal on every fixture by
   `indicatorData.test.ts`), series identity and units, the answer check (`STRICT_NUMBER` mirrors
   `_STRICT_NUMBER`, pinned by reading the engine source), publishing, display. Existing owners reused:
   `_sheet_grids` / `_decode_plain_text` / `_sniff_delimiter` (file reading; `_sheet_grids` gained an
   optional `meta` argument to report the encoding, no behaviour change), `_STRICT_NUMBER`,
   `_NA_STRING_TOKENS` (plus ".." for published statistics), `_check_import_limits`,
   `storeUploadedDocument` (dedupe, cleanup), `markDocumentProcessingStatus`, `csvField`.
2. **Inputs.** Blank, missing tokens and ".." are absent observations (no row; counted), never zero. A
   value that is not a plain number, an unknown column, a missing code, a duplicate observation, two
   units or multipliers in a series: refused with the line or series named. Area or year not stated by a
   label and value file: null, shown "not stated in the file", never invented. WDI has no unit column:
   "Unit: not stated in the file". A failed retrieval (engine, storage, write) is recorded as a failure
   and shown, distinct from "not read yet". Before 0126: refused naming the migration; the view says not
   available yet.
3. **Persistence.** Transaction: one per publish (`publishIndicatorRead`). Ownership on the write: the
   document row is locked `for update` with id, run, tenant and kind. Lock: the same row lock serialises
   concurrent reads of one file. Retry: replaces the version; unique constraints make duplicate rows
   impossible. Partial failure: rollback, previous version kept, failure recorded
   (`recordIndicatorReadFailure`, same lock). Status: ready after a published read; failed only when no
   usable version exists.
4. **Freshness.** Indicator data feeds no finding, insight, recommendation, narrative or export in this
   batch: nothing downstream changes meaning, no human wording is affected. Processing the project leaves
   indicator files alone. A reread replaces what the view shows; the view detects it (read id) and
   reloads.
5. **Screens.** Late answers dropped by request order (`createRequestOrder`) and by file; a newer read
   answers stale and the list is reloaded; the choice is not saved (reload starts with no area chosen);
   "Read the file again" reports its own outcome only after the server answers.
6. **Proof.** See below. Shown failing without the change: removing the "delete the previous read" step
   in `publishIndicatorRead` fails 2 of 8 `indicatorData.db.test.ts` cases (retry/concurrency and failed
   reread), then restored.

## Files

Engine and scripts: `api/parse-stats-file.py`, `scripts/indicator_selftest.py` (new),
`scripts/crosstab_selftest.py` (runs it), `scripts/parse_stats_worker.py`, `scripts/parse_stats_local.py`.
Migration: `supabase/migrations/0126_indicator_observations.sql`.
Library: `src/lib/indicatorData.ts`, `indicatorDataActions.ts`, `indicatorDisplay.ts`,
`indicatorChartOptions.ts` (new); `uploadPurposes.ts`, `documentUpload.ts`, `documentUploadActions.ts`,
`parseStatsFile.ts`, `importSources.ts`, `csvField.ts` (`csvNumberField`).
Screens: `src/app/runs/[id]/IndicatorDataPanel.tsx` (new), `AddFilesPanel.tsx` (sniffs .tsv too),
`page.tsx` (kind, purpose line, tab, project totals, processing skips indicator files),
`src/app/knowledge/content/import.tsx` and `src/lib/helpIndex.generated.json` (rebuilt).
Tests: `indicatorData.db.test.ts`, `indicatorDataBeforeMigration.db.test.ts`, `indicatorData.test.ts`,
`indicatorDisplay.test.ts` (new), `uploadPurposes.test.ts` (order list), `e2e/ui/indicator-data.check.mjs`
(new). Fixtures: `fixtures/indicator-data/` (slices of Grant's files, 72 KB, plus a hand-written WDI
layout file with invented values; README).
Docs: `claude/indicator-data.md` (new), `claude/rules-registry.md`, `claude/upload-type-suggestions.md`,
`claude/csv-export.md`, `claude/document-deletion-contract.md`.

Callers and consumers checked: upload action and panel, project page (source list, purpose, tabs,
totals, processing), stage facts (`processingState`: ready/failed/not read from the document status),
bin (remove, restore, erase), worker and runner dispatch, request signing (`_SIGNED_ACTIONS`).

## Commands and counts

All in `/home/claude/b67`, `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres`.

| Command | Result |
|---|---|
| `npx next typegen` then `npx tsc --noEmit` | 0 errors |
| `npx eslint .` | 0 errors, 45 warnings (none in the changed files) |
| `python3 scripts/crosstab_selftest.py` | 419 PASS, 0 FAIL (includes the indicator self-test; 368 before the extension) |
| `python3 scripts/indicator_selftest.py` | 118 PASS, 0 FAIL, 0 NOT RUN (after the extension and the OECD notes) |
| `npx vitest run src/lib/__tests__/indicatorData.db.test.ts --pool=forks` | 11 passed (9 before the extension) |
| `... indicatorDataBeforeMigration.db.test.ts` | 3 passed |
| `... indicatorData.test.ts` | 18 passed |
| `... indicatorDisplay.test.ts` | 12 passed |
| `... indicatorChartOptions.test.ts` | 3 passed |
| `... uploadPurposes.test.ts` | 5 passed |
| `... importSources.test.ts` | 19 passed |
| `... documentBin.db.test.ts` | 10 passed |
| `... technicalDocumentUpload.db.test.ts` | 3 passed |
| `... uploadIdempotency.db.test.ts` | 3 passed, 1 skipped (the NOT RUN placeholder for no database) |
| `... dataIntegrityDI.db.test.ts` | 14 passed |
| `... tenantIsolation.db.test.ts` / `appRole.db.test.ts` / `migrationHistoryCheck.db.test.ts` | 5 / 10 / 2 passed (each 1 placeholder skipped) |
| `... historyCsvFormula.db.test.ts` / `parseRequestSignature.test.ts` / `previewAuthority.test.ts` | 2 / 5 / 7 passed |
| `... statsWorkerFreshness.test.ts` / `statsWorkerReload.test.ts` / `technicalDocuments.test.ts` / `changeTier.test.ts` / `helpIndex.test.ts` | 6 / 1 / 9 / 7 / 4 passed |
| `node --check e2e/ui/indicator-data.check.mjs` | parses |

Extension files: `api/parse-stats-file.py`, `api/import-limits.json`, `src/lib/importLimits.ts`,
`src/lib/indicatorDisplay.ts`, `src/lib/indicatorChartOptions.ts`, `src/lib/indicatorData.ts`,
`src/lib/uploadPurposes.ts`, `IndicatorDataPanel.tsx`, migration 0126 (layout check), knowledge page and
help index, `scripts/measure_indicator_limits.py`, tests `indicatorChartOptions.test.ts` and
`indicatorLimitMeasure.db.test.ts` (measurement, runs only with INDICATOR_MEASURE_DIR), fixtures
`IMF_STA_IL_slice.csv`, `IMF_STA_WPAIAX_slice.csv`, `OECD_FDI_INC_AGGR_filtered_slice.csv`,
`OECD_FDI_INC_AGGR_reference.csv` (the whole 79-row reference file; the others are rows copied from Grant's files).

Not run: the full library suite (2 shared cores; only new and affected files, one at a time), the browser
suites and smoke (the lead runs them), so no screenshot yet (the check saves `indicator-data.png`).

## Measurements

- Engine, full `WB_FINDATA_WIDEF.csv` (14,261,299 bytes, 20,719 rows, 249,113 values, 83 series, 229
  areas, child process): 4.6 to 6.5 s, peak 235 MB; answer 12.5 MB JSON (converted copy).
- End to end on the disposable database (upload, engine via the local worker, check, store): 14.0 s, Node
  peak 429 MB; catalogue answer 130 KB.
- Within the import limits: 14.3 MB of 100 MB; 20,719 of 100,000 rows.

## Mocks versus real

Real: PostgreSQL (disposable, every migration, or up to 0125 for the before-migration file), the Python
engine (local worker), the upload action, publishing, reads, bin. Mocked: storage (in-memory), the
signed-in request context, `revalidatePath`, the model client (never called). Expected values come from
Grant's files read with the csv module or hand-picked cells (ZAF 2016 ANCC_IRN_03 = 89.8; COG 2011 = 84.4;
USA FD_FDI_OVRL overall FM 2006 = 71.9801025390625; Account (%, age 15+) = 0.811259662052011), never from
the app's output. Long and wide DHS give identical observations (fixtures, full files and stored rows).

## Migration and compatibility

Apply `0126_indicator_observations.sql` (backup first). Before it, the app is unchanged except that adding a
file as Indicator data is refused naming the migration and the view says it is not available. After it no
restart is needed (availability is asked again until true). The local worker restarts itself (protocol 5).

## Limits

- OECD and IMF SDMX exports refused (no INDICATOR, or label columns named in words); one sheet per
  workbook; Excel not suggested from content.
- The values limit (500,000) refuses the IMF IL download; a long file's memory is bound by the 100 MB
  byte limit (1.2 GB engine peak at 94 MB).
- Proportions judged per file; a file whose percentages are all below 1% would be read as proportions.
- Unknown code-named attribute columns become breakdowns (visible as a choice).
- Upload reads synchronously (14 s for FinData locally); the deployed reader's time limit is 60 s.
- Commit `b1de2cf` alone does not typecheck (`indicatorData.test.ts` imports the suggestion rule added in
  `2c606cc`); review the three commits together.

## Questions for Grant

1. The IMF IL download (2.7 million values) is refused at 500,000 values. Raising the limit needs a faster
   write (PostgreSQL COPY, a new dependency): worth doing now?
