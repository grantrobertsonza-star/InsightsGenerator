# Batch M2 handover: brand dashboard page 02, Moments & needs (29 October 2026)

Status: **implemented, ready for independent review.** Tier A (trackerRoles.ts, trackerFigures.ts, trackerMoments.ts,
trackerDashboardActions.ts) with a tier B screen (TrackerDashboardPanel.tsx). Branch `moments`, worktree b98.

## What changed

- The brand dashboard's left menu: "Moments & needs" is now a button; Brand overview stays the default page; the
  other four pages stay greyed "Coming next" (not buttons). Below the `lg` width, where the menu is hidden, the two
  built pages are tabs above the page.
- Page 02 (Grant's design): heading "Moments & needs", the same chips row as page 01 (Brand, Wave, Compare,
  Weighting, Segment). Left card "Category moments" (personal relevance, multiple response, n and weighting stated):
  every moment ranked by share. Right card "Moment x brand recall" (cue-specific recall, not personal relevance, all
  eligible, n stated): the six most relevant moments as rows, the client's brand then the compared brands as columns
  (the Compare chip's selection, shared with page 01), cells shaded darker for higher recall relative to the highest
  cell shown, and the footnote "Six moments selected by highest category relevance. Darker blue = greater
  cue-specific brand recall; no statistical comparison implied."
- Recognition: `findCategoryMoments` (trackerRoles.ts) finds the category relevance question beside the moments grid
  by the same moment wording, and `recogniseTracker` returns it as `categoryMoments` (found, ambiguous, not_found).
- Figures: `loadBrandMoments` (new, trackerMoments.ts) and `loadBrandMomentsAction`; one Cross tab through
  `computeCrosstab`, nothing saved. The reading of a yes/no share was moved out of `sharesFromResult` into
  `selectedShareOf` (trackerFigures.ts) so the funnel and this page use one reading; behaviour of `sharesFromResult`
  is unchanged (trackerFigures.db.test.ts and trackerD3aRepairs.test.ts pass unchanged).

## Figure contracts

In `claude/d2-design-2026-10-29.md`, "D3c Moments & needs", and a registry row in `claude/rules-registry.md`.
- **Category relevance of a moment:** numerator the weighted count selecting the moment's option (selected code by
  `selectedCode`); denominator the weighted count with a valid answer to that option; eligible population everyone
  asked (all 1,000 in the BMW pack); weight the dashboard's (on by default when the file has a weight); a blank or
  declared missing value leaves that moment's base only; **"None of these" respondents stay in the base** (they hold 0
  on every moment); the None option is never ranked.
- **Moment x brand recall:** numerator the weighted count whose link for that brand and moment (`cep_cXX_bYY`) is
  selected; denominator the weighted count with a valid answer to that link (all eligible in an all-asked grid);
  same weighting and missing-data rule; no comparison between cells is tested.
- Base shown is the unweighted count of valid answers; Kish effective base of the file when weighted.

## Impact checklist

1. **Rule:** new rule, registry row added (owners `findCategoryMoments`, `loadBrandMoments`, `momentsFromResult`,
   `selectedShareOf`, `computeCrosstab`). Uses the existing owners: `computeCrosstab` (engine), `selectedCode`
   (selected answer by code), `resolveDashboard` (weight), `loadRoleInput` (recogniser input). No second share reader.
2. **Inputs:** relevance question not found: left card "Not measured" with the reason; two candidate lists:
   "Mapping needed"; no moments grid or no brand list: right card "Not measured"; relevance unavailable: right card
   "Mapping needed" (its rows are chosen by relevance). A share whose selected code cannot be told, or suppressed, is
   "n/a" with the reason and is never ranked as 0. A file whose dictionary, set-up or data cannot be read rejects with
   the reason (page shows the error and "Try again"), never an empty page. Variable names alone never identify the
   relevance question (unit test: a list named `relevant_c01..` with other wording is not_found).
3. **Persistence:** none. The page reads only; no table, finding or choice is saved (test counts `document_tables`).
   The Compare selection is screen state, as on page 01.
4. **Freshness:** no stored derived result depends on this page; nothing to mark stale. Page 02 is reloaded whenever
   the dashboard reloads (after a saved choice such as weighting).
5. **Screens:** page 02 loads only when shown; a request counter drops a late answer (after a reload, a file switch or
   closing); a reload of the dashboard resets page 02 to load again, so weighting changes reach it. No "saved" state
   on this page.
6. **Proof:** below.

## Checks run (worktree /home/claude/b98)

- `npx next typegen`: ok. `npx tsc --noEmit`: 0 errors.
- `npx eslint src e2e --quiet`: 1 error, 0 in files of this batch: `src/lib/__tests__/keptOpenWorkspace.test.tsx:32` (react-hooks/globals, `setter` reassigned during render), a file this batch does not touch (last changed in adc417c). Left for its owner; the files of this batch lint clean.
- `python3 scripts/crosstab_selftest.py`: "All checks passed" (551 PASS lines, 0 FAIL).
- `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false npx vitest run src/lib/__tests__/trackerMoments.test.ts src/lib/__tests__/trackerMoments.db.test.ts src/lib/__tests__/trackerRoles.test.ts src/lib/__tests__/trackerRolesRaw.test.ts src/lib/__tests__/trackerD3aRepairs.test.ts src/lib/__tests__/trackerNoFigures.test.ts src/lib/__tests__/trackerDashboard.test.ts src/lib/__tests__/trackerFigures.db.test.ts src/lib/__tests__/trackerInput.db.test.ts --pool=forks`:
  9 files, 131 tests passed, 0 failed (trackerMoments.test.ts 15, trackerMoments.db.test.ts 5, and the existing
  tracker files touched by the changes in trackerRoles.ts and trackerFigures.ts).
- **Failing without the change:** with `findCategoryMoments` replaced by a constant "not_found", trackerMoments.db.test.ts
  had 4 of 5 tests failing (only the "unknown" test passed, as it should). Before the label-prefix rule (a label
  "relevant_c01. Replacing an unreliable car" from a CSV with a linked codebook), the boundary test failed with "No
  yes/no list asked once (about no brand) names the same moments as the brand recall question"; the rule and a unit
  test for it were added.
- Not run: the full vitest library, the browser suites. `e2e/ui/tracker-moments.check.mjs` is written but **not run**
  (another process was using the stack), so there is no screenshot from this batch.

## Reference values

`src/lib/__tests__/helpers/moment_reference.py` computes each share with pandas from the same file, written from the
pack's specification (relevant_c01..c12, cep_cXX_bYY, code 1 selected, `weight`), not from the app. BMW wave 1 (SPSS,
1,000 respondents): all 12 relevance shares and all 60 shown recall cells (six moments x ten brands) equal the
reference to 1e-6, weighted and unweighted; bases 1,000; the six rows are the reference's top six (weighted: c02, c06,
c11, c04, c05, c01, i.e. Reducing fuel and running costs 72.50%, Feeling safer on the road 72.12%, Staying within a
fixed monthly budget 70.35%, Making the daily commute easier 69.44%, Taking long-distance family trips 64.68%,
Replacing an unreliable car 64.35%). Boundary CSV (first 60 respondents, five set to "No relevant situation", three
with relevant_c02 blank): every moment's share and base equal the reference (relevant_c01 base 60, relevant_c02 base
57). The repository's pack copy has no CEP rows of the pack's `reference_results.json`, so the pack's own published
moment values were not compared.

## Mocks versus real

Real: disposable PostgreSQL, the Python engine (computeCrosstab, value labels), the codebook import and linking.
Mocked: storage (in-memory), request context, `next/cache`, `next/server`, API usage logging, the model (throws if
called).

## Files

- `src/lib/trackerRoles.ts` (CategoryMoments, findCategoryMoments, `categoryMoments` in the recognition)
- `src/lib/trackerFigures.ts` (selectedShareOf, used by sharesFromResult)
- `src/lib/trackerMoments.ts` (new: loadBrandMoments, momentsFromResult, momentVariables)
- `src/lib/trackerDashboardActions.ts` (loadBrandMomentsAction)
- `src/app/runs/[id]/TrackerDashboardPanel.tsx` (menu, page 02, shared chips row and Compare picker, narrow tabs)
- Tests: `src/lib/__tests__/trackerMoments.test.ts`, `src/lib/__tests__/trackerMoments.db.test.ts`,
  `src/lib/__tests__/helpers/moment_reference.py`, `e2e/ui/tracker-moments.check.mjs`
- Docs: `claude/d2-design-2026-10-29.md` (D3c), `claude/rules-registry.md`, `claude/tracker-roles.md` (rule 5)

Callers checked: `recogniseTracker` is used by `loadTrackerDashboard` (and through it the overview) and the tests;
the new field is additive. `sharesFromResult` is used by `brandOverviewFigures` only.

## Limits

- No screen to choose the relevance question by hand when it is ambiguous or not found ("Mapping needed" says why
  but offers no choice yet). The Compare selection is not saved (as on page 01).
- The moment link is by wording; a relevance question worded differently from the recall question is not found.
- A recall grid whose labels say "Associated" rather than "Selected" (coffee synthetic 03) gives "n/a" cells:
  `selectedCode` does not read "associated" as selected. Left as is: changing that word list is a change to the
  funnel's rule too and needs its own decision.
- No change against the previous wave and no significance on this page; the Segment chip is "All eligible" only.
- Ehrenberg-Bass measures (mental market share, penetration, network size, fingerprint) are not part of this page.
- Not run: full vitest library, browser suites, the new browser check.
