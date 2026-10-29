# Plan: automatic CSM and brand-tracking dashboards (Grant, 28 October 2026)

Status: proposed, not started. Owner request with two design previews (CSM "Customer experience dashboard",
Brand tracker "Brand overview"). The numbers in the previews are illustrative.

## What Grant asked for

- Both dashboards generated automatically from imported data, in one reporting workspace (no separate
  auto-dashboard area).
- The brand tracker's section menu on the left stays. The variable selector becomes collapsible, collapsed
  by default once the dashboard is ready, so the charts get most of the screen.
- Tabs across the reporting area: CSM Overview, Channels, NPS, Drivers; Brand Overview, Funnel, Moments,
  Attributes and so on.
- "Customise dashboard" opens the selector to add or remove measures, hide charts, change the main brand,
  segments and mappings. "Build dashboard" becomes "Apply changes".
- Choices are saved and kept when a new wave arrives; "Reset to suggested" returns to the automatic version.
- The existing NPS and driver modules feed the dashboard with the same filters and bases.
- Roles are recognised from question types, brand codes, response options and bases, never from variable
  names alone. "None of the listed brands", buying channels and media must not become competitors or
  attributes (seen in the preview, where variables were picked at random).

## What exists today (code at 16253c5b)

- `CsmAnalyticsPanel.tsx` with `csmActions.ts`, `csmMetrics.ts`; `BrandHealthAnalyticsPanel.tsx` with
  `brandHealthActions.ts`, `brandHealthMetrics.ts`; NPS (`npsActions.ts`, `NpsVisual.tsx`); drivers
  (`driverActions.ts`, `driverAnalysis.ts` and related); wave tracking; section dashboards.
- Mappings are chosen by hand and stored per data file (`csm_modules`, `brand_health_modules`, one row per
  document). The save has no revision check (last write wins), and a mapping does not carry to the next
  wave's file.
- No automatic recognition of tracker type or variable roles.

## Proposed batches

**D1. Role recognition (tier A).** One owner, `trackerRoles.ts`, that reads the variables, value labels,
codebook and questionnaire links and proposes roles with a reason and confidence:
- brand frame: the shared code list behind the funnel questions; options such as "None of these",
  "Other", "Don't know" are never brands (by code and label rule) and are listed for checking;
- funnel stages (awareness, consideration, usage, preference) from question structure and wording;
- brand-by-attribute grids and per-brand multiple-response sets as attributes or moments, only when their
  options are the brand frame; channel and media lists are recognised as their own kinds;
- CSM: overall satisfaction and service attribute batteries on a shared scale, likelihood to recommend
  (0 to 10, NPS), likelihood to stay or switch;
- tracker type (CSM, brand, both, neither) from what is found.
Unknown stays unknown: an ambiguous role is asked about, never guessed. Depends on the grid and
multiple-response family recognition planned in batch 53, so 53 comes first or the shared part moves here.

**D2. Configuration and generation (tier A).** A dashboard configuration per programme: suggested (from
D1) and the researcher's changes kept apart, saved with a revision check, carried to a new wave by
variable identity (a mapped variable missing from the new wave is shown as needing a choice, never
dropped silently), "Reset to suggested" that keeps a record of what was reset. Generated when the data
file is ready; NPS and driver results come from their modules with the same filters, bases and weights,
and a module that has not run or failed is shown as such.

**D3. Reporting workspace (tier B).** The layout from the previews: brand section menu kept; collapsible
variable selector (collapsed once ready); tabs; Customise dashboard and Apply changes; "saved" only after
the save succeeds; switching data files and late responses handled. Browser checks and screenshots at
desktop and narrow widths.

Each batch goes through the full gates and Codex review before the next builds on it.

## Added 28 October: AI Insight button (Grant)

Grant: "we need an AI Insight button ... think if we can have it per section or an overall
interpretation; check where it makes most sense." Proposed as batch D4, after D3, placement to be settled
with screenshots:

- **Per section** (a tab or chart group: Funnel, Attributes, NPS, Drivers): "Interpret this section"
  writes two to four short statements from the figures on screen only, each citing the figure, base and
  wave it rests on. Likely the most useful place: the reader is looking at those charts.
- **Overall**: a dashboard summary built from the section interpretations (not from the raw data
  again), so the overall view never says something a section does not support.
- **Grounding and honesty**: the model receives the computed figures with their bases, weights, waves
  and significance results, never the raw file; no causal wording from driver results ("association
  does not establish cause"); small bases (n<50 flagged, n<30 no inference) and unsupported changes
  between waves are stated, not interpreted; only finished model results are shown (the finished-result
  rule).
- **Freshness and human work**: an interpretation records the dashboard configuration, data files and
  figures it was written from; when any of them changes it is marked out of date with the reason, never
  silently rewritten; a researcher's edits are kept on regenerate; an interpretation can be posted to
  Findings like other dashboard results.
- **Open for Grant**: where the button sits (each section header, the tab bar, or both) once D3's
  layout exists; whether the overall summary goes into the Insights report.

## Added 28 October: full brand-tracking coverage (Grant: "remember timelaps.io; cover all of the areas")

Reference: timelaps.io lists Brand Funnel, Moments (category entry points), Associations, Advertising
Recall, Category Insights, Buyer Demographics, Filters and an AI Analyst. The BMW test pack was built to
supply every chart family Grant's screenshots show: overview and performance, conversion, timeline,
unfamiliar and rejectors, category moments, brand strength, moment-brand matrix and fingerprint,
associations and positioning, advertising, word of mouth, category behaviour, demographics and media.
The brand dashboard's section menu follows that list (the preview's menu: Brand overview, Moments and
needs, Brand associations, Advertising and WOM, Audience and media, Category overview).

| Area | Measures | Today (Brand Health module) | To build |
|---|---|---|---|
| Brand overview | Focal brand KPI tiles per funnel stage with change vs last wave; competitor comparison | Funnel scores per brand, one wave | Tiles with wave change and significance; selected comparators, never a ranking |
| Funnel and conversion | Awareness, consideration, shortlist, first choice (cars); ownership, recent acquisition, repeat kept separate | Four stages; "conversion" only as a ratio of two marginal rates, labelled as such | Case-level conversion (share of each stage who reach the next) where stages are nested in the data; the marginal ratio stays the fallback, labelled |
| Timeline | Each measure across waves | Wave dashboards built separately | One trend view per measure, unrounded changes, wave bases shown |
| Unfamiliar and rejectors | Aware but not considering; rejection reasons | Not built | Rejector shares and reasons by brand |
| Moments (category entry points) | Mental market share, mental penetration, network size; moment-brand matrix; brand fingerprint | Each moment scored per brand, like an attribute; no mental market share, penetration or network size | Ehrenberg-Bass measures from unprompted CEP links (formulas and bases in the role spec) |
| Associations and positioning | Prompted pick-any attributes by brand, based on those aware; positioning map | Attribute scores and a positioning map | Base on aware, competitor average and gap, "don't know" kept in the base per the pack |
| Advertising and word of mouth | Ad recall, channel of recall, WOM received, positive and negative | Not built | Recall and WOM by brand; "not sure" (code 9) kept apart |
| Category behaviour | Repertoire size, switching, decision style | Not built | Repertoire from usage MR sets; switching from past and current brand; decision style as a segment |
| Buyer demographics and media | Who buys and who is missed; media consumption | Not built | Profile of brand buyers against category buyers, small bases flagged (n<50) and not inferred (n<30) |
| Filters | Demographics, brand users, decision style | None in the module (weighted or unweighted only) | Shared filter bar for every section, same bases and weights everywhere |
| AI Analyst | Executive interpretation | Not built | The AI Insight button (D4), per section and overall |

Every new measure gets its definition (numerator, denominator, base, weighting) in a contract and an
independent reference value from the test packs' `reference_results.json` before it is shown.
Sequence stays: batch 53, then D1 role recognition (covering every row above), D2 configuration, D3
layout with all sections, D4 AI Insight. The new measures (case-level conversion, rejectors, moments
metrics, advertising and WOM, category behaviour, demographics and media) are each tier A and may be
split across D2 and a D2b so each stays reviewable.

## Added 28 October: driver analysis and NPS pages (Grant's three design previews)

The previews (figures transcribed from an older screen, not recalculated) show a Driver analysis page
(Executive overview, Driver detail, Diagnostics) and an NPS page (NPS overview, Promoter drivers,
Diagnostics). They are first the redesign of the Analytics module's own Driver analysis and NPS tabs (Grant,
28 October: "meant for the driver analysis and NPS analysis specific tabs"). The CSM dashboard's NPS and
Drivers tabs reuse the same components and results where that works, with the dashboard's filters.

**Already computed by the modules (code at 16253c5b):** Shapley shares of R-squared (Johnson's relative
weights when there are more than 12 predictors), logistic models with McFadden's R-squared (Shapley up to 8
predictors), seeded bootstrap 95% intervals for each share, R-squared and adjusted R-squared, complete-case
exclusion count, VIF overlap warnings, the derived-against-stated (Kano) quadrant; NPS by segment with
raw, weighted and effective bases and standard errors.

**Driver page to build:**
- Tiles: explanatory power (R-squared, adjusted), cases analysed out of loaded, excluded for missing
  values (highlighted when large), predictors in the model.
- A headline written by rule, not by a model: when intervals overlap it says the ranking is uncertain;
  it states the share of variation explained; "associations are not causes" always shown.
- Importance against performance: relative importance (share) against each predictor's performance on
  its own scale (top-two share or mean, as configured); dividers at the averages, labelled as relative
  guides, not targets (Investigate, Protect, Monitor, Maintain). Kept beside the existing Kano chart, which
  answers a different question.
- Ranked drivers with each share's bootstrap range; numbered dots match the ranking.
- Mixed scales: predictors on different scales (0 to 10 scores beside 0/1 indicators) are not placed on one
  performance axis without a caution; binary indicators are shown with their share, not a mean.
- Diagnostics tab: method used and why (Shapley or relative weights), VIF, exclusions by variable, bases,
  weights.

**NPS page to build:**
- Tiles: NPS, detractor share, effective base, 95% interval for NPS; recommendation profile with the three
  shares summing to 100 and the arithmetic shown (promoters minus detractors).
- Compare groups: each group's NPS with its base; a significance test of each group's difference from the
  rest (new statistic: difference of two NPS estimates with its standard error under the survey design,
  with a multiple-comparison correction across groups); when not computed it says so, as the preview does.
- Promoter drivers: the linked logistic model of promoters (9 to 10) against everyone else (0 to 8), stated
  as such ("not a model of NPS itself"); classification accuracy shown beside the majority-class baseline
  (new statistic), with a warning when there is no gain over the baseline.
- Group by: choosing a group loads or calculates that group's own result and model; the overall result is
  never carried into a group; a group too small for the model (fewer than predictors plus 10 complete
  cases) says so.

**Proof:** the test packs have no answer key for drivers (role spec), so each new or changed statistic gets
an independent reference from a separate implementation on a fixed fixture (for example R `relaimpo` lmg
shares, a hand-worked NPS difference and its standard error, accuracy and baseline counted by hand) before
it is shown.

**Sequence:** the new statistics (NPS group difference test, accuracy against baseline, performance values
for the quadrant) go with the other new measures (D2b); the redesigned Driver analysis and NPS tabs can go ahead as their own batch (D5) once those statistics exist, without waiting for the dashboard layout; D3 then reuses them.
