# Multi-indicator dashboard: design handoff (Grant, 29 October 2026)

Grant: "That's the target design for multiple indicators." With `docs/design/Multi_Indicator_Dashboard_Visual_Plan-2026-10-29.pdf` (two screens) and `fixtures/indicator-data/multi_indicator_demo_ILLUSTRATIVE.json` (fictional values, Country A/B/C; layout checks only, never merged with real data; every page and export built from it is labelled "Illustrative data"). Kept as written below; its acceptance checks 1 to 10 are D6's, with `claude/indicators-dashboard-design-handoff-2026-10-29.md` (single indicator, tests A to J).

```text
MULTI-INDICATOR DASHBOARD - VISUAL HANDOFF
29 October 2026 | Design proposal only | No app changes made

THE CHANGE
Display multiple DISTINCT indicators simultaneously in the existing reporting canvas. Do not solve this with one-indicator tabs or separate World Bank/OECD/IMF pages. Page 1 contains SIX KPI cards and SIX trend cards visible together. Page 2 contains a six-indicator country matrix and three distinct indicator peer charts together. Internal Overview/Trends/Compare/Data & sources navigation stays inside reporting canvas. Keep the optional left variable selector collapsible.

DEMONSTRATION DATA, NOT REAL STATISTICS
All numbers and Country A/B/C are fictional. Source is 'Demo dataset'; demo snapshot is 29 October 2026. No displayed value is claimed to come from World Bank, OECD, IMF or a real country. Label every rendered page and exported image 'Illustrative data'. Use multi_indicator_demo.json as the single deterministic evidence source for this design. Do NOT merge this demo with the genuine DHS observations in the previous handoff. The prior upload still contains only one real indicator; the OECD sample is metadata-only and an IMF sample was not available.

LAYOUT
Keep the existing production typography and tokens. Visual mockup uses prior navy/light-blue palette and DejaVu Sans as a stand-in for app font.
- Existing Reporting > Indicators workspace.
- Expanded left selector: six indicator checkboxes; focus country plus two peers; add/remove; advanced mapping. Collapsed state shown on page 2.
- Header: title, six-visible badge, illustrative badge, snapshot and export.
- Shared controls: focus/peer countries, multi-select indicators, period/comparison year, source filter.
- Page 1: six-column KPI strip; 3 by 2 trend grid. Responsive tablet: 2 columns; narrow screen: 1 column. Do not shrink labels to fit six columns on small screens.
- Page 2: unit-aware matrix; independent peer-bar charts for GDP per capita, FDI income and antenatal iron coverage.
- Dark bottom strip is reviewer context, not a production app component.

SIX DISTINCT METRICS
GDP per capita: current USD per person (fictional demonstration).
Consumer price inflation: annual average CPI change, % per year.
Unemployment: % of labour force; retain actual definition and population.
FDI income: income receipts / GDP in this DEMO, % of GDP; NOT FDI inflows. Real data must resolve accounting entry, measurement principle, SPE/entity scope, counterpart and units before rendering.
Antenatal iron coverage: % of subgroup, women with a birth in preceding two years in this demo. Real DHS definition and reference window must remain exact.
Internet use: individuals using the internet, % of population.
GDP per capita uses dollars per person; the other metrics use percent with different denominators. Never add them, average them, create a pooled score, rank metric magnitudes, or use one undifferentiated axis.

DATA AND CALCULATION CONTRACT
JSON has years 2020-2024, focus-country histories, peer values for 2024, exact metric definitions, axis ranges and independently calculated last_change.
2024 Country A values and changes vs 2023:
GDP per capita $5,200, +$270 per person; inflation3.9%, -1.2pp; unemployment7.6%, -0.5pp;
FDI income2.2%, +0.3pp; iron coverage89.0%, +4.5pp; internet76.0%, +6.0pp.
Change = current value - previous value. For percentage metrics display percentage points, NOT percent growth; for GDP per capita display the absolute USD-per-person change. JSON includes change_unit. Do not label falling inflation/unemployment 'good' mechanically; neutral change styling is intentional. These are synthetic annual sequences only; they do not imply that actual DHS surveys are annual.
The line in each demo trend joins its invented year values. For real survey data, default to observed dots without filling gaps; retain source survey labels as well as reference years. No forecasts or uncertainty intervals are created here.

CARD CONTRACT FOR REAL IMPLEMENTATION
Every metric card retains its own provider, dataset/series, exact measure, dimensions, value, unit/denominator, multiplier, reference year, source survey/release note, observed/estimated/forecast status, and vintage if supplied. Show short source/year on-card; complete provenance in a keyboard-accessible detail affordance. Never confuse import time or a metadata-report date with release vintage. If vintage absent, show 'Not supplied', not a fabricated timestamp.
Resolve series independently. Show confirmed/pending mapping labels and unresolved fields, not an invented confidence score. Source badges for planned adapters must say 'Planned source mapping' until actual observations have been ingested and validated. This mockup uses generic Demo dataset badges instead.
The same selected time range can leave some metrics without a recent observation. Display each card's actual year; add a mixed-year notice if latest-available cards differ. Default peer comparison is common year. Never silently replace missing values with nearby-year data. Reject incompatible comparisons (definition, frequency, units, denominator, population, currency/base-year, accounting scope) rather than forcing them into a shared chart.
No normalization/index toggle in this mockup. If introduced later, require explicit base year and formula, label as index, preserve raw values and never imply it is a validated combined performance score.

AUTO-FIRST WITH OPTIONAL EDITING
On import, generate the multi-indicator layout from compatible available series without asking users to construct each chart. Suggest six visible indicators, explain selection, and allow add/remove/reorder. Persist choices across refresh. The visible metric count is dynamic, not hard-coded at six. Source is provenance/filter, not a separate app. A metadata-only source creates a readiness state, not invented metric cards.

ACCEPTANCE CHECKS
1. Page 1 renders all six distinct metric KPIs and all six histories simultaneously; no one-metric-only tabs.
2. All numbers agree with JSON; last_change equals final year minus preceding year and uses its correct change_unit (USD per person or pp).
3. Each trend has its own labelled unit and independent range; GDP per capita0-6,000 USD, CPI0-10, unemployment0-12, FDI0-3, health/internet0-100 in this demo. Actual data needs a safe axis policy including negative values when present; never clip to these demo ranges automatically.
4. Peer matrix uses2024 for every row/column; Country A values match page1. Compare countries within each metric, never rank across metric types. GDP per capita peer chart uses a0-7,000 USD scale to include the larger peer value.
5. FDI panel says income, not inflows, and preserves accounting-entry meaning.
6. Demo source and illustrative warning survive export. No official provider logo or source label implies authenticity.
7. Real missing observations remain missing; each card exposes observation year and status. Mixed-year latest mode warns explicitly.
8. Collapse expands reporting width; manual indicator selections remain in one workspace and persist after refresh.
9. Export includes definitions, units, dates and provenance. Check keyboard navigation, colour contrast, long labels and narrow responsive layouts.
10. No causal insights, pooled scores, invented confidence intervals, forecasts or cross-unit aggregate ranking.

DELIVERABLES
Multi_Indicator_Dashboard_Visual_Plan.pdf: two screens.
Multi_Indicator_Dashboard_Hero.png: first screen.
multi_indicator_demo.json: all fictional values, peer matrix and metric metadata.
Only the user should communicate implementation instructions to Claude. This package has not modified the app or been sent to Claude.

```
