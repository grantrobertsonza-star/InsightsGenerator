# Unified indicators dashboard: design handoff (Grant, 29 October 2026)

Received from Grant as the D6 design source, with `docs/design/Unified_Indicators_Visual_Plan-2026-10-29.pdf` (four screens) and the reference values in `fixtures/indicator-data/Chart_Data_RH_ANCC_W_IRN_reference.json`. Kept as written below; the acceptance tests in section 8 are D6's acceptance criteria.

```text
UNIFIED INDICATORS DASHBOARD - DESIGN HANDOFF
Prepared 29 October 2026. Visual proposal only. No application changes made.
The user alone authorizes and communicates implementation changes to Claude.

1. PRODUCT DECISION
One Indicators dashboard in the existing Reporting area, not separate World Bank, OECD and IMF apps. Preserve the existing app's actual tokens, typography, colours and layout when implementing. The PDF follows the prior approved blue/light mockup aesthetic; it is not a claim to have inspected current production code. Native mockup font: DejaVu Sans; implementation should inherit the existing font.
Automatic generation is the default. Keep manual add/remove controls as refinement inside a collapsible LEFT selector. Dashboard tabs and controls belong inside the reporting canvas to the right, never another competing global sidebar.

2. FOUR SCREENS
01 Overview: selector expanded; country/indicator/time/window/source filters; latest observation, change since previous survey, observation count; calendar-spaced observed dot chart; concise descriptive insight; definition/provenance.
02 Compare: selector collapsed; same-year horizontal bars; definition lock; selected observation details. No implicit missing-year replacement.
03 Trends: country small multiples. This sample has one indicator, so no fabricated second measure. When genuine additional indicators arrive, extend to multi-indicator small multiples, each labelled with its own units, population and axes. Same-unit comparisons can share a scale; unlike measures must not share an unlabelled axis or a single pooled score.
04 Data & sources: readiness table, generation stages and file-level coverage. This is one internal tab, not three source dashboards.
The dark footer in each PDF screen is a reviewer annotation, NOT an app component.

3. COMPONENT HIERARCHY
ExistingReportingArea
  IndicatorsWorkspace
    CollapsibleSeriesSelector [expanded/collapsed; optional advanced mapping]
    ReportingCanvas
      WorkspaceHeading + generation/status badges + report export
      InternalTabs [Overview, Trends, Compare, Data & sources]
      FilterBar [area, indicator(s), period, dimensions/reference window, source]
      ViewContent
        KpiStrip / ObservedTrendCard / ComparisonBars / SmallMultiples
        DefinitionAndSource [expandable]
        ObservationDetails [drawer/tooltip]
        DataReadinessTable / MappingReview / CoverageSummary
Store user-selected series, chart visibility, layout and collapsed state. Re-import reconciles new data without silently resetting manual choices. Display removed or incompatible series as unresolved rather than replacing them.

4. ACTUAL INPUTS, NOT PLACEHOLDER ECONOMICS
DHS_SD_WIDEF.csv: 607 numeric observations, 71 reference areas, one indicator, 213 full series, years 1999-2025. 607 rows and 67 columns; 40 metadata fields + 27 year columns. Every row has one populated year cell. Attribute to The DHS Program, distributed through World Bank Data360.
DHS_SD_DATADICT.csv: schema dictionary (41 definitions), not observations.
DHS_SD.pdf: source description generated 10 October 2026; not an observation release vintage.
OECD FDI_INC_AGGR CSV: 79 metadata rows, 66 columns, no OBS_VALUE. Occasional TIME_PERIOD values are metadata qualifications, not observations. '~' is a metadata placeholder, not zero.
IMF: no IMF file was available among the four supplied files. Generic adapter planned; no claim of verified IMF parsing or observations.
Do not label this sample GDP, inflation or broad macroeconomic data.

5. EXACT DHS MAPPING CONTRACT
Unpivot headers matching four-digit years to TIME_PERIOD (the source reference year) and OBS_VALUE. Drop blank year cells as absent observations; never turn blank into zero. Preserve raw values and records. This file is not one row per complete time series.
Full series key:
STRUCTURE_ID, DATABASE_ID, FREQ, REF_AREA, INDICATOR, SEX, AGE,
URBANISATION, UNIT_MEASURE, COMP_BREAKDOWN_1, COMP_BREAKDOWN_2,
COMP_BREAKDOWN_3, AGG_METHOD, UNIT_TYPE, UNIT_MULT.
Observation key = full series key + TIME_PERIOD.
Retain COMMENT_OBS, DECIMALS, OBS_STATUS, OBS_CONF and *_LABEL fields alongside the observation. Retain original filename/record, provider, original producer, import timestamp, dataset/structure version and any available release vintage separately.

Mockup selection:
STRUCTURE_ID=WB.DATA360:DS_DATA360(1.3); DATABASE_ID=DHS_SD; FREQ=A;
INDICATOR=RH_ANCC_W_IRN; SEX=F; AGE=_T; URBANISATION=_Z;
UNIT_MEASURE=PT_W_SUB; COMP_BREAKDOWN_1=ANCC_IRN_02;
COMP_BREAKDOWN_2=_Z; COMP_BREAKDOWN_3=_Z; AGG_METHOD=_Z;
UNIT_TYPE=RATIO; UNIT_MULT=0; DECIMALS=1; OBS_STATUS=A; OBS_CONF=PU.
Area varies by panel. Indicator label: Percentage of women with a live birth (or stillbirth) preceding the survey who received iron during antenatal care.
Unit: Percentage of women in the same subgroup. Window: two years preceding survey.
ANCC_IRN_03 and ANCC_IRN_05 are alternative three-/five-year reference windows, NOT extra independent indicators. Never average or sum these windows.
FREQ=A means reference-year format, not annual survey availability. COMMENT_OBS preserves survey/fieldwork labels; e.g. reference year 2008 = DHS, 2008-09 for Kenya.
OBS_STATUS=A means Normal value; OBS_CONF=PU means Public. Neither means confidence interval or verified accuracy.

Canonical multi-provider model: provider, dataset/dataflow, measure, area, counterpart area, time, frequency, unit, multiplier, currency, price basis/base year, seasonal adjustment, accounting entry, measurement principle, entity type, sector/activity, reference window, population breakdowns, status, vintage/revision and original series key. Preserve source-specific dimensions; only applicable fields are required. A match in indicator name alone is insufficient for merging across providers.
OECD metadata selectors include REF_AREA, MEASURE, UNIT_MEASURE, MEASURE_PRINCIPLE, ACCOUNTING_ENTRY, TYPE_ENTITY, FDI_COMP, SECTOR, COUNTERPART_AREA, LEVEL_COUNTERPART, ACTIVITY, FREQ, FDI_COLLECTION_ID. Preserve resident SPEs vs operating units vs all resident units. Separate country and aggregate areas.

6. AUTOMATIC GENERATION AND FILTER RULES
On import: render the shell and parsing state immediately. Classify observations vs dictionary vs metadata. Resolve fields from schema/labels, validate keys and units, then populate eligible panels. Do not show fabricated numeric placeholders while waiting.
States: Reading; mapping resolved; needs review (identify the exact unresolved field); observations ready; definitions only; no matching observations; import error; source not loaded. Never manufacture a confidence percentage. Present deterministic evidence such as 'year columns detected' or 'unit mapped from source label'.
Default suggestion for this sample: one indicator and one explicit reference window; deterministic country selection explained in UI. Kenya is a curated mockup choice, not the only permissible auto-default. Select the latest observed value within the chosen time range; compare only with the previous available observation and show both years.
Country/time/theme controls can be shared, but each card must disclose its definition and coverage. Default comparison uses a common reference year. Optional latest-available mode must label every country's year and show a mixed-year warning. Do not silently switch modes.
Only populate multi-indicator relationship/quadrant views when two genuinely distinct measures with compatible dimensions and overlapping observations exist. No driver-analysis or causal quadrant can be derived from this one health indicator.
Use source filters to hide/show eligible series; changing source must not replace a selected metric with a vaguely related one without consent. Metadata-only source filters show readiness, not empty invented charts.

7. FORMAT AND TRUST RULES
Percent values are already on a 0-100 scale: Kenya90.2 is 90.2%, not 9,020%. Respect multiplier0 and one decimal. Changes in percentages are percentage points, not relative growth.
Use a calendar x-axis. Dot-only survey timelines avoid interpolation. Tooltip: source reference year, exact COMMENT_OBS survey label, value/unit, complete selected dimensions, status/confidentiality, original record and source.
Show missing as unavailable, never zero; no forward-fill. Keep metadata date, import/refresh timestamp, observation year and release vintage distinct. If vintage or sample size is absent, say not supplied.
No country-average percentage without justified denominator/weight data; no global total, synthetic index, forecast, causality, significance, confidence interval or inferred target from this sample. Same reference year and dimensions improve comparability but do not establish harmonized questionnaires or identical fieldwork periods.
Export includes active filters, units, survey dates, source details and caveats. Keyboard-operable controls, focus states, readable contrast and text status labels; don't rely on colour alone. Narrow layout stacks cards; selector becomes a left drawer, while internal tabs remain in reporting canvas.

8. ACCEPTANCE TESTS
A. Parse607 nonblank observations and213 semantic series; no duplicate full-key-plus-year observations. Do not mislabel15,782 blank year cells as data-quality failures.
B. Kenya, two-year window:2003=45.8;2008=71.0;2014=70.5;2022=90.2. Latest KPI90.2%; prior-survey change+19.7pp. No YoY label.
C. Reference year2022: Nepal96.1;Ghana92.3;Kenya90.2;Philippines86.2;Tanzania80.9;Bangladesh80.6;Mozambique77.9. Mozambique survey note remains DHS,2022-23.
D. Changing reference window never silently mixes02/03/05; mismatched units or windows disable pooling.
E. OECD metadata produces selectors/source details but zero FDI numeric cards. IMF shows 'No file provided'.
F. Missing year does not create a zero point, fake trend line, or substituted latest value. Explicit latest-available mode exposes every observation year.
G. Expand/collapse selector changes canvas width; no duplicate side menu. Manual choices survive refresh.
H. Four internal tabs remain one workspace; no provider-specific page silos. Filters and per-card context agree.
I. Every number traces to original source record or a disclosed calculation. New imports with revised observations preserve source vintage/history when supplied.
J. Export reproduces chart, filters, units, source and survey notes; check no clipping at supported breakpoints.

9. EVIDENCE AND LIMITATIONS
The attached source audit and chart_data.json support these mockups. Values were checked against uploaded CSV records, not independently verified against original DHS publications. No weights, sample sizes or uncertainty intervals were supplied. OECD observation data and an IMF sample are needed to validate and populate those adapters.
Source audit: source_audit.md. Chart-ready evidence: chart_data.json.
These files are a design handoff; no runtime/API/backend implementation, live dashboard, or app modification is included.
```
