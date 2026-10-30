# Batch R5conv handover (30 October 2026)

Status: **implemented, ready for independent review.** Branch `claude/r5conv` (cloud continuation of the local branch
`r5conv`, base `b3e230f`, local checkpoint `10177e0`). The branch's first commit `0865097` is a squashed snapshot of the
local branch on top of `6e42ca0` (the laptop tree at `acd57212`), so a diff against `6e42ca0` also shows the R3 repair
package (D3E, BH, D6, T2, E1R, setup queue) that the local base `b3e230f` already held. The R5conv change itself is
the file list under "Files"; the R3 files are not part of this review target.

A stage-to-stage "Conversion" view on page 01 "Brand overview" of the Brand tracking dashboard, approved by Grant. No
migration. Tier A (a new calculation, src/lib, and an engine repair found on the way) with a tier B screen.

## Review of the work-in-progress checkpoint (cloud session)

The checkpoint `0865097` was reviewed before finishing. All of its retained tests passed as committed (28 of 28 in the
four conversion files). Found and changed in this session:

1. **Engine cap incomplete.** The checkpoint capped a column's share and its complement at 1, but not the total's share
   or a banner NET column's share, which are summed the same way. With the column cap alone, the selftest's weighted,
   filtered 100% table still returned a total `pctExact` of 100.00000000000003 (2 of 12 weight draws). The total and the
   NET are now capped too, and the selftest check "R5conv" also asserts the total. The other branch's `_subset_share`
   (below) covers the same four places, so the two fixes are now equivalent in scope.
2. **Unknown shown as 0.** The table's "Unknown at later" column read "0" for a brand whose later stage was never read
   (a brand not asked, an answer that could not be told), where the count is unknown. It now reads "n/a" whenever the
   cell has no base; 0 only when the answers were read and none was unknown.
3. **Brand names cut.** The bar labels used `truncate`, so a long brand name was cut. They now wrap in full (the same
   rule Grant set for the Audience and Media pages: labels wrap rather than truncate).
4. **Document switching not tested.** The mounted test covered a reload of the same file but not another data file
   while the first file's answer was pending. Added (third mounted test).
5. **Codex's reference path.** The checkpoint held Codex's reference as `fixtures/tracker-packs/bmw_car/bmw-independent-reference.json`.
   It is now at Codex's path, `fixtures/tracker-packs/bmw_car/independent/codex-bmw-reference-2026-10-30.json`, the
   same bytes (sha256 `bfe50f5eede27e9474fa7b309992a7937c7eba641dff9d38a7a875fb9b65f7a8`, identical to the file on
   claude/r5audience, r5coverage, r5csmroles, r5fmcg, r5story, r5waves, r6brandext and r6csmext), so merging those
   branches adds no second copy.

Why the tests missed 1 to 3: the selftest asserted only the column's share; the mounted test's cells were all read
(none had a null base) and its brand names were short.

## What changed (whole feature)

- **Conversion view.** The funnel card ("Compare the brand funnel") has a switch, Funnel / Conversion. Conversion
  shows one small ranked horizontal bar chart per step side by side (BMW: Awareness to Consideration, Consideration to
  Shortlist, Shortlist to First choice), every listed brand ranked by its conversion, the client's brand in blue, value
  labels, each bar's base and counts on hover and keyboard focus (title and accessible name), a one-line headline per
  step for the client's brand ("BMW converts 38% of aware respondents to consideration, 8th of 10 brands." on BMW wave
  1, weighted), notes for non-nested respondents, answers outside the base and skipped steps, and a table of every
  figure, base and count under "Table of figures and bases". No significance claims.
- **Why a switch, not a card:** the charts take the funnel card's place instead of adding a row of the same height under
  it, and the conversion, about 40 engine tables for a ten-brand file, is calculated only when first asked for; it is
  kept while the card switches back and forth, and asked again when the dashboard reloads (a saved choice or a reset).
- **Engine repair.** A weighted share of 100% in a filtered column could be computed one rounding step above 1 (the
  selected weights and the base are summed in different orders) and its standard error then failed the whole table
  with "math domain error". Nested funnel data hits it at once (everyone considering a brand is aware of it), and any
  filtered weighted Cross tab with a row at 100% could. `prop_row` in `api/parse-stats-file.py` caps at 1 the column's
  share, its complement's, the total's and each NET column's.
- **Merge note: overlapping engine fix.** Branch `r5segment` (pushed as `claude/r5csmseg`, commit `28a12ed`) fixed the
  same defect independently (a share of 1.0000000000000002 under a filter causing the math domain error) with a
  `_subset_share` helper applied at the same four places. **The fixes overlap.** When both branches are merged, keep one
  implementation (the helper is the tidier owner), not both caps, and keep both selftest checks so either
  implementation is exercised by this branch's case (seeded weights, column and total at exactly 100%).

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
  are outside the base with their counts; an unknown answer at S is not "at S". A count that was not read is n/a,
  never 0.
- Bases under the engine's minimum (`notes.minBase`, 10 unweighted) have no figure, show the base, are never 0 and are
  not ranked; the headline says how many brands were not ranked and why.
- Steps: adjacent stages of awareness, consideration, shortlist, first choice, and of usage, frequent usage, each mapped
  to one question by the dashboard (`overviewMeasures`). A stage with no question is bridged by a step that says so
  ("Awareness to Shortlist (no consideration question)") and both adjacent pairs are listed as skipped; a stage
  claimed by two questions is never bridged over ("Mapping needed", the researcher can choose). Trial is in neither
  chain.
- Weighting and survey design as the dashboard's (weighted by default when the file has a weight; the design is passed
  to the engine and changes no figure here). A weight multiplied by a constant changes no figure.

## Impact checklist

1. **Rule:** new rule, registry row "stage-to-stage conversion (page 01, D3h)" and contract D3h. Owners reused: the
   stage questions (`overviewMeasures`), the selected code (`selectedCode` via `selectedAnswerOf`), unknown answers
   (`answerSides`), answer counts by raw code (`answersOf`), the engine's restriction by raw code (the association
   page's approach, `between` filter), suppression (the engine's `minBase`). No second version of any of them.
2. **Inputs:** no brand list, "Not measured"; a stage with no question, the step skipped with the reason or bridged and
   labelled; a stage claimed twice, "Mapping needed"; a brand not asked at a stage, its selected answer not told, not a
   numeric code, nobody at S, no known answer at T: n/a with the reason, never 0 (including the table's unknown count);
   a small base, the base without a figure; a file whose dictionary, set-up or table cannot be read: the action fails
   with the reason and the screen shows it with "Try again" (never an empty chart).
3. **Persistence:** none. Nothing is saved (`computeCrosstab`; the database test confirms no table row is added).
4. **Freshness:** no derived result uses the figure yet (no finding, insight, export or narrative). It follows the
   dashboard's saved choices on every load. No human wording or decision is involved.
5. **Screens:** only the latest answer is shown, for a reload of the dashboard and for another data file while an
   answer is pending (both mounted tests fail with the guard removed: 2 failed); failure with "Try again"; the switch
   keeps the calculated view while switching back. Panel change is limited to the funnel card on page 01.
6. **Proof:** see below.

## Proof

- `src/lib/__tests__/trackerConversion.db.test.ts` (real disposable PostgreSQL, actual Python engine; storage an
  in-memory stand-in, the model stubbed and never called), expected values from
  `src/lib/__tests__/helpers/conversion_reference.py` (pandas over the same file, written from the contract, never the
  app's output), 6 tests: BMW wave 1 SPSS weighted, all 30 brand and step figures with base, count at S, count at both,
  unknown, no answer and non-nested counts, to 1e-6, nested so every non-nested count is 0, no table saved; unweighted
  (BMW aware to consideration 321/831 exactly); a constructed boundary CSV with the pack's metadata.json as codebook
  (brand 10: 40 respondents considering without awareness, figure 23.81 against a ratio of shares of 30.41,
  non-nested 40; BMW: 30 don't know labelled by the codebook and 5 unlabelled at consideration outside the base by
  kind, 20 don't know at awareness not at S and 7 of them non-nested; brand 9: 8 at shortlist suppressed with the base,
  headline "of 9 brands; 1 brand not ranked (1 small base)"; brand 7: 6 blank first choice answers outside the base);
  a file without consideration (bridged step equal to the reference); the weight times 3.7 (every figure unchanged to
  1e-9, unweighted bases equal, weighted bases times 3.7); an unreadable file rejects and recovers.
- `src/lib/__tests__/trackerConversion.codex.db.test.ts` (real disposable PostgreSQL, actual engine, same stand-ins),
  6 tests against **Codex's independent reference** (`fixtures/tracker-packs/bmw_car/independent/codex-bmw-reference-2026-10-30.json`,
  person by person from the raw BMW CSVs by Codex's own script, sha256 checked). Waves 1 and 2, weighted and
  unweighted, all 120 brand and step cells. Stated tolerances: conversion within 1e-6 percentage points; unweighted
  base, count at the earlier stage, count at both and the non-nested count exactly; weighted base and weighted count at
  both within 5e-7 (`toBeCloseTo(_, 6)`); a base under the engine minimum must be suppressed. BMW wave 1 written out:
  321 of 831 (38.4806%), 166 of 321 (50.2593%), 61 of 166 (35.4254%). Codex's denominator is everyone at the earlier
  stage, ours everyone at it with a known answer at the later one; they coincide only when there is no unknown or blank
  answer at the later stage, so the test asserts 0 of each per cell rather than assuming it.
  **Result: no disagreement.** Every one of the 120 cells matches. With the column cap reverted, the weighted tests fail
  with "math domain error" (checkpoint evidence) and the unweighted ones pass.
- `src/lib/__tests__/trackerConversion.test.ts` (pure, 14 tests): steps, gaps and bridges, mapping needed; the cell
  arithmetic with a labelled don't know, the non-nested count, the minimum base at 9 and 10, nobody at S, all unknown
  at T, an untold selected code; ranking with ties; headline wording and ordinals.
- `src/lib/__tests__/conversionView.test.tsx` (mounted, react-dom/client in linkedom; the server action is the mocked
  boundary, the display rules real), 3 tests: the switch; ranked bars, focal mark, values, suppressed base last,
  headline, hover and focus text, notes, table rows, a late earlier answer ignored after a reload, failure and Try
  again; another data file while the first is pending (the first file's late answer ignored), a cell not read shows
  n/a for its unknown answers, a long brand name in full. Shown failing without the change: with the old unknown cell
  and `truncate`, 1 failed; with the late-answer guard removed, 2 failed.
- `scripts/crosstab_selftest.py` check "R5conv": 12 seeded weight draws, a weighted, filtered table whose share is 100%
  must read exactly 100% in the column and the total. Without the column cap: 2 draws fail with "math domain error";
  without the total's cap: 2 draws give a total of 100.00000000000003%.
- `e2e/ui/tracker-conversion.check.mjs` (browser, production build, disposable stack): BMW wave 1, the switch on
  Funnel by default, Conversion shows three steps of ten brands, BMW marked with values equal to the pandas reference
  to one decimal, base in the accessible name, headline rank of 10, ranked order, 30 table rows, back to Funnel.
  Screenshots at 1440 x 900 when `SHOT_DIR` is set.

## Gates (cloud container, worktree `/home/claude/r5conv-wt`)

Run on the code of commit `7146929` (the docs and screenshots commit after it changes no code). The container was
shared with many other sessions (2 CPUs, 8 GB, load average 12 to 18 throughout, the disk full once and the memory
cgroup's out-of-memory killer active); every failure below is reported with its cause, none is explained away.

- `npx next typegen` then `npx tsc --noEmit`: exit 0, 0 errors.
- `npx eslint src e2e --quiet`: exit 0, 0 errors.
- `python3 scripts/crosstab_selftest.py`: **559 PASS, 0 FAIL**, "All checks passed" (including "All indicator checks
  passed" and check "R5conv"). Two earlier runs in the same hour each had one FAIL in the indicator reader's
  full-file probes (`{'error': ''}`, a subprocess reading a 90 MB file), a different check each time; `dmesg` shows
  the memory cgroup killing that python3 process, and `python3 scripts/indicator_selftest.py` then passed alone.
- `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run src/lib/__tests__ --pool=forks`
  (full library, real local PostgreSQL 16): **Test Files 9 failed, 366 passed, 2 skipped (377); Tests 1 failed,
  2857 passed, 92 skipped (2950).** All 9 are timeouts under load: 8 files failed in `beforeAll` with "Hook timed out
  in 10000ms" while creating their disposable database (codebookWordingLinksPre0125, codedPassageSnapshot,
  crosstabConcurrentSave, decisionRefreshReconciliation, documentOpen, findingWording, objectiveRereadSuggestions,
  objectiveValidationDuplicates; their tests were therefore skipped, not passed) and 1 test timed out at the default
  5 s (tenantIsolationCheck "no DATABASE_URL anywhere ...", 5464 ms). Rerun of those 9 files together: 8 passed, 44
  tests passed, 4 skipped, tenantIsolationCheck again 5502 ms; that file alone: 6 passed, 1 skipped (the test 4447
  ms). None of the 9 touches this change. Two earlier full runs are not counted: one was killed by a signal from
  outside (exit 144), the other hit "No space left on device" and PostgreSQL "in recovery mode" (81 suites failed
  in setup).
- The four conversion files alone (`npx vitest run src/lib/__tests__/trackerConversion src/lib/__tests__/conversionView --pool=forks`
  with the same `TEST_DATABASE_URL`): **4 files, 29 tests passed** (db 6, Codex 6, pure 14, mounted 3).
- Production build: a copy of the tree built with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:39528
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=local-stand-in SUPABASE_SECRET_KEY=local-stand-in DATABASE_URL=<disposable
  migrated database> DEFAULT_TENANT_ID=<its tenant> NEXT_FONT_GOOGLE_MOCKED_RESPONSES=$PWD/scripts/e2e/font-mock.cjs npx next build --webpack`
  (exit 0), served by `E2E_ADMIN_DATABASE_URL=postgres://postgres@localhost:55432/postgres E2E_NEXT_START=<build>
  E2E_STORAGE_PORT=39528 E2E_APP_PORT=3528 node scripts/e2e/local-stack.mjs`.
- `GOLDEN_SMOKE_TARGET_MANIFEST=e2e-results/target-manifest.json npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1 tracker-conversion`:
  **1 passed** (three separate runs, the last with `SHOT_DIR` for the screenshots).
- Same command with `tracker-dashboard.check`: **2 passed, 1 failed (3 tests).** "CSM tiles ..." and "CSM by company
  and against the previous wave" passed in each of the two later runs (in the first run, under the heaviest load,
  every test of the file timed out opening the start page). "tracker dashboard: change against the previous wave,
  choices applied and kept" **did not pass** in seven attempts; it failed each time before opening the dashboard, at
  different steps of creating the project and importing and labelling the two waves (the start page, the upload wait
  of 5 min, the source list twice at 60 s, the wave field enabled at 2 min, and twice "page.reload: Page crashed"). `dmesg` shows the memory cgroup killing the browser
  (`headless_shell`) at the time of a crash. This branch changes nothing in import or setup, and the part of this
  test that reaches the funnel card was not reached; **unresolved here: it needs a run on a machine that is not
  memory-starved** (it opens two waves and reloads repeatedly).
- Not run: the full browser suite (`npx playwright test -c e2e/ui/ui-check.config.mjs` without filters) and the
  smoke test (`npx playwright test`); with the out-of-memory kills above a full run would not have been evidence.

## Screenshots (1440 x 900, production build, BMW wave 1, BMW as the client's brand)

- `docs/screenshots/r5conv/funnel-1440x900.png`: the funnel card on Funnel (default), the switch above the rows.
- `docs/screenshots/r5conv/conversion-1440x900.png`: the same page on Conversion (top of the page).
- `docs/screenshots/r5conv/conversion-charts-1440x900.png`: the page scrolled to the card, three ranked charts with
  headlines, BMW marked.
- `docs/screenshots/r5conv/conversion-card.png`: the card alone (element capture; the area below the visible part of
  the dialog renders blank).
- `docs/screenshots/r5conv/conversion-table.png`: the card with the table open and BMW's bar focused.

## Files

- New: `src/lib/trackerConversion.ts`, `src/lib/trackerConversionDisplay.ts`, `src/lib/trackerConversionActions.ts`,
  `src/app/runs/[id]/ConversionView.tsx`; tests `src/lib/__tests__/trackerConversion.test.ts`,
  `src/lib/__tests__/trackerConversion.db.test.ts`, `src/lib/__tests__/trackerConversion.codex.db.test.ts`,
  `src/lib/__tests__/conversionView.test.tsx`, `src/lib/__tests__/helpers/conversion_reference.py`,
  `e2e/ui/tracker-conversion.check.mjs`; `fixtures/tracker-packs/bmw_car/independent/codex-bmw-reference-2026-10-30.json`
  (Codex's file, unchanged); screenshots under `docs/screenshots/r5conv/`; this handover.
- Changed: `src/app/runs/[id]/TrackerDashboardPanel.tsx` (page 01 funnel card only), `api/parse-stats-file.py`
  (`prop_row`), `scripts/crosstab_selftest.py`, `claude/d2-design-2026-10-29.md` (D3h), `claude/rules-registry.md`.
  `docs/current-engineering-status.md` not edited in this session.
- Callers checked: every caller of `computeCrosstab` reaches the `prop_row` cap; it changes only a share computed above
  1 (to exactly 1), so no figure that was valid before changes beyond the last bit. The other tracker pages' loaders
  are untouched; `trackerDashboardActions.ts` is untouched (the action is in its own file).

## Mocks versus real

Real: PostgreSQL (disposable database per test file on a local PostgreSQL 16), the Python engine, the recogniser and
dashboard choices, the codebook link, the browser stack (production build, disposable database and login role,
storage and auth stand-ins, model replay). Mocked: storage (in-memory) and the model (never called) in the database
tests; the server action in the mounted tests.

## Limits

- The SPSS reader alone does not group a per-brand yes/no variable that holds a third code (a don't know) into its stage
  question, so that brand has no variable at that stage and its conversion is n/a with the reason. With a codebook's
  question sets it is grouped, and the don't know is outside the base as specified. Existing recogniser behaviour, not
  changed here.
- No change against the previous wave, no significance and no comparison between brands are computed. The figure is not
  yet a finding or part of an export.
- Trial is in no chain; first choice to usage is not a step.
- The effective base is reported for the file, not per conversion base.
- The NET column's cap has no selftest of its own (the conversion view uses no banner); it is the same expression as
  the column's.
- While the card is back on Funnel, a reload of the dashboard recalculates the hidden conversion (about 40 tables).
