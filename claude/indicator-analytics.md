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
- Direction, shown equality and the change text are three separate things (Codex D6-F01, 30 October 2026):
  - direction (`Change.direction`: rose, fell, same) comes from the unrounded values only;
  - whether the two observations are shown as one value comes from the two shown values, each at its own
    precision ("1.0%" and "1.10%" are compared as 1.0 and 1.1);
  - the change text is the unrounded change rounded once. A real rise or fall that rounds to zero keeps its sign
    and says it is smaller than one shown step ("+<0.1 pp", "-<1" for a whole-number unit); "0.0 pp" only for
    exactly equal values. When the rounded change differs from the difference of the shown values, the arithmetic
    adds ", calculated from the unrounded values" (1.06 and 1.04 are shown 1.1% and 1.0%, change +<0.1 pp).
  Equality is never inferred from a rounded change with no sign.
- Observations in the trend: the count of points, with their periods; missing years remain missing.
- Comparison: the areas observed in exactly one period of the series, highest unrounded value first (ties by area
  code). Areas with values in the series but none in that period are counted, and no nearby period replaces them.
  Default period: the selected area's latest observed period.
- Trends: small multiples of the same series on one time axis and one value axis (0 to 100 for a percentage on
  that scale). Suggested panels: the selected area, then the areas observed in its latest period, highest first, up
  to six; up to twelve chosen.
- Time axis (Codex D6-F02, 30 October 2026): one owner, `periodPlacement` / `periodPosition` / `timeAxisOf` /
  `axisFraction` in `indicatorAnalyticsFigures.ts`, for every form of the shared period rule
  (`indicatorPeriodValid`, `claude/indicator-data.md`): a period is placed at the day number (days since
  1 January 1970, UTC) of its first day: a year at 1 January, a half, quarter or month at its first day, a date
  at itself, an ISO week at its Monday (week 1 is the week with 4 January, so 2021-W01 starts on 4 January 2021 and
  2026-W01 on 29 December 2025). The loader's `axis` spans the series' periods of every area within the range,
  and every chart (Overview trend and each Trends panel) places a point only by its share of that span
  (`axisFraction`; one period alone sits in the middle). A point is never placed by its index in one chart, so a
  date shared by two areas has one horizontal position however many other dates each area has.
- The time axis is withheld (`axis.state = "withheld"` with the reason; the chart is replaced by the reason and the
  observed values listed in period order) when a period cannot be placed safely: an ISO week 53 in a year with 52
  ISO weeks (the shared period rule accepts weeks 01 to 53 in every year, and placing 2021-W53 would move it to
  2022-W01), a period the period rule refuses (stored before it existed), or periods of more than one frequency in
  one view (a series is one frequency; a year at 1 January beside daily values would read as a daily value).
- Suggested area: the area with the most observations in the series, then the latest observation, then the code;
  the rule is shown.
- "What this view says": chosen by rule, never by a model: "For Kenya (KEN), the reported value rose from 70.5% in
  2014 to 90.2% in 2022." and "This is an 8-year gap between observations. No annual path or statistical
  significance is inferred." One observation: no change stated. None: says so. Never causal. The statement agrees
  with both shown observations (D6-F01):
  - exactly equal: "was the same in 2020 and 2021 (70.5%)", naming both shown values when they are written to
    different precisions ("was the same in 2020 (70.5%) and 2021 (70.50%)");
  - shown as one value but unrounded different: "is shown as 70.5% in both 2020 and 2021; unrounded, it fell
    (change -<0.1 pp)";
  - shown values in the unrounded direction: "rose from 1.0% in 2020 to 1.1% in 2021";
  - shown values against the unrounded direction (only possible with two precisions, for example a value written
    with an exponent shown by the display rule): "is shown as 1% in 2020 and 1.03% in 2021, at different
    precisions; unrounded, it fell (change -0.01 pp)".
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

- `src/lib/__tests__/indicatorAnalyticsFigures.test.ts`: the pure rules, including D6-F01 (rounding-boundary rises
  and falls, equal shown values, exact equality, two precisions, a unit multiplier and a proportion scale, DHS
  +19.7 pp) and D6-F02 (dates, ISO weeks across a year boundary, the one axis, withheld axes).
- `src/lib/__tests__/indicatorAnalyticsCalendar.test.tsx`: the mounted workspace on the Trends tab (D6-F02): the
  review's Ghana and Kenya 2 January 2024 case has one cx; ISO weeks across a year boundary with unequal coverage
  and a single-point country; 2021-W53 withheld with the reason.
- `src/lib/__tests__/indicatorAnalytics.db.test.ts`: the real upload and engine on a disposable database; the DHS
  slice and the full DHS download against the reference (Kenya trend, headline, change, 2022 comparison, the 210
  two-year-window observations, audit counts), windows never pooled, withheld never 0, stale, refused requests,
  needs review.
- `src/lib/__tests__/indicatorAnalyticsPanel.test.tsx`: the mounted workspace (late answers, stale reload, kept open).
- `e2e/ui/indicator-analytics.check.mjs`: browser check, written, not yet run.
- `scripts/indicator_selftest.py` "D6" checks: the engine's `seriesAttributes`.
