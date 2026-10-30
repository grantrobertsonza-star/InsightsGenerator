# Indicator Analytics (D6)

Grant, 29 October 2026: an Indicator Analytics tile under Analytics for indicator data files, one indicator at a
time, after the visual plan `docs/design/Unified_Indicators_Visual_Plan-2026-10-29.pdf` and the design handoff
`claude/indicators-dashboard-design-handoff-2026-10-29.md` (acceptance tests A to J). Builds on the Indicator data
type (`claude/indicator-data.md`). Reference values: `fixtures/indicator-data/Chart_Data_RH_ANCC_W_IRN_reference.json`.

Owners:
- Reads (the stored data, one snapshot): `src/lib/indicatorData.ts` `listIndicatorFiles`, `loadIndicatorSeriesRead`.
- Figures and wording (pure): `src/lib/indicatorAnalyticsFigures.ts`.
- Loader (composes the two; every figure the screen shows): `src/lib/indicatorAnalytics.ts` `loadIndicatorAnalytics`,
  `loadIndicatorWorkspace`.
- Boundary: `src/lib/indicatorAnalyticsActions.ts` (read-only; inputs checked, tenant from the session).
- Screen: `src/app/runs/[id]/IndicatorAnalyticsPanel.tsx` (`IndicatorAnalyticsLauncher`), shown on Analytics when the
  project has an Indicator data file. It computes no figure.
- Engine: `api/parse-stats-file.py` `_ind_sdmx` records `seriesAttributes` (below); reader
  `engine-indicators-2026.10.29`.

## Workspace

One workspace for the project's Indicator data files; the file is a filter (Source file), not a separate app. The
first file with observations is shown first. Tabs: Overview, Trends, Compare, Data & sources, all built. Left
selector (collapsible): selected indicator, visible Overview panels, files per provider, Reset to suggested. Not
built and said so on screen: add or remove series, advanced mapping, export.

Choices (file, series, area, period range, comparison period, trend areas, tab, panels, selector open) are kept for
the page load by `useKeptOpen` (a refresh that unmounts Analytics keeps the workspace open with them). They are not
saved to the project: a new page load starts from the suggestion (acceptance test G is partly met).

## Series identity and the never-pooled rule

- A series is the stored series (`indicator_series.series_key`): INDICATOR plus one code for every breakdown (FREQ,
  SEX, AGE, URBANISATION, COMP_BREAKDOWN_1..3 for DHS). The area is chosen separately; area plus series plus period
  is the observation key, unique in the database.
- The screen asks for a series by its key (`seriesKeyFor` from the codes chosen); the loader answers
  `series_not_found` for a key not in the read, never another series.
- The DHS reference windows (COMP_BREAKDOWN_1 = ANCC_IRN_02, 03, 05) are separate series. The tile shows one series at
  a time; nothing is averaged, summed or pooled across series. The filter is named "Reference window" when every
  value's label says "Timelapse" (presentation only).
- The rest of the publisher's full series key (STRUCTURE_ID, DATABASE_ID, UNIT_MEASURE, AGG_METHOD, UNIT_TYPE,
  UNIT_MULT): UNIT_MEASURE and UNIT_MULT are checked by the reader (one per series, else the file is refused). The
  other four are recorded per series (`provenance.seriesAttributes`); two codes of one of them in a series make the
  view `needs_review`, naming the field and its codes, and nothing is charted.

## Figures (method)

- Observed values only: a point is a stored observation of the series and area within the period range. A period with
  no observation has no point (never zero, never interpolated, never carried forward). A period the file does not
  state is left out of trends.
- Values as shown: `indicatorDisplay.shownNumber` (proportion x 100, x 10^unit multiplier). Decimals: the file's
  DECIMALS for the series when recorded, else the decimals the value is written with, less the places the multiplier
  or proportion adds; "%" for a percentage unit (`isPercentUnit`).
- Latest: the observation with the latest period in the range. Previous: the one immediately before it in the range.
- Change: latest minus previous on the shown scale from unrounded numbers, rounded once to the larger of the two
  values' decimals. For a percentage in percentage points ("+19.7 pp"), never a relative change. Stated with both
  periods: "2022 vs 2014, not year-on-year" ("consecutive years" only when the two are years one apart), with the
  arithmetic ("90.2% minus 70.5%").
- Observations in the trend: the count of points, with their periods; missing years remain missing.
- Comparison: the areas observed in exactly one period of the series, highest unrounded value first (ties by area
  code). Areas with values in the series but none in that period are counted, and no nearby period replaces them.
  Default period: the selected area's latest observed period.
- Trends: small multiples of the same series on one calendar span and one value axis (0 to 100 for a percentage on
  that scale). Suggested panels: the selected area, then the areas observed in its latest period, highest first, up
  to six; up to twelve chosen.
- Suggested area: the area with the most observations in the series, then the latest observation, then the code;
  the rule is shown.
- "What this view says": chosen by rule, never by a model: "For Kenya (KEN), the reported value rose from 70.5% in
  2014 to 90.2% in 2022." and "This is an 8-year gap between observations. No annual path or statistical
  significance is inferred." One observation: no change stated. None: says so. Never causal.
- Not shown, because the files hold none: sample sizes, weights, intervals, significance, country averages, totals,
  forecasts.

## Inputs and states

- Withheld (OECD CONF_STATUS C with no value, `provenance.withheld`): listed as withheld in the trend, the comparison
  and the summary ("2026-Q2 is withheld by the publisher as confidential and not counted."), never a value, never 0.
- A file read again since the view was loaded: the loader answers `stale`; the screen asks once more from the new read
  with the same choices and says why the view changed. Only the latest request's answer is shown; the previous
  answer stays on screen while a new one is calculated.
- A chosen area with no observation in the chosen series, a period range that ends before it starts, a comparison
  period no area has, more than twelve trend areas: `invalid` with the reason, and Reset to suggested.
- File states (Data & sources, `fileReadiness`): observations ready; metadata only (OECD reference information: rows,
  English notes, no values; no chart); not read yet; import error (no usable read). A failed reread over a good read
  keeps the earlier read and says so.
- Providers (`providerLines`), by the file's recognised layout: World Bank (Data360 long and wide, WDI), OECD, IMF,
  other. A provider with no file: "IMF: no file provided"; only notes: "OECD: metadata only". While a file is unread
  its provider is not known: absent providers then say "no file read".
- Definition and provenance lines: indicator, breakdowns, unit, unit multiplier, decimals, observation status,
  confidentiality (OBS_CONF), aggregation method, unit type, data structure, source, source metadata date (the
  file's last updated date where the layout has one, otherwise "not supplied in the file"), release vintage (not
  supplied), sample size and uncertainty (not supplied), and the date this app read the file. An attribute is "not
  recorded by this file's read" for a read before reader 2026.10.29 (read the file again), "not stated in the file"
  when the column is absent, "blank in the file for this series" when empty.

## Coverage (Data & sources)

Counted by the database over the read: observations, areas, distinct series by area (a publisher's series count:
607, 71 and 213 for the full DHS file), indicators, first and last period (text order), and the lowest and highest
value as written only when every series has one unit, multiplier and scale.

## Freshness

Read-only: the tile writes nothing and feeds no finding, insight, recommendation, narrative or export, so nothing
downstream goes stale. A reread changes what it shows on the next request (stale answer above).

## Tests

- `src/lib/__tests__/indicatorAnalyticsFigures.test.ts`: the pure rules.
- `src/lib/__tests__/indicatorAnalytics.db.test.ts`: the real upload and engine on a disposable database; the DHS
  slice and the full DHS download against the reference (Kenya trend, headline, change, 2022 comparison, the 210
  two-year-window observations, audit counts), windows never pooled, withheld never 0, stale, refused requests,
  needs review.
- `src/lib/__tests__/indicatorAnalyticsPanel.test.tsx`: the mounted workspace (late answers, stale reload, kept open).
- `e2e/ui/indicator-analytics.check.mjs`: browser check, written, not yet run.
- `scripts/indicator_selftest.py` "D6" checks: the engine's `seriesAttributes`.
