# Batch D6 handover: Indicator Analytics, the single-indicator tile (29 October 2026)

Status: **implemented, ready for independent review.** Tier A (engine provenance, a server page, reads, figures)
and B (the workspace screen). No migration. Nothing writes: the tile is read-only.

Source: Grant, 29 October 2026: `claude/plan-auto-dashboards-2026-10-28.md` "D6: Indicator Analytics tile", the
design handoff `claude/indicators-dashboard-design-handoff-2026-10-29.md`, the visual plan
`docs/design/Unified_Indicators_Visual_Plan-2026-10-29.pdf` and the reference
`fixtures/indicator-data/Chart_Data_RH_ANCC_W_IRN_reference.json`. Contract: `claude/indicator-analytics.md`.

## What was built

- An "Indicator Analytics" card under "Indicator dashboards" at the top of Analytics, shown when the project has an
  Indicator data file. It opens a full-screen workspace (the tracker dashboards' pattern), kept open across a refresh
  by `useKeptOpen`, with "Auto-generated" and "Observed data only".
- Four tabs, all built: Overview (headline: latest observed with its period and survey label, change since the
  previous observation in pp with "2022 vs 2014, not year-on-year" and the arithmetic, observation count; calendar
  dot chart of observed values only; "What this view says" by rule; definition and provenance), Trends (small
  multiples of one series on one calendar and value axis), Compare (one reference period, highest first, comparison
  rules, selected observation; withheld and not-observed areas said, no nearby period used), Data & sources
  (readiness per file and per provider, generation steps, coverage, definition).
- Filters: source file, country or area, indicator, each breakdown that varies (the DHS reference window is named
  "Reference window"), period range, comparison period, trend countries (up to 12).
- Left selector (collapsible): selected indicator, visible Overview panels, files per provider ("OECD: metadata
  only", "IMF: no file provided"), Reset to suggested. Shown as not available yet: add or remove series, advanced
  mapping, export.
- Engine: per-series record attributes kept in the read's provenance (`seriesAttributes`: STRUCTURE_ID, DATABASE_ID,
  AGG_METHOD, UNIT_TYPE, DECIMALS, TIME_FORMAT, OBS_CONF with labels), reader `engine-indicators-2026.10.29`, for
  decimals, confidentiality and the series-key review.
- Fixture: `fixtures/indicator-data/DHS_SD_WIDEF_full.csv`, Grant's whole wide download (28 October, unchanged,
  418 KB). The committed `DHS_SD_WIDEF.csv` is a 23-row slice (AFG, COG, KEN, ZAF), so the reference's 2022
  comparison (seven countries) and its audit counts (607, 71, 213) can only be checked against the whole file.

## Impact checklist

1. **Rule.** New rule, registry row added ("Indicator Analytics (D6)"), contract `claude/indicator-analytics.md`,
   section in `claude/indicator-data.md`. Owners used, never a second version: reads through `indicatorData.ts`
   (two new owner functions beside `loadIndicatorCatalogue`, same snapshot and ownership rules), values through
   `indicatorDisplay.shownNumber`, `isPercentUnit` (now exported, behaviour unchanged), `breakdownChoices`,
   `withheldCells`, `sourceText`, `unitText`, `areaName`. Series identity is the stored series key.
2. **Inputs.** Missing year: no point, never 0 or interpolated. Withheld: listed, never a value. A period the file
   does not state: left out of trends. A series key not in the read: `series_not_found`, nothing substituted. An area
   not in the series, a reversed range, an unknown comparison period, too many trend areas: `invalid` with the
   reason. A series-key attribute with two codes: `needs_review` naming the field. A read before reader
   2026.10.29: attributes "not recorded by this file's read", never defaulted. Metadata absent: "not supplied in the
   file". OECD notes file: `definitions_only`, no chart. Unread or failed files: their own states.
3. **Persistence.** None written. Reads are one repeatable-read snapshot per request, scoped by tenant, project and
   kind `indicator` (another organisation's request is refused, tested). A reread since the view was loaded answers
   `stale`.
4. **Freshness.** The tile feeds no finding, insight, recommendation, narrative or export; nothing goes stale. A
   reread changes its next answer (stale, then reloaded with the same choices and a note saying why).
5. **Screens.** Only the latest request's answer is shown (`createRequestOrder`); the previous answer stays visible
   while a new one is calculated; a stale answer is asked again once from the new read; closing clears the kept
   state; remount keeps it. No save, so no "Saved".
6. **Proof.** Below.

## Acceptance tests A to J (design handoff section 8)

| Test | Covered | How |
|---|---|---|
| A. 607 observations, 213 series, no duplicate keys; 15,782 blank cells not failures | Yes | `indicatorAnalytics.db.test.ts` (full file): coverage 607/71/213/1, duplicate-key query 0, `absentCells` 15,782 |
| B. Kenya 2003 45.8, 2008 71.0, 2014 70.5, 2022 90.2; 90.2%, +19.7 pp, no YoY | Yes | db test (slice and full file), mounted test, browser check (written) |
| C. 2022: Nepal 96.1 ... Mozambique 77.9; Mozambique DHS, 2022-23 | Yes | db test (full file, order, values and survey labels) |
| D. Windows 02/03/05 never mixed | Yes | db test: each window's trend and panels equal that window's CSV cells; 210 + 03 + 05 = 607; the two-year view holds exactly the reference's 210 |
| E. OECD metadata gives no numeric cards; IMF "No file provided" | Yes | db test (`definitions_only`, provider lines), unit tests |
| F. Missing year no zero, no fake line, no substituted latest | Yes | db test (no 2010 point, 2014 comparison has only areas observed in 2014, range to 2015 gives 2014 latest); dots only, no line. The optional "latest-available" comparison mode is not built (common period only) |
| G. Selector collapse widens the canvas; manual choices survive refresh | Partly | Collapse built (browser check written, not run). Choices survive a refresh that remounts Analytics (mounted test), not a new page load (not saved to the project) |
| H. Four tabs, one workspace, no provider silos | Yes | One workspace, file as a filter; mounted test opens Compare and Data & sources |
| I. Every number traces to a source record or disclosed calculation | Partly | Values as written, survey label, status, source and series codes shown; change arithmetic shown. The original CSV line number of each observation is not stored, so "open underlying row" is not offered. Vintage history: not supplied in these files |
| J. Export reproduces chart, filters, units, source, notes | No | Export not built; shown as not available yet |

## Reference comparison (Grant's JSON, never the app's own output)

Tolerances: values compared as written (exact text) and as numbers within 1e-9; the change compared after rounding
to one decimal (DECIMALS 1) within 1e-9 of 90.2 - 70.5.

- Kenya two-year window: 2003 45.8, 2008 71.0, 2014 70.5, 2022 90.2 with labels DHS, 2003 / 2008-09 / 2014 / 2022:
  equal (slice and full file). Latest 90.2%, change +19.7 pp, "2022 vs 2014, not year-on-year": equal.
- 2022 comparison: NPL 96.1, GHA 92.3, KEN 90.2, PHL 86.2, TZA 80.9, BGD 80.6, MOZ 77.9 (DHS, 2022-23): equal, same
  order.
- All 210 two-year-window observations: each equal by area and year; 210 found, none extra.
- Audit: 607 observations, 71 areas, 213 area series, 1 indicator, range 10.2 to 97.8, 0 duplicate keys, 15,782
  absent cells: equal.
- Slice: every two-year value of the slice equals the reference's value for that area and year.

## Files

- Engine: `api/parse-stats-file.py` (`_IND_SERIES_ATTRIBUTES`, `_ind_sdmx`, `INDICATOR_READER`);
  `scripts/indicator_selftest.py` (four D6 checks).
- Library: `src/lib/indicatorData.ts` (`listIndicatorFiles`, `loadIndicatorSeriesRead`, types), `src/lib/indicatorDisplay.ts`
  (`isPercentUnit` exported), new `src/lib/indicatorAnalyticsFigures.ts`, `src/lib/indicatorAnalytics.ts`,
  `src/lib/indicatorAnalyticsActions.ts`.
- Screen: new `src/app/runs/[id]/IndicatorAnalyticsPanel.tsx`; `src/app/runs/[id]/page.tsx` (the launcher in
  Analytics).
- Tests: new `src/lib/__tests__/indicatorAnalyticsFigures.test.ts`, `indicatorAnalytics.db.test.ts`,
  `indicatorAnalyticsPanel.test.tsx`; `indicatorData.test.ts` (the new fixture added to its fixture list); new
  `e2e/ui/indicator-analytics.check.mjs` (written, not run).
- Fixture: `fixtures/indicator-data/DHS_SD_WIDEF_full.csv`, README row.
- Docs: `claude/indicator-analytics.md` (new), `claude/indicator-data.md`, `claude/rules-registry.md`, this file.

Callers and consumers checked: `loadIndicatorCatalogue` and `loadIndicatorObservations` unchanged (the Indicator data
tab); `isPercentUnit` is the same rule `shownText` used; the new provenance keys are ignored by every existing reader
of provenance (`sourceText`, `datasetLines`, `withheldCells`, `notesFor`); `validateIndicatorResult` does not check
provenance contents, so older and newer reads both store.

## Commands and counts (worktree /home/claude/b103)

- `npx next typegen` once; `npx tsc --noEmit`: 0 errors.
- `npx eslint src e2e --quiet`: 0 errors.
- `python3 scripts/crosstab_selftest.py`: "All checks passed", exit 0.
- `python3 scripts/indicator_selftest.py`: "All indicator checks passed" (with the D6 checks; full DHS, FinData and
  IMF IL measurements ran from Grant's files).
- `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false npx vitest run src/lib/__tests__/indicatorAnalyticsFigures.test.ts src/lib/__tests__/indicatorAnalytics.db.test.ts src/lib/__tests__/indicatorAnalyticsPanel.test.tsx src/lib/__tests__/indicatorData.test.ts src/lib/__tests__/indicatorData.db.test.ts src/lib/__tests__/indicatorDataBeforeMigration.db.test.ts src/lib/__tests__/indicatorDisplay.test.ts src/lib/__tests__/indicatorChartOptions.test.ts src/lib/__tests__/indicatorLimitMeasure.db.test.ts src/lib/__tests__/keptOpenWorkspace.test.tsx src/lib/__tests__/importSources.test.ts --pool=forks`:
  11 files, 94 passed, 1 skipped (`indicatorLimitMeasure.db.test.ts` runs only with INDICATOR_MEASURE_DIR, as
  before), 0 failed (final run; see the note below).
- Not run: the full vitest library, the browser suites and playwright (not asked for this batch; no playwright).

Note on the run: one combined run reported `indicatorData.test.ts` failing its fixture-list test because the new
full fixture was not in the expected list (it is indicator data, read and suggested like the slice). The list was
updated; the run before that had reported the same file passing, which I cannot explain from the output kept.

Shown failing without the change: removing the latest-request guard in the panel makes the mounted test fail
("Latest observed: Kenya" replaced by the late Ghana answer); restored, it passes. The other tests are of new
behaviour with no earlier implementation.

## Mocks versus real

- Real: PostgreSQL (disposable, every migration), the upload action, the Python engine, publish, the loader.
  Mocked: storage (in memory), the model (never called), request context (tenant).
- Mounted test: react-dom in linkedom; the server actions are the mocked boundary, answering with the real loader
  over a stand-in stored read (the database reads are mocked there); answers held to order them.

## Limits and not done

- Not built: export (J), add or remove series, advanced mapping, multi-indicator views (designed separately), the
  optional latest-available comparison mode, saving choices to the project (G partly), opening the underlying CSV
  row (the line number is not stored), screenshots (no browser run in this batch).
- The browser check `e2e/ui/indicator-analytics.check.mjs` is written, not run.
- Provider is inferred from the recognised layout (Data360 and WDI as World Bank); an SDMX long file from another
  publisher using INDICATOR would be labelled World Bank. Stated on screen as "Provider (from the layout)".
- The definition is the indicator's label: the DHS source description (DHS_SD.pdf, metadata date 10 October 2026) is
  not an indicator data file, so the metadata date shows "not supplied in the file".
- A file read before reader 2026.10.29 shows attributes as not recorded until read again; a reread is the recovery.
- Period range filtering is by text order within one series (one frequency per series), as the existing chart does.
