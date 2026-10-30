# Indicator data (batch 54)

Grant, 28 October 2026: World Bank and similar published statistics (one row per country, indicator,
breakdown and year) were suggested as Raw data and would have been analysed as if each row were a
person. "How would I then plot each country on an indicator over time from the table?" Decision: an
Indicator data type, read as series over time, never as cases.

Extended the same day (Grant's answers and files): the limit counts values, not rows (set from
measurement, below); values with a status other than normal are marked on the chart; two more layouts,
the IMF data portal wide download and OECD Data Explorer SDMX-CSV; OECD reference information is read as
notes for the series of the same dataflow (Grant approved attaching them, 28 October 2026).

Owners: engine `api/parse-stats-file.py` `indicator_observations` (action `indicators`, reader
`INDICATOR_READER`); `src/lib/indicatorData.ts` (checks, persistence, reads); `src/lib/indicatorDisplay.ts`
(display rules); `src/lib/uploadPurposes.ts` `sampleLooksLikeIndicatorData` (suggestion, a mirror);
view `src/app/runs/[id]/IndicatorDataPanel.tsx`. Migration `0126_indicator_observations.sql`.

## Upload

- Type "Indicator data" (`indicatorFiles`, stored as `documents.kind = 'indicator'`) for .csv, .tsv, .txt,
  .xlsx and .xls. Hint: published statistics by country or region and year (World Bank, IMF, OECD,
  Stats SA).
- Suggested from a CSV, TSV or text file's first lines when they have an indicator header (the reader's
  rules below, applied to the first lines: the first non-blank line for Data360, IMF, OECD and label and
  value, the first ten for WDI). OECD reference information (STRUCTURE, REF_AREA, TIME_PERIOD, no OBS_VALUE) is suggested
  too, as notes. Checked before the name rules for tables; never overrides a choice the researcher
  made (`AddFilesPanel`). Excel files are not sniffed: chosen by hand. A data dictionary that lists
  REF_AREA and INDICATOR as values is not suggested (a data row is never taken for a header).
- The file is read straight after it is stored. A failed read leaves the upload standing, with the
  failure recorded and shown on the file's Indicator data tab, and "Read the file again" retries.
- Before migration 0126 the upload is refused naming it ("Indicator data needs the database update
  0126_indicator_observations.sql. Nothing was stored"), the stored object is removed, and the view says
  the feature is not available yet. Everything else is unchanged.
- Processing the project ("Process") leaves indicator files and their status alone: they are not mined
  for findings.

## Reading (engine, `indicator_observations`)

The file is read as a grid of literal text by `_sheet_grids` (UTF-8, UTF-16 with a mark, or
Windows-1252, recorded; strict quoting; Excel cells as the workbook holds them, so an Excel number 71.0 is
the number 71). The separator of a CSV or text file is the one under which its first lines hold a
recognised header (`_ind_delimiter`, first 256 KB); when none or several do, the document rule
(`_sniff_delimiter`, ragged) applies. The ragged rule alone chose ";" for the IMF file, whose descriptions
hold semicolons and line breaks. Then one rule per layout, first match:

| Layout | Rule |
|---|---|
| Data360 / SDMX long (`sdmx_long`) | first non-blank row has FREQ, REF_AREA, INDICATOR, UNIT_MEASURE, TIME_PERIOD, OBS_VALUE |
| Data360 wide (`data360_wide`) | the same without TIME_PERIOD and OBS_VALUE, with one or more four-digit year columns |
| WDI wide (`wdi_wide`) | a row within the first ten non-blank rows starting Country Name, Country Code, Indicator Name, Indicator Code; every later column a year (an empty heading with no values is a trailing comma) |
| OECD SDMX-CSV (`oecd_sdmx`) | first non-blank row has REF_AREA, MEASURE, TIME_PERIOD and OBS_VALUE and no INDICATOR |
| IMF data portal wide (`imf_wide`) | first non-blank row has DATASET, SERIES_CODE and OBS_MEASURE; INDICATOR and FREQUENCY required; period columns 2023, 2023-Q1, 2023-M01 |
| Label and value (`label_value`) | first non-blank row ends with "Indicator name", "Value", after any number of named grouping columns |

Refused by name, never guessed: no rule matches (the message names the file's first columns and the six
layouts); REF_AREA and INDICATOR without the other required columns (named); both TIME_PERIOD/OBS_VALUE and
year columns; an SDMX file with neither INDICATOR nor MEASURE; OECD reference information naming no dataflow or
several, or with no English note; a column that is neither a known Data360 column,
a label partner, a year, nor a code-style name (capitals, digits, underscores), such as an OECD
"Reference area" label column; a missing REF_AREA or INDICATOR code on a row; a value that is not a plain
decimal number (`_STRICT_NUMBER`: "1,234" could be a thousands separator or a decimal comma); a period
that is not a year or a year with a quarter, half, week, month or date, or whose month, week or date does not
exist (month 00 or 13, week 00 or 54, 2023-02-29: `_ind_period_in_calendar`, mirrored by
`indicatorPeriodValid` in `src/lib/indicatorLayouts.ts`, which the server also applies to every stored period
and the chart uses before it fills a time axis, so a period is never moved to another date; batch 68,
Codex NEW10K-F01); two values for one series, area and
period (long rows, or two wide rows filling the same year); a label and value table naming one indicator
twice; a series with two units or two unit multipliers (named with its codes and both units); a
recognised file with no values; several sheets of indicator data in one workbook (choosing is not
supported yet); a file over 100 MB or with more than 500,000 values (below).

Data360 columns:
- Required: FREQ, REF_AREA, INDICATOR, UNIT_MEASURE (+ TIME_PERIOD, OBS_VALUE when long).
- A column X with a partner X_LABEL gets its label from it. An X_LABEL with no X is ignored and listed
  (`provenance.ignoredColumns`).
- Attributes, never breakdowns: STRUCTURE, STRUCTURE_ID, STRUCTURE_NAME, ACTION, DATABASE_ID, AGG_METHOD,
  UNIT_TYPE, DECIMALS, TIME_FORMAT, COMMENT_OBS, COMMENT_TS, UNIT_MULT, OBS_STATUS, OBS_CONF, DATA_SOURCE,
  SOURCE, OBS_NOTE. OBS_STATUS is kept per observation (code; the code's label in
  `provenance.statuses`), COMMENT_OBS as the observation's note, DATABASE_ID with its label as the
  source, UNIT_MULT as the series' unit multiplier.
- Every other code-named column is a breakdown dimension, generically (DHS: SEX, AGE, URBANISATION,
  COMP_BREAKDOWN_1..3; FinData: EV_CRITERIA, SEGMENT). FREQ is the first breakdown, so a series is one
  frequency.
- A series is INDICATOR plus every breakdown code (the identity); labels are presentation. One unit code
  per series; a second label for the same code is kept first and listed (`provenance.labelConflicts`).
- In the wide layout one series and area may span several rows (FinData repeats a row with status O,
  "Missing value", and blank cells): allowed while no year has two values.

Values: a blank cell, a declared missing token (`_NA_STRING_TOKENS`) or ".." is an absent observation:
no row, counted in `provenance.absentCells`, never zero. A value is stored as written ("5.12E-4" stays
that text) with the same number beside it.

WDI: no unit column (the unit is part of the indicator name), so unit and multiplier are null: "Unit: not
stated in the file". "Data Source" and "Last Updated Date" lines above the header become the source and
`provenance.lastUpdated`.

Label and value (Findex country summaries):
- No indicator code: the label as written is the identity.
- Area and year from the file name by one rule: split on `_`, `-`, spaces and dots; exactly one token of
  three capital letters is the area code, exactly one four-digit token from 1900 to 2100 the year. Not
  exactly one: unknown (null, stated as "not stated in the file"), never invented. `provenance.areaFrom`
  and `periodFrom` say "file name" or null.
- A label ending "(% ...)" has unit "%"; the rest of the brackets is the base population
  (`baseDescription`: "(% internet users, age 15+)" gives "internet users, age 15+").
- Scale: when every value of a "%" indicator in the file lies from 0 to 1, the file stores proportions
  (`valueScale = 'proportion'`); otherwise `'percent'`. Stored as written either way; the display
  multiplies proportions by 100 (0.811259662052011 is shown as 81.1%) and says so. A file whose
  percentages are all genuinely below 1% would be read as proportions: a stated limit.
- Grouping columns (Topic, Sub Topic 1, Sub Topic 2) are kept per series as `groups`, not breakdowns.

Answer: `{reader, layout, provenance, series[], areas[], observations[[series, area, period, value,
status, note]]}`, written to the converted copy like the table action (FinData: 12.5 MB) and checked
again by `validateIndicatorResult` before anything is stored.

OECD Data Explorer SDMX-CSV ("Filtered data" and "Unfiltered data" downloads, one layout):
- Codes and labels are paired by position, not by name: a code-named column (capitals) followed by a
  column headed in words is the code and its label (REF_AREA, "Reference area"). With no such columns (the
  codes-only download) labels are unknown and codes are shown (`provenance.labelsKnown` false).
- MEASURE is the indicator. Every other code-named column that is not a known attribute is a breakdown:
  UNIT_MEASURE is one (an OECD measure comes in US dollars and in reported currency) and is also the
  series' unit, so units are never mixed. CURRENCY is read as a breakdown too: in "Reported currency" the
  currency differs between areas, so each series is one currency, and a chart compares only areas in the
  same currency, with the currency named among the breakdowns. Attributes: STRUCTURE, STRUCTURE_ID,
  STRUCTURE_NAME, ACTION, DECIMALS, UNIT_MULT (the multiplier), OBS_STATUS (status), CONF_STATUS, BASE_PER,
  OBS_CONF. Source: STRUCTURE_NAME (STRUCTURE_ID).
- A blank OBS_VALUE is absent. When CONF_STATUS is C it is withheld as confidential: listed in
  `provenance.withheld` ([series key, area, period]), shown as "Withheld (confidential)" in the table, said
  under the chart, written to the CSV with no value, never zero. An area whose every cell in a series is
  withheld is still offered for that series (catalogue `areaCodes`, with `withheldOnlyAreaCodes`), and the
  area heading counts it apart: "1 with values, 1 with every value withheld as confidential" (batch 68,
  Codex NEW10K-F02). An area of another series is never offered.
- Status: an Indicator data file is "Read" when its read is published (the stored status "ready"), whatever
  its text preview (it has none); a first read the reader refused is "Read failed"; a failed reread keeps
  the previous version and its "Read" (`processingState` in `src/lib/importSources.ts`; batch 68, Codex
  NEW10K-F03).
- The reference information download is read as notes (layout `oecd_notes`; below).

OECD reference information (notes):
- Rule: the first non-blank row has STRUCTURE, REF_AREA and TIME_PERIOD and no OBS_VALUE. The key columns
  are the code-named columns up to and including TIME_PERIOD (not STRUCTURE, STRUCTURE_ID, STRUCTURE_NAME,
  ACTION); "~" means any value, so a note's key holds only the dimensions it names. The code-named columns
  after TIME_PERIOD are the note fields (DATA_SOURCE, STAT_CONC_DEF, COVERAGE, ...), each with its label
  column ("Data source").
- A field holds its text once per language, en:"...",fr:"..." with \" and \' escaped by a backslash. Only
  the English text is read; other languages are ignored. A field not in that form is kept as written and
  counted (`notesLanguageNotStated`); one with no English text is counted (`notesWithoutEnglish`).
- One dataflow per file (STRUCTURE_ID), stored with every note (`indicator_notes.dataflow`). A data file
  records its dataflow (`provenance.dataflow`, OECD data only). A note is shown only with a data file of
  the same dataflow in the same project.
- Matching (`indicatorDisplay.notesFor`): MEASURE must be the series' indicator code; REF_AREA, when
  named, must be one of the charted areas; every other dimension named must be a breakdown of the series
  with the same code (a dimension the series lacks never matches). A named TIME_PERIOD does not filter:
  it is said with the note ("Data source (Netherlands (NLD), 2009): ...").
- Shown under the chart, headed with the notes file's name and "they never change the values", and in
  the CSV as a notes section after the values (a blank line, then notes_file, field, field_label,
  area_code, period, note). Notes never change values.
- A notes file's own tab says how many English notes it holds for which dataflow and which data files of
  that dataflow it annotates, or that it matches no data in the project yet.
- Full file: 79 rows, 129 English notes.

IMF data portal wide download:
- SERIES_CODE is the identity. Its dot-separated parts are the codes of the first dimension columns after
  OBS_MEASURE, in order (GBR.RXF11ORA_REVS.USD.M is COUNTRY, INDICATOR, UNIT, FREQUENCY); each part must
  stand for one label of its column throughout the file and each label for one code, and every code must
  have the same number of parts, or the file is refused. The columns hold labels; the codes come from
  SERIES_CODE.
- COUNTRY is the area (code from SERIES_CODE, label from the column), INDICATOR the indicator, the other
  coded columns breakdowns. FREQUENCY is one of them, so annual, quarterly and monthly values are never one
  series or one line; each row's values must lie in period columns of its frequency (a value in a column
  of another frequency is refused, never moved). UNIT is the unit (US dollar, SDR, Fine troy ounces).
  SCALE in words is the unit multiplier (Units 0, Thousands 3, Millions 6, Billions 9, Trillions 12;
  anything else refused), applied for display only. The series keeps its code as a group,
  SERIES_CODE "{COUNTRY}.RXF11ORA_REVS.USD.M".
- Dimension columns after the coded ones that are always blank are ignored and listed; one with values
  is a breakdown known by its label only.
- The dataset's own columns (PUBLISHER, SOURCE, LICENSE, SUGGESTED_CITATION, UPDATE_DATE and the rest of
  `_IMF_DATASET_COLUMNS`) are kept once when constant (`provenance.dataset`) and shown under the chart's
  source line; one that varies is kept per series as a group.
- Blank cells are absent, never zero; a written 0 is a value.

## The values limit (measured)

Grant, 28 October 2026: indicator data counts values (observations), not file rows, so a long download
(one row per value) is read like a wide one. `api/import-limits.json` `maxIndicatorValues` = 500,000,
shared with `importLimits.ts` (`INDICATOR_VALUES_LIMIT_MESSAGE`, `INDICATOR_LIMITS_CAPTION` in the upload
hint). The 100 MB byte limit stays. Raw data keeps its 100,000-case limit. The engine refuses as soon as
the count passes the limit: "This file holds more than the supported 500,000 values for indicator data.
Download fewer indicators, areas or years per file, then retry; nothing was read."

Measured on this machine (`scripts/measure_indicator_limits.py`: synthetic Data360 files with FinData's
columns, each read in a fresh process; save path by `indicatorLimitMeasure.db.test.ts` on a disposable
PostgreSQL, run with INDICATOR_MEASURE_DIR):

| File | Bytes | Values | Engine time | Engine peak | Save: parse and check | Save: write | Node peak (rise) |
|---|---|---|---|---|---|---|---|
| synthetic long | 40 MB | 100,000 | 5.0 s | 487 MB | 0.3 s | 2.9 s | +0 MB |
| synthetic long | 80 MB | 200,000 | 9.6 s | 905 MB | 0.4 s | 6.1 s | +72 MB |
| synthetic long | 101 MB | 250,000 | refused by the byte limit | | | | |
| FinData long (built from the wide download) | 94 MB | 249,113 | 13.2 s | 1,158 MB | 0.7 s | 8.2 s | +21 MB |
| synthetic wide | 6.8 MB | 250,000 | 1.9 s | 201 MB | 0.5 s | 8.1 s | +72 MB |
| synthetic wide | 13.6 MB | 500,000 | 3.6 s | 322 MB | 1.2 s | 16.3 s | +144 MB |
| synthetic wide | 27 MB | 1,000,000 | 7.7 s | 576 MB | 3.1 s | 33.5 s | +195 MB |
| synthetic wide | 55 MB | 2,000,000 | 21.5 s | 1,038 MB | 6.3 s | 63.8 s | +512 MB |
| synthetic wide | 96 MB | 3,500,000 | 30.2 s | 1,815 MB | 13.1 s | 142.2 s | +577 MB |
| IMF IL (Grant's file) | 90.6 MB | 2,745,880 | refused at the limit after 7 s, 958 MB peak; read without the limit: 25 s, 1,394 MB, 138 MB answer | | | | |

Choice: the save path writes about 30,000 values a second, so it binds first. At 500,000 values the
engine takes under 4 s for a wide file and the write about 17 s (about 22 s with upload and download,
a margin of more than 2.5 times on 60 s, for a slower deployed database); 1,000,000 would take about 45 s,
too close. Memory is bound by the byte limit rather than the values: a 94 MB long file peaks at 1.2 GB in
the engine (59% of 2,048 MB), a wide file at 500,000 values at 0.3 GB. The IMF IL download (2.7 million
values) is refused with the message above; a faster write (COPY) would let the limit rise.

## Persistence (migration 0126)

- `indicator_reads` (one per document): the published `read_id`, reader, layout, provenance, areas,
  counts, `published_at`; the last failed attempt (`failure`, `failed_at`) beside it.
- `indicator_series` (per read): identity key, codes and labels, breakdowns, unit code and label, unit
  multiplier, value scale, base description, groups.
- `indicator_notes` (per read, notes files only): dataflow, key (dimension codes named), key labels,
  period, field and its label, English text, line; unique per read, line and field.
- `indicator_observations`: series, area code, period (null when unstated; `unique nulls not distinct
  (series_id, area_code, period)`), value as written and as numeric, status, note.
- Row-level security on tenant_id like the other tenant tables. No run_id: project membership is the
  document's, so the bin (which moves `documents.run_id`) hides and restores them without moving rows,
  and erasing the document deletes them through the foreign keys (`ON DELETE CASCADE`). The bin's
  "every table with document_id and run_id" check is therefore unaffected.

Writes (`publishIndicatorRead`, data and notes alike): one transaction; the document row is locked `for update` and must be
this tenant's, this project's and kind `indicator` (ownership on the write; refused otherwise with
nothing written); the new read's series and observations are inserted under a new read id (staged),
`indicator_reads` is pointed at it (published) and only then are the previous read's series,
observations and notes deleted. A
failure anywhere rolls back, so the previous version stays. A retry or a concurrent second read is
serialised by the row lock and replaces the version; rows are never duplicated (unique constraints).
`recordIndicatorReadFailure` records a failed attempt under the same lock. Processing status: ready
after a published read; failed only when no usable version exists (a failed reread over a good version
keeps ready, and the tab says the last attempt failed).

## Reads and the view

- `loadIndicatorCatalogue` and `loadIndicatorObservations` read in one repeatable-read snapshot and
  check the document is this project's Indicator data. Observations are asked for with the read id the
  view was shown; a newer read answers "stale" and the view reloads the list rather than mixing versions.
  At most 12 areas per request.
- The view: indicator (by code; label where there is none), each breakdown that varies (by code, label
  shown), areas with values for that series (filterable, up to 12). A line per area over every year from
  the first to the last (`periodAxis`): a year with no value is a gap, never zero; lines join consecutive
  years only, and dots mark every value (DHS surveys are years apart). The unit (with base, proportion
  scale and multiplier in words) and the source (DATABASE_ID label and code, and the file name) are under
  the chart, with the dataset's publisher, update date, citation and licence when the file gives them
  (`datasetLines`). Values whose status is not normal (SDMX A; for example E estimated, P provisional, B
  break in series) are drawn as open shapes of their own, one shape per status (`statusMarkers`: triangle,
  diamond, square, star, cross, wye, in code order), with a symbol legend and a line under the chart naming
  each status in the file's words ("Estimated value (E)"); a value with no status is not marked. Quarters
  and months run through every period like years. A table (periods with a value by area; "No value" where
  the file has none; "Withheld (confidential)" where it withholds one; a marked status in brackets) and a CSV of what is shown (value as written and as shown, unit, multiplier,
  scale, base, status, note, source; text through `csvField`, numbers through `csvNumberField`).
- Late answers never replace a newer choice (`createRequestOrder`) or show against another file. The
  choice is not saved: a reload starts again with no area chosen (one-area files choose their area).
- Display only: `shownNumber` = value x 100 for proportions x 10^unitMult; the stored value never
  changes.

## Indicator Analytics (D6)

The single-indicator dashboard on Analytics reads these files through `listIndicatorFiles` and
`loadIndicatorSeriesRead` (indicatorData.ts, one snapshot, a series by its stored key). Its figures, states and
wording are in `claude/indicator-analytics.md`. For it the engine (reader `engine-indicators-2026.10.29`) also keeps,
per series of an SDMX or Data360 file, the codes and labels its rows carry in STRUCTURE_ID, DATABASE_ID, AGG_METHOD,
UNIT_TYPE, DECIMALS, TIME_FORMAT and OBS_CONF (`provenance.seriesAttributes`, with the columns present in
`provenance.seriesAttributeColumns`); several codes are recorded as found, never resolved by the reader. A file read
before then has none: the dashboard says so and asks for the file to be read again.

## Freshness

Indicator data feeds no finding, insight, recommendation, narrative or export in this batch, so nothing
downstream changes meaning. A reread replaces the version shown; when indicator data is used downstream
(next steps), its derived results must record the read id they used.

## Limits and next steps

- Out of scope (not built): checking report claims against indicator data; comparing indicator data
  with survey results; significance tests; maps.
- Other SDMX dialects (no INDICATOR or MEASURE) are refused. Notes are matched within one project, by
  dataflow, and only OECD data records its dataflow.
- The values limit (500,000) refuses large downloads such as the IMF IL file (2.7 million values); split by
  indicator, area or years.
- One sheet per workbook; Excel files are not suggested from content.
- Proportions are judged per file (all "%" values from 0 to 1).
- Unknown attribute columns with code-style names are read as breakdowns (visible as a breakdown choice).
- Measured: the full 13.6 MB FinData wide file (20,719 rows, 249,113 values, 83 series, 229 areas) reads in
  4.6 to 6.5 s at 235 MB peak in the engine; upload, read and store end to end 14 s on the disposable
  database.
