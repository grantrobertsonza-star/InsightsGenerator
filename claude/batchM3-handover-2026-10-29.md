# Batch M3 handover: brand dashboard page 03, Brand associations (29 October 2026)

Status: **implemented, ready for independent review.** Tier A (trackerFigures.ts, trackerAssociations.ts,
trackerDashboardActions.ts) with a tier B screen (TrackerDashboardPanel.tsx). Branch `assoc`, worktree b101.

## What changed

- The brand dashboard's left menu: "Brand associations" is now a button (pages 01 to 03 built); Brand overview stays
  the default page; Advertising & WOM, Audience & media and Category overview stay greyed "Coming next" (not
  buttons). Below the `lg` width the three built pages are tabs above the page.
- Page 03 (Grant's design): heading "Brand associations", "Compare what aware respondents associate with each
  brand.", the same chips row as pages 01 and 02 (Brand, Wave, Compare, Weighting, Segment). One card "Association
  profile", subtitle "Pick-any associations. Each brand uses its own awareness base; these are not agreement scores."
  plus the weighting. A dot plot: one row per attribute in the grid's order (Reliable, Affordable to run, ...), x axis
  0% to 80% (to the next 20 above the highest figure shown if one is higher), one dot per plotted brand (the client's
  brand larger and blue, the brands compared from the Compare chip in their own colours), a legend, the client's
  brand's value printed at the right. The reasons for any n/a among the plotted brands are listed under the plot.
  Footnote: "Aware bases: BMW 831 | ... Positioning model appears only when a supported analysis has completed."
- Figures: `loadBrandAssociations` (new, src/lib/trackerAssociations.ts) and `loadBrandAssociationsAction`. Nothing
  saved. `selectedAnswerOf` (trackerFigures.ts) is the reading of `selectedShareOf` with the selected code and its
  unweighted count also returned; `selectedShareOf` now returns its result unchanged (trackerFigures.db.test.ts,
  trackerD3aRepairs.test.ts and trackerMoments*.test.ts pass unchanged).

## Figure contract

In `claude/d2-design-2026-10-29.md`, "D3d Brand associations", and a registry row in `claude/rules-registry.md`.

- **Association share of brand X for attribute A** = weighted count of respondents aware of X who selected A for X
  (e.g. `attr_a01_b08`, selected code by `selectedCode`) / weighted count of respondents aware of X with a valid
  answer to A for X. x 100, unrounded.
- **Aware of X**: X's variable in the question the dashboard maps as awareness (`overviewMeasures`, the same choice as
  page 01's awareness tile) equals that variable's selected code. Each brand has its own base.
- **Don't know** stays in the base (pack spec I1 and the Associations row: "DK kept in base"): the pack's
  per-attribute flag `attr_dk_aXX` leaves 0 in the aware cells, so those respondents count as not associating; a
  code of the association variable itself labelled don't know is kept in the base as not selected (`excludeDk:
  false`). A blank (unaware respondents in the pack) or a declared missing value is outside the base.
- **Weight**: the dashboard's (on by default when the file has one); the file's survey design is passed.
- **Reported**: per brand the aware base (unweighted count aware) and, weighted, the Kish effective base of the aware;
  per cell the unweighted count of valid answers among the aware.
- **Computation**: one `computeCrosstab` (not saved) of every listed brand's awareness variable (aware code and count
  per brand, by `selectedAnswerOf`), then one `computeCrosstab` per brand of its association variables restricted to
  its aware respondents by an engine filter on the raw awareness code (`between` the code and itself, never by label);
  every cell read by `selectedShareOf`. At most four brand tables at once. BMW wave 1: 11 engine requests, the page
  loaded in 2.7 to 5.3 seconds in the database test (measured as the test durations, not a performance claim).

## Impact checklist

1. **Rule:** new rule, registry row added (owners `loadBrandAssociations`, `associationParts`,
   `awareBasesFromResult`, `associationCellsFromResult`, `selectedAnswerOf`, `selectedShareOf`, `overviewMeasures`,
   `computeCrosstab`). Uses the existing owners: the recogniser's associations grid (`recogniseTracker`),
   `overviewMeasures` (which question is awareness), `selectedCode` / `selectedShareOf` (selected answer by code),
   `computeCrosstab` (engine, filters by raw value), `resolveDashboard` (weight). No second share reader.
2. **Inputs:** no associations grid, or no brand list: "Not measured" with the reason. No question mapped as
   awareness, or two claiming it: "Mapping needed" (the base cannot be defined), never all respondents. Awareness not
   asked about a brand, its aware code not told or not numeric: that brand's base and cells n/a with the reason.
   Nobody aware: cells n/a of base 0. Attribute not asked about a brand, suppressed share, selected code not told:
   that cell n/a with the reason. A file whose dictionary, set-up or table cannot be read rejects with the reason (the
   page shows the error and "Try again").
3. **Persistence:** none. The page reads only; no table, finding or choice is saved (the test counts
   `document_tables`). The Compare selection is screen state, as on pages 01 and 02.
4. **Freshness:** no stored derived result depends on this page; nothing to mark stale. Page 03 reloads whenever the
   dashboard reloads (after a saved choice such as weighting or the awareness question).
5. **Screens:** page 03 loads only when shown; its own request counter drops a late answer (after a reload, a file
   switch or closing); a reload of the dashboard resets it to load again. No "saved" state on this page.
6. **Proof:** below.

## Checks run (worktree /home/claude/b101)

- `npx next typegen`: ok. `npx tsc --noEmit`: 0 errors.
- `npx eslint src e2e --quiet`: 0 errors (exit 0, no output).
- `python3 scripts/crosstab_selftest.py`: "All checks passed" (551 PASS lines, 0 FAIL).
- `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false npx vitest run src/lib/__tests__/trackerAssociations.test.ts src/lib/__tests__/trackerAssociations.db.test.ts src/lib/__tests__/trackerRoles.test.ts src/lib/__tests__/trackerFigures.db.test.ts src/lib/__tests__/trackerMoments.test.ts src/lib/__tests__/trackerMoments.db.test.ts src/lib/__tests__/trackerInput.db.test.ts src/lib/__tests__/trackerD3aRepairs.test.ts --pool=forks`:
  8 files, 100 tests passed, 0 failed (trackerAssociations.test.ts 10, trackerAssociations.db.test.ts 5,
  trackerRoles 39, trackerMoments 15, trackerMoments.db 5, trackerFigures.db 6, trackerD3aRepairs 18,
  trackerInput.db 2). trackerD3aRepairs.test.ts was added to the list because it exercises `sharesFromResult`, which
  now goes through `selectedAnswerOf`.
- **Failing without the change:** with the aware filter removed (`filters: []`, i.e. every respondent with an answer
  as the base), trackerAssociations.db.test.ts had 2 of 5 tests failing: the boundary test (`attr_a01_b08: expected
  35.4996 to be close to 30.1977`, the four unaware respondents' answers counted) and the BMW weighted test (aware
  effective base 961.8, the whole file, instead of below 831). The BMW cells themselves pass without the filter
  because the pack leaves unaware respondents blank; that is why the boundary file gives unaware respondents answers.
  Restored and rerun: 5 of 5 pass.
- Not run: the full vitest library, the browser suites (no playwright, as instructed).

## Reference values

`src/lib/__tests__/helpers/association_reference.py` computes every share with pandas from the same file, written
from the pack's specification (aware_bYY == 1 as the base, attr_aXX_bYY, code 1 selected, `weight`), not from the
app. BMW wave 1 (SPSS, 1,000 respondents): all 100 cells (10 attributes x 10 brands), their bases and every brand's
aware base equal the reference to 1e-6, weighted and unweighted. BMW's ten values also equal the pack's own
published table (claude/tracker-packs-role-spec-2026-10-28.md, section 4.2, wave 1) to two decimals: unweighted
36.22, 35.38, 36.82, 32.73, 35.86, 62.58, 66.06, 65.10, 34.18, 36.46; weighted 36.79, 34.66, 36.36, 32.38, 36.00,
62.73, 66.05, 65.00, 34.43, 35.68; aware base 831. (The reference script on wave 2 also gives the published wave 2
values and base 850; wave 2 is not in the database test.) Boundary CSV (first 60 respondents with metadata.json):
four respondents not aware of BMW given BMW associations are not counted (BMW aware base 49); three aware
respondents set to don't know for Reliable stay in the base (Reliable base 49); two blanks for Affordable to run
leave that cell's base only (47); every cell of every brand equals the reference.

## Mocks versus real

Real: disposable PostgreSQL, the Python engine (computeCrosstab, filters, value labels), the codebook import and
linking, the dashboard choices (saveTrackerChoices for unweighted and for awareness unmapped). Mocked: storage
(in-memory), request context, `next/cache`, `next/server`, API usage logging, the model (throws if called). Unit
tests use hand-built Cross tab results for the pure helpers.

## Files

- `src/lib/trackerFigures.ts` (selectedAnswerOf; selectedShareOf reads through it)
- `src/lib/trackerAssociations.ts` (new: loadBrandAssociations, associationParts, awareBasesFromResult,
  associationCellsFromResult)
- `src/lib/trackerDashboardActions.ts` (loadBrandAssociationsAction)
- `src/app/runs/[id]/TrackerDashboardPanel.tsx` (menu, page 03, narrow tabs)
- Tests: `src/lib/__tests__/trackerAssociations.test.ts`, `src/lib/__tests__/trackerAssociations.db.test.ts`,
  `src/lib/__tests__/helpers/association_reference.py`, `e2e/ui/tracker-associations.check.mjs` (written, not run),
  `e2e/ui/tracker-moments.check.mjs` (its "Coming next" assertion moved from Brand associations to Advertising & WOM,
  since page 03 is now a button; not run)
- Docs: `claude/d2-design-2026-10-29.md` (D3d), `claude/rules-registry.md`, this handover

Callers checked: `selectedShareOf` is used by `sharesFromResult` (brand overview) and `momentsFromResult` (page 02);
its output is unchanged. `overviewMeasures` is used unchanged. The new action is used only by the panel.

## Limits

- No competitor average or gap (the plan's "competitor average and gap"), no change against the previous wave, no
  significance and no positioning map on this page; the Segment chip is "All eligible" only.
- The "reach" metric (associations among all eligible, pack `attribute_all`) is not shown.
- An awareness answer stored as text (no numeric code) gives n/a for that brand: the engine filter selects by numeric
  value. Files with numeric codes (all packs tried) are not affected.
- A file that codes don't know as blanks (the Oldtracker rule in the pack spec) leaves those respondents outside the
  base, because blanks are outside every base; the page cannot tell such a file apart.
- One engine request per brand (plus one): a file with many brands takes longer to open the page.
- The Compare selection and the dot colours are screen state, not saved.
- Not run: full vitest library, browser suites, the new browser check; there is no screenshot from this batch.
