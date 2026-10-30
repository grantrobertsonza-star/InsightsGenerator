# Batch 59 handover: percentages and derived figures from unrounded figures (CT5K-F01)

Status: implemented, ready for independent review. Tier A (plus one tier B line in a client component).
Branch `ct5k-fix`, worktree `/home/claude/b69`. Base commit `d2a321d`. Commits: `7d60813` (engine fix for
row % and share of responses, regressions), `a8c73f1` (contracts, first handover), and the follow-up
commit that closes the derived-figure gap (exact fields saved with the table, every derived figure moved
to them, this handover).

## Finding

CT5K-F01 (Codex, 28 October 2026, S1): `add_row_pct` and the share-of-responses pass divided counts already
rounded to one decimal. With weights of 1/1024 the selected answer's row % read 0/0/100 (expected 10/30/60),
the other answer 50/50/0 (expected 45/35/20), the overall share of responses 50/50 (expected 40/60), and the
first group's shares were blank (expected 25/75). Ordinary fractional weights shifted them by up to about 0.8
points (the selftest's fractional case: 42.2 against 42.0, 15.1 against 15.6).

Coordinator follow-up (same day): the same criterion covers the TypeScript figures that add or subtract
rounded one-decimal shares; close them rather than list them.

## What changed

Engine (`api/parse-stats-file.py`, `crosstab`):
- Every share row now carries `countExact`, `pctExact` and `seExact` per column, and `countExact`/`pctExact`
  on its Total and on each banner's NET column. Mean and score rows carry `pctExact` (the unrounded mean);
  histogram bars carry `pctExact`. `pctExact` is null exactly where `pct` is. These are documented fields
  of the result (`parseStatsFile.ts` `CrosstabRow`, `CrosstabNetCell`, `CrosstabDesc.hist`) and are saved
  with the table. They replace the private `_w` field of `7d60813`.
- `add_row_pct` and the share-of-responses pass divide `countExact` and round only the result. Domains
  unchanged: row % within each banner variable (overlapping columns counted once per column); suppression
  under an unweighted base of 10; a zero denominator stays None.
- `TABLE_METHOD` "2026.10.28"; `ENGINE_VERSION` "2026.10.28-2".

`src/lib` (one owner per rule kept; each now reads the unrounded figures through the new
`src/lib/crosstabExact.ts` and rounds once):
- NPS: `descriptiveFindings.computeNps` (default reader `exactTotalPct`; callers in `npsActions`, overall
  and per segment, and `levelFindings` pass `exactTotalPct`/`exactPct` and `exactSe`).
- `descriptiveFindings.levelFindings`: top-two and bottom-two box (a missing share makes the box
  unavailable instead of 0), single, NET and score shares and their intervals.
- CSM: `chartActions` copies `pctExact` into each bar's new `share` (null where suppressed);
  `csmMetrics.summarizeSeries` adds `share` and returns `value` (display) and `exact`. A suppressed bar makes
  the reading unavailable (before: a suppressed segment's box read 0).
- Brand health: `brandHealthMetrics.categoryAverageExact` (and `categoryAverage` rounds it once); funnel
  conversion ratios and the gap to the category from the brands' `exact` scores; the above/at/below band in
  `BrandHealthAnalyticsPanel.tsx` (tier B line) compared unrounded.
- Export (`crosstab/export/route.ts`): the Total line adds the unrounded shares and weighted counts, then
  rounds.
- `crosstabs.crosstabFindings`: the ranking gap of a column finding from the unrounded figures.
- `tableMethod.ts`: `CURRENT_TABLE_METHOD` "2026.10.28", `EARLIER_METHOD_TEXT` names the change.

NPS, top-box and CSM were already computed in one place each in `src/lib`; the engine does not compute
them (it only gives NPS's design-based contrast SE), so no second implementation was added. The two top-box
rules (`levelFindings` by label direction, `summarizeSeries` by code) are distinct rules, as before.

Contracts: `claude/table-method.md` (rule, unrounded fields, derived figures, legacy reading, limits),
`claude/rules-registry.md` (rows for row % and share of responses, and for derived figures; NPS and CSM
rows point at the new tests).

## Same pattern elsewhere

Engine: only the two sites above divided rounded values. Means, net scores, eta, the whole-table test,
residuals, the NPS contrast SE, histograms, descriptives and `pctValid` use unrounded arrays; Fisher's exact
test rounds unweighted integer counts (exact). `src/lib` and the app: searched for sums, differences, ratios
and comparisons of `pct`, `count`, `rowPct`, `respPct`, `se`, box scores and averages. Every arithmetic use is
listed under "What changed". Remaining uses of the rounded figures are display, sorting for display, or a
copy of one figure (chart bar heights, NPS scale bars, wave tracking bars, which are not added).

## Impact checklist

1. Rule: registry rows "Row % and share of responses" and "Derived figures are computed from the
   unrounded figures"; owners named above; no second implementation.
2. Inputs: zero denominator None; suppressed cells null in `pctExact` and `share`, so NPS, box scores and CSM
   readings are unavailable, never 0. A table saved before the exact fields (no `pctExact`) is read from its
   rounded figures by `crosstabExact.ts`, the arithmetic used before; it is already reported as built with
   an earlier method. Deliberate, documented and tested (`exactDerivedFigures.test.ts`).
3. Persistence: no write path changed. The exact fields travel in the saved result JSON; reload equals the
   stored table (asserted). Measured size of one saved result (profile-00, two banners, three questions):
   23,336 to 29,091 bytes (+24.7%). The result goes to storage as a JSON file, not a response body.
4. Freshness: tables recorded as "2026.10.27" or earlier, or with none, read "earlier": list badge, finding
   note, support reason `method_changed` (stale) for insights, pre-insights, recommendations and narratives,
   on screen and in exports. Nothing is recalculated; finding and insight wording, review decisions and the
   saved table stay until the researcher rebuilds (asserted). Findings computed on demand (NPS tool, CSM,
   brand health) are recomputed from a fresh build each time they are run, so they use the exact fields at
   once. An NPS or top-box finding already saved keeps its wording.
5. Screens: the earlier-method text; the brand band colour can change for a brand on the 5-point edge. A
   CSM segment whose cells are suppressed now reads unavailable (null) instead of 0.
6. Proof: below.

## Commands and counts

| Command | Before | After |
|---|---|---|
| `python3 scripts/crosstab_selftest.py` | base engine: 352 pass, 29 fail (all CT5K) | 403 pass, 0 fail |
| `npx vitest run src/lib/__tests__/exactDerivedFigures.test.ts --pool=forks` | `7d60813` sources: 6 failed, 3 passed (NPS 4.7 not 4.5; box 40.0 not 40.1; suppressed box 0; category average 10.1 not 10.2; finding 40.0) | 9 passed |
| `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run src/lib/__tests__/weightScalePercentages.db.test.ts --pool=forks` | base: 3 failed; `7d60813` sources: derived-figures case failed (no `pctExact`) | 4 passed, 1 skipped (no-database placeholder) |
| `npx next typegen` | | exit 0 |
| `npx tsc --noEmit` | | exit 0 |
| `npx eslint .` | | 0 errors, 44 warnings (existing) |

The two-level "before" runs replaced the changed source files with the `7d60813` versions in the worktree,
ran the test, and restored them (`tar`), confirmed by `git status`.

Other affected files, one at a time, `--pool=forks`, real disposable PostgreSQL where `.db.`:
answerDomainScores.db 6/6 (one assertion pinned the defect: Men's top two 66.6 from 33.3 + 33.3; its own
comment computes 66.7; now 66.7), meanTick.db 8/8, csmMetrics 7/7, descriptiveFindings 4/4,
goldenReferenceFixtures 9 passed 1 skipped, chartMethod 3/3, chartKinds 2/2, waveTrackingNpsMetadata 1/1,
tableMethod 3/3, supportStatus 16/16 (assertion updated to the new earlier-method wording), evidenceStance
13/13, crosstabInsights 12/12, crosstabConcurrentSave.db 2/2, supportNetInputs.db 5 passed 1 skipped,
analysisPlan.db 8/8, callerToBuilderStrictSetup 6/6, designLookupFailureSurfacing 9/9,
starterMeanScaleEngine 4/4, crosstabAskMeanEngine 9/9, engineSetKeyIdentity 2/2.

Mocks versus real: database tests use a real disposable PostgreSQL and the actual Python engine through
`buildCrosstab`, `runNpsAction`, `runDistributionAction`, `commitCrosstabs`, the export route and
`loadInsightSupport`; storage, the model, `next/cache` and request context are mocked.
`exactDerivedFigures.test.ts` gives hand-written rows to the real functions.

Regression values (independent, by hand): NPS scale 0 to 6 at 4.54% each, 7 at 16.00, 8 at 15.94, 9 and 10
at 18.14: NPS 36.28 - 31.78 = 4.5 (4.7 from display parts), promoters 36.3, passives 31.9, detractors 31.8,
Total weighted count 100 (99.6 from display counts). Rating 20.00/20.00/19.92/20.04/20.04: top two 40.08,
shown 40.1 (40.0 from display parts); coded mean 300.12 / 100 = 3.0012. Brand scores 10.14/10.14/10.24:
category average 10.17, shown 10.2 (10.1 from display values).

## Replay of the retained independent campaign (`codex-ct5000`)

Copied to the scratchpad (`b59/replay-before`, `b59/replay-after`, `b59/replay500`).

- `engine4500.py`: base engine 3851 pass, 649 fail, only row and response percentages (small_bases 160,
  multiple_response 150, multiple_banners 150, nets_scores 100, frequency 65, survey_design 24). After
  `7d60813` and again after the follow-up: 4500 pass, 0 fail. Each regenerated catalog equals the original
  in every case except `sourceSha256` (the .sav files carry new write timestamps).
- `weight-scale-control.py`: base, the 1/1024 run gave 0/0/100, 50/50/0, shares 50/50 and None/None; after,
  identical to the unit-weight run (10/30/60, 45/35/20, 40/60, 25/75).
- `independentCross500.db.test.ts` (copied temporarily, `root` from `CT500_ROOT`, deleted afterwards): as
  written, the 100 `excel_export` cases fail on a harness gap (the export route's `@/lib` imports are not
  mapped; there is no vitest alias). With the alias mocks the repository's export tests use
  (`crosstabMeanRows`, `crosstabSlides`, `convertToPdf`, and now `crosstabExact`): 500/500 pass, after
  `7d60813` and after the follow-up.

## Limits and open items

- Over-marking: unweighted tables recorded as "2026.10.27" are marked earlier although their figures were
  exact; the record cannot tell affected tables apart without rebuilding.
- `TABLE_METHOD` stays "2026.10.28" for both commits of this unreleased batch: a table built with
  `7d60813` alone (only in test databases) would read as current but carry no exact fields, so it is read
  from its rounded figures.
- Grouped chart bars still draw a suppressed cell at height 0 (`pct`), as before; its `share` is null and no
  derived figure uses it. Changing the drawing is a screen change outside this finding.
- Saved results are about a quarter larger.
- Browser gates not run here (lead runs them): the earlier-method text, the brand band and an unavailable CSM reading for a
  suppressed segment are visible changes.
- The route imports a new `@/lib` module, so any test that loads the route must map it (done in the two
  repository tests that do).
