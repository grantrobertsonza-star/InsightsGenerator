# Batch R5 CSM segment handover (30 October 2026)

Status: **implemented, ready for independent review.** Branch `r5csmseg`, base `r5segment` at `a7dab7b` (the brand
dashboard's segment). Tier A (engine, the distribution, NPS and driver tools, the CSM loader) with a tier B screen. No
migration.

Grant (owner, 30 October 2026): "CSM needs a segment tool as well". The CSM dashboard's "Segment: All segments" chip was
static text; it is now the brand dashboard's picker and every CSM figure is computed in the segment.

## What changed

- **Screen.** `TrackerDashboardPanel.tsx`: the CSM page's chip is `SegmentChip` (same component, same profile
  questions from the server, same Apply and Clear); the chip also shows while the CSM page loads or after a refusal,
  with "Clear the segment"; the page's segment reading (`overview.segment`) feeds `CardSegmentBase`, which every CSM
  tile (also failed tiles) and card shows. Wording under a segment: "customers in the segment" instead of "all
  customers", the trend "the segment applied in each wave", the driver card "<n> complete cases of <cases> in the
  segment", the NPS card adds the effective base when weighted, weighted tiles add the number answering.
  `SegmentPicker.tsx` `useStoredSegment` reads the stored segment for both kinds (`tracker-segment:<runId>:csm`).
- **Loader** (`trackerOverview.ts`). `loadBrandOverview(..., "csm", segment)` no longer refuses a segment. The segment
  check per wave is one function (`segmentForWave`, moved out of `figuresFor` unchanged) and is now also used for the
  earlier waves of the CSM trend. The CSM page's segment base comes from `trackerSegment.segmentBase` (one table of the
  first segment question computed in the segment).
- **CSM figures** (`trackerCsmFigures.ts`). `csmOverviewFigures`, `csmAttributeMeans` and `satisfactionMean` take the
  applied segment and pass it by codes (`segmentOf`) to the tools; failures say the segment in words
  (`segmentFailure`). New tile fields (all optional, for existing fixtures): box tiles `rawBase`, `weightedBase`,
  `shares`; NPS `effectiveBase`, `weightedBase`; attribute means `rawBase`, `weightedBase`; driver `cases` and each row's
  `coefficient`.
- **Segment owner** (`trackerSegment.ts`). `segmentFilters` and `withSegment` accept a segment by codes as well as an
  applied one (same filters); new `segmentOf`, `toolSegment` (a tool's boundary check: shape by `parseSegment`, every
  question a variable of the file), `segmentBase`.
- **Tools, contract changes** (each keeps its old behaviour when no segment is passed):
  - `runDistributionAction(runId, documentId, variable, weightVar, groupVar, table = "save", segmentRaw = null)`:
    checked by `toolSegment`, request through `withSegment`. Result: `filters` under a segment only; every value series
    now carries `base` (`n`, `w`, `nEff`, the engine's answered base); `n` unchanged.
  - `runNpsAction(runId, documentId, variable, weightVar, groupVar = null, design?, table = "save", segmentRaw = null)`:
    the same; `filters` under a segment only.
  - `runDriverAnalysisFor(tenantId, runId, documentId, request, segmentRaw = null)`: `segmentFilters` sent to both
    engine `columns` reads; under `MIN_SEGMENT_CASES` (20, now exported, the rule a group of the group variable already
    had) cases in the segment: refused, "Fewer than 20 cases in the segment (<engine description>: <n>), so the driver
    model is not run on it."; report `segment` (`{ segment, filters, cases }`), `casesInFile` the segment's cases.
- **Engine** (`api/parse-stats-file.py`). The filter block of `crosstab` moved unchanged into `_case_filter_mask`
  (the one case filter path); `crosstab` calls it as before (filtered cases weight 0, design kept). `driver_columns`
  takes optional `filters`, selects through the same function, returns only those cases (no survey design there to
  keep them in) and `filters` (empty without any).

## Impact checklist

1. **Rule.** Registry row "A tracker dashboard's segment" extended (CSM, tools, owners); row "Restricting a table by raw
   answer code" now names `_case_filter_mask` and both callers. Contract: `claude/d2-design-2026-10-29.md`, new section
   "R5 CSM segment" (and the R5 Segment paragraph that said the CSM refuses a segment corrected). Owners reused, none
   duplicated: `trackerSegment` (segment to filters), `computeCrosstab`, the engine filter path, `MIN_SEGMENT_CASES`,
   `segmentAgainstWave` / `codeNamesDiffer`, `demographicKindOf`, `summarizeSeries` / `shareOfCodes`, `computeNps`.
   No tool builds a filter itself.
2. **Inputs.** No segment: unchanged (existing NPS, driver, distribution and CSM tests unchanged and passing). Malformed
   segment at a tool: "The segment was not understood. Choose it again."; a question the file lacks: "The segment
   question <v> is not in this file." A segment the open file cannot apply, or nobody is in: the page fails with the
   reason and "Clear the segment". Blank answer: outside. A small segment: the engine's per-figure suppression as
   before; the driver model refused under 20 cases with the reason (failed tile, other tiles shown). A compared or
   earlier wave lacking a question or code: withheld with the reason, never unsegmented. Storage blocked: all eligible.
3. **Persistence.** None: figures computed, nothing saved (test checks no table is written); segment per browser.
4. **Freshness.** Nothing derived is stored by the dashboard. A consumer recording provenance from the CSM dashboard
   must record `overview.segment` (none exists on this branch). Saved driver reports from the Driver tool are unchanged
   (no segment there).
5. **Screens.** A segment change reloads through the panel's existing request counter; a late answer for an earlier
   segment is ignored (mounted test). "Saved" is not involved. The chip stays usable while loading and after a refusal.
6. **Proof.** Below.

## Proof

- `src/lib/__tests__/trackerCsmSegment.db.test.ts` (7 tests; real disposable PostgreSQL, the actual Python engine,
  in-memory storage stand-in). Expected values from `src/lib/__tests__/helpers/csm_segment_reference.py` (pandas and
  numpy over the same SPSS file; weighted least squares with an intercept for the coefficients and R^2, a Shapley split
  of R^2 averaged over all 720 orders with each subset's own fit, written from the answer lists and the contract, never
  from the app's output). The banking pack's relationship waves have only one profile question (the pack's
  "segment"), so the script adds two seeded profile questions (gender, 12 blanks; age group) to copies. Segment: Woman
  AND Segment 1 or Segment 3 (351 respondents in wave 2).
  1. Weighted, wave 2 against wave 1: segment n, weighted total and Kish effective base (engine one decimal, 0.051);
     the filters; satisfaction mean, every answer's share and top two box (1e-9); stay and switch boxes; each tile's
     raw base (exact), weighted base (0.051) and effective base (0.5, the tool rounds); NPS promoters, passives,
     detractors and score (0.05, the tool's one decimal), raw base exact, weighted and effective bases; six attribute
     means (1e-9) and bases; driver method, cases, complete cases, R^2, all six shares and coefficients (1e-9); the trend's
     wave 1 point and the change (box and mean) against wave 1 equal the segmented references; profile questions
     offered (gender, age_band, segment); no table saved; unsegmented figures differ.
  2. Unweighted: the same figures against the unweighted reference.
  3. Company split: FNB (code 1) and Capitec (code 5) within the segment: satisfaction mean and box, NPS score and base.
  4. A segment of 11 (Another identity AND Segment 2): driver tile failed with the exact reason; the owner called
     directly refuses the same; other tiles shown; segment n equal to the reference.
  5. Wave 1 without age group: segment Woman AND 25-34 or 35-49 on wave 2 has `previous` withheld with the reason, the
     trend point failed with it, every change carrying it, wave 2 still equal to the reference; with three waves the
     earliest is "Not drawn for Wave 1: ..." while wave 2 of three is drawn in the segment; without the segment the
     waves compare; opened on the wave without the question, refused.
  6. Weights times 2.5: every segmented share, mean, box, NPS part, attribute mean, driver share, coefficient and R^2,
     and the trend point equal to 1e-9 (more than 40 figures), effective bases equal, weighted totals times 2.5.
  7. Tools at the boundary: no segment and an explicit null give the same result; `filters` only under a segment, in
     the engine's words; malformed and unknown-variable segments refused.
  Shown failing without the change: with `toolSeg` in `trackerCsmFigures.ts` returning null (tiles computed on every
  respondent), test 1 fails ("expected 3.6719389761835526 to be close to 3.6836462272263453").
- `src/lib/__tests__/trackerCsmSegmentPanel.test.tsx` (2 tests, mounted `TrackerDashboardPanel` as the CSM dashboard in
  linkedom; server actions mocked and held): no "All segments" text; the picker lists the questions; Apply sends a
  two-question segment with kind "csm" and stores it under `tracker-segment:run-1:csm` only; switching to Man with
  Woman's answer arriving late, Man's figures stay; every tile and card names the segment; the "customers in the
  segment" and driver cases wording; the brand key and the csm key kept apart; a refused segment offers Clear the
  segment. Shown failing without the change: with the static chip restored, test 1 fails ("expected ... not to contain
  'All segments'").
- `src/lib/__tests__/trackerSegment.db.test.ts`: the one assertion that the CSM dashboard refuses a segment now asserts
  that it takes it (segment n 228 on BMW wave 1, the brand segment's own reference). This is the intended contract
  change, not a weakened test.
- `scripts/crosstab_selftest.py` "driver columns filter" (4 checks): codes 1 or 3 returns those cases in file order,
  blank outside; described as a crosstab describes it; no filters returns every case; nobody in the segment refused.
- `e2e/ui/tracker-csm-segment.check.mjs` (browser, disposable stack): see Checks run.

## Checks run

RESULTS_PLACEHOLDER

## Mocks versus real

Real: PostgreSQL (a disposable database per test file), the Python engine, the banking pack's SPSS files (with seeded
profile columns added by the reference script), the pandas and numpy references, the browser stack (production build,
`next start`). Mocked: object storage (in-memory stand-in), the model (never called), and in the mounted test the
server actions (the boundary whose answer order is under test).

## Limits

- The banking CSM pack has one profile question of its own; the two-question segment in the tests uses seeded gender
  and age group columns added to copies of the pack's files (the script is in the repository and seeded).
- Driver priority stays "all customers" when a company is chosen in "Show figures for" (as before); under a segment it
  is the segment's customers. Service attributes are not split by company (as before).
- The driver minimum is the owner's 20 cases in the segment; the model's own minimum (complete cases at least
  predictors plus 10) applies after it and is reported in its own words.
- The NPS tool reports parts and score to one decimal and the effective base rounded; the distribution tool's series
  `n` is the rounded effective base (unchanged).
- Remembered per browser only, as on the brand side.

## Merge notes

- `runDistributionAction`, `runNpsAction` and `runDriverAnalysisFor` take a trailing segment argument; every existing
  caller passes none. `ChartSeries.base` is new on every value series; `driver_columns` returns `filters` (empty
  without filters).
- `segmentFilters` / `withSegment` accept `Segment | AppliedSegment`.
- A provenance consumer from the CSM dashboard must record `overview.segment` and must not present segmented CSM
  figures as all customers.
- Do not edit `docs/current-engineering-status.md` (not touched here).
