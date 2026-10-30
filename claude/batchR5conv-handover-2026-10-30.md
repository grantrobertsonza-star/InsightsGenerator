# Batch R5conv handover (30 October 2026)

Status: **implemented, ready for independent review.** Branch `r5conv`, base `b3e230f`, worktree `/home/claude/b119`.
A stage-to-stage "Conversion" view on page 01 "Brand overview" of the Brand tracking dashboard, approved by Grant. No
migration. Tier A (a new calculation, src/lib) with a tier B screen and an engine repair found on the way.

## What changed

- **Conversion view.** The funnel card ("Compare the brand funnel") has a switch, Funnel / Conversion. Conversion
  shows one small ranked horizontal bar chart per step side by side (BMW: Awareness to Consideration, Consideration to
  Shortlist, Shortlist to First choice), every listed brand ranked by its conversion, the client's brand in blue, value
  labels, each bar's base and counts on hover and keyboard focus (title and accessible name), a one-line headline per
  step for the client's brand ("BMW converts 38% of aware respondents to consideration, 8th of 10 brands." on BMW wave 1, weighted), notes for
  non-nested respondents, answers outside the base and skipped steps, and a table of every figure, base and count under
  "Table of figures and bases". No significance claims.
- **Why a switch, not a card:** the charts take the funnel card's place instead of adding a row of the same height under
  it (the page is being made more compact in another session), and the conversion, about 40 engine tables for a
  ten-brand file, is calculated only when first asked for; it is kept while the card switches back and forth, and asked
  again when the dashboard reloads (a saved choice or a reset).
- **Engine repair (separate commit).** A weighted share of 100% in a filtered column could be computed one rounding step
  above 1 (the selected weights and the base are summed in different orders) and its standard error then failed the
  whole table with "math domain error". Nested funnel data hits it at once (everyone considering a brand is aware of
  it), and any filtered weighted Cross tab with a row at 100% could. `prop_row` in `api/parse-stats-file.py` caps the
  share and its complement at 1. Selftest check "R5conv" fails without the cap (2 of 12 weight draws raise the error).
- **Merge note: overlapping engine fix.** Branch `r5segment` fixed the same defect independently (shares of
  1.0000000000000002 under a filter causing the math domain error) with a `_subset_share` helper. The two fixes overlap:
  when both branches are merged, keep one of them (not both caps), and keep both selftest checks so either
  implementation is still exercised by this branch's case.

## Contract (full text: `claude/d2-design-2026-10-29.md`, D3h; registry row in `claude/rules-registry.md`)

- Conversion of brand X from stage S to the next mapped stage T = weighted count of respondents at S for X (S's
  selected code for X, `selectedCode`, by raw code) who are also at T for X, divided by the weighted count of
  respondents at S for X with a known answer to T for X (the selected code or an explicit not selected code,
  `answerSides`).
- Computed respondent by respondent through the engine: a Cross tab restricted to those at S for X by the raw code
  (`between` the code and itself), T's answers read by raw code (`answersOf`, unrounded weighted counts); never
  share(T) / share(S). Per brand and step, the unweighted count at T without being at S (non-nested), read from a table
  restricted to those at T; the card says so when it is not 0.
- Unknown answers at T (don't know, refused, unlabelled, any other label, as `answerSides` classifies) and blanks at T
  are outside the base with their counts; an unknown answer at S is not "at S".
- Bases under the engine's minimum (`notes.minBase`, 10 unweighted) have no figure, show the base, are never 0 and are
  not ranked; the headline says how many brands were not ranked and why.
- Steps: adjacent stages of awareness, consideration, shortlist, first choice, and of usage, frequent usage, each mapped
  to one question by the dashboard (`overviewMeasures`). Decision: a stage with no question is bridged by a step that
  says so ("Awareness to Shortlist (no consideration question)") and both adjacent pairs are listed as skipped; a stage
  claimed by two questions is never bridged over ("Mapping needed", the researcher can choose). Trial is in neither
  chain.
- Weighting and survey design as the dashboard's (weighted by default when the file has a weight; the design is passed
  to the engine and changes no figure here).

## Impact checklist

1. **Rule:** new rule, registry row "stage-to-stage conversion (page 01, D3h)" and contract D3h. Owners reused: the
   stage questions (`overviewMeasures`), the selected code (`selectedCode` via `selectedAnswerOf`), unknown answers
   (`answerSides`), answer counts by raw code (`answersOf`), the engine's restriction by raw code (the association
   page's approach, `between` filter), suppression (the engine's `minBase`). No second version of any of them.
2. **Inputs:** no brand list, "Not measured"; a stage with no question, the step skipped with the reason or bridged and
   labelled; a stage claimed twice, "Mapping needed"; a brand not asked at a stage, its selected answer not told, not a
   numeric code, nobody at S, no known answer at T: n/a with the reason, never 0; a small base, the base without a
   figure; a file whose dictionary, set-up or table cannot be read: the action fails with the reason and the screen
   shows it with "Try again" (never an empty chart).
3. **Persistence:** none. Nothing is saved (computeCrosstab, the test confirms no table row is added).
4. **Freshness:** no derived result uses the figure yet (no finding, insight, export or narrative). It follows the
   dashboard's saved choices on every load.
5. **Screens:** only the latest answer is shown (a reload of the dashboard while an answer is pending: the earlier answer
   is ignored); failure with "Try again"; the switch keeps the calculated view while switching back. Panel change is
   limited to the funnel card on page 01 (import, two state values, the switch and the card's subtitle).
6. **Proof:** see below. The database test fails without the engine repair (every step's restricted table failed with
   "math domain error" on the BMW file); the non-nested case asserts the reported figure differs from the ratio of
   shares by more than 5 points, so a share-ratio implementation fails it; the mounted test fails when the late-answer
   guard is removed (checked by removing it: 1 failed).

## Proof

- `src/lib/__tests__/trackerConversion.db.test.ts` (real disposable PostgreSQL, actual Python engine; storage an in-memory
  stand-in, the model stubbed and never called), expected values from `src/lib/__tests__/helpers/conversion_reference.py`
  (pandas over the same file, written from the contract, never the app's output), 6 tests:
  BMW wave 1 SPSS weighted, all 30 brand and step figures with base, count at S, count at both, unknown, no answer and
  non-nested counts, to 1e-6, nested so the ratio of shares agrees and every non-nested count is 0, no table saved;
  unweighted (BMW aware to consideration 321/831 exactly); a boundary CSV with the pack's metadata.json as codebook
  (brand 10: 40 respondents considering without awareness, figure 23.81 against a ratio of shares of 30.41, non-nested
  40; BMW: 30 don't know labelled by the codebook and 5 unlabelled at consideration outside the base by kind, 20 don't
  know at awareness not aware and 7 of them non-nested; brand 9: 8 at shortlist suppressed with the base, headline "of
  9 brands; 1 brand not ranked (1 small base)"; brand 7: 6 blank first choice answers outside the base); a file without
  consideration (bridged step equal to the reference); the weight times 3.7 (every figure unchanged to 1e-9, bases
  equal, weighted bases times 3.7); an unreadable file rejects and recovers.
- `src/lib/__tests__/trackerConversion.codex.db.test.ts` (real disposable PostgreSQL, actual engine, same stand-ins),
  6 tests: Codex's independent reference (`fixtures/tracker-packs/bmw_car/bmw-independent-reference.json`, copied
  unchanged from Codex's read-only task folder, sha256 `bfe50f5eede27e9474fa7b309992a7937c7eba641dff9d38a7a875fb9b65f7a8`
  checked in the test), computed person by person from the raw BMW CSVs by Codex's own script. Waves 1 and 2, weighted
  and unweighted, all 120 brand and step cells: conversion within 1e-6 percentage points, unweighted base, count at the
  earlier stage, count at both and the non-nested count exactly, weighted base and weighted count at both to 1e-6; BMW
  wave 1 written out (321 of 831, 38.4806%; 166 of 321, 50.2593%; 61 of 166, 35.4254%). Codex's denominator is everyone
  at the earlier stage, ours everyone at it with a known answer at the later one; they coincide only when there is no
  unknown or blank answer at the later stage, so the test asserts 0 of each per cell rather than assuming it.
  **Result: no disagreement.** The app matches every Codex value; separately, `conversion_reference.py` (our pandas)
  matches Codex on all 120 cells to 2.2e-14 points with identical counts. With the engine repair reverted (base
  `b3e230f`'s `api/parse-stats-file.py`), the 3 weighted tests fail with "math domain error" and the unweighted ones
  pass; restored afterwards.
- `src/lib/__tests__/trackerConversion.test.ts` (pure, 14 tests): steps, gaps and bridges, mapping needed; the cell
  arithmetic with a labelled don't know, the non-nested count, the minimum base at 9 and 10, nobody at S, all unknown at
  T, an untold selected code; ranking with ties; headline wording and ordinals.
- `src/lib/__tests__/conversionView.test.tsx` (mounted, react-dom/client in linkedom; the server action is the mocked
  boundary, the display rules real), 2 tests: the switch; ranked bars, focal mark, values, suppressed base last, headline,
  hover and focus text, notes, table rows, a late earlier answer ignored, failure and Try again.
- `scripts/crosstab_selftest.py` check "R5conv".
- `e2e/ui/tracker-conversion.check.mjs` (browser on the disposable stack): BMW wave 1, Conversion shows three steps of
  ten brands, BMW marked with values equal to the reference to one decimal, base in the accessible name, headline rank of
  10, ranked order, 30 table rows, back to Funnel.

## Gates (worktree b119)

GATES_PLACEHOLDER

## Files

- New: `src/lib/trackerConversion.ts`, `src/lib/trackerConversionDisplay.ts`, `src/lib/trackerConversionActions.ts`,
  `src/app/runs/[id]/ConversionView.tsx`; tests `src/lib/__tests__/trackerConversion.test.ts`,
  `src/lib/__tests__/trackerConversion.db.test.ts`, `src/lib/__tests__/trackerConversion.codex.db.test.ts`,
  `fixtures/tracker-packs/bmw_car/bmw-independent-reference.json` (Codex's file, unchanged),
  `src/lib/__tests__/conversionView.test.tsx`,
  `src/lib/__tests__/helpers/conversion_reference.py`, `e2e/ui/tracker-conversion.check.mjs`; this handover.
- Changed: `src/app/runs/[id]/TrackerDashboardPanel.tsx` (page 01 funnel card only), `api/parse-stats-file.py`
  (`prop_row`), `scripts/crosstab_selftest.py`, `claude/d2-design-2026-10-29.md` (D3h), `claude/rules-registry.md`.
- Callers checked: every caller of `computeCrosstab` reaches the `prop_row` cap; it changes only a share computed above 1
  (to exactly 1) and its complement, so no figure that was valid before changes beyond the last bit. The other tracker
  pages' loaders are untouched; `trackerDashboardActions.ts` is untouched (the action is in its own file).

## Mocks versus real

Real: PostgreSQL (disposable database per test file), the Python engine, the recogniser and dashboard choices, the
codebook link, the browser stack (production build, disposable database, storage stand-in, model replay). Mocked:
storage (in-memory) and the model (never called) in the database test; the server action in the mounted test.

## Limits

- The SPSS reader alone does not group a per-brand yes/no variable that holds a third code (a don't know) into its stage
  question, so that brand has no variable at that stage and its conversion is n/a with the reason. With a codebook's
  question sets it is grouped, and the don't know is outside the base as specified. Existing recogniser behaviour, not
  changed here.
- No change against the previous wave, no significance and no comparison between brands are computed. The figure is not
  yet a finding or part of an export.
- Trial is in no chain; first choice to usage is not a step.
- The effective base is reported for the file, not per conversion base.
