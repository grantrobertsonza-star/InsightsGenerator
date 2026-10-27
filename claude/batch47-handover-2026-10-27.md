# Batch 47 handover: column tests, non-answer labels, quick charts, AI reading (27 October 2026)

Base: Batch 46R. Status: implemented, ready for review. Tier A. No migrations. Contracts:
`claude/table-method.md` (new), `claude/answer-domain.md`, `claude/crosstab-ai-reading.md`; registry rows
added. From Grant's questions of 27 October: a 0% cell flagged lower, "No clear pattern" from AI Insights,
a "DontKnow" banner column with non-answers excluded, and a chart for the first table only.

## What changed

1. **Pooled column test.** Shares are compared (column against the rest, and column pairs for letters)
   with a two-proportion z-test pooled under the null hypothesis on effective bases. The unpooled variance
   is zero at 0% or 100%, so 0 of 53 against 11 of 947 was flagged lower at p = 0.0008; pooled p = 0.430
   (Fisher's exact p = 1.0). Under a survey design the linearised variance is unchanged; a cell or pair at
   0% or 100% has none, so it is left untested and counted in the notes ("About these tests").
2. **Run-together non-answer labels.** `_DK_RE` accepts words run together or joined by "_" or "-"
   ("DontKnow", "Not_applicable", "NoAnswer") and "prefer not to say/answer". They leave bases and banners
   when non-answers are excluded. Ordinary words ("Donations", "Nature") are still answers.
3. **Table method version and freshness.** Every table records `notes.methodVersion` (engine
   `TABLE_METHOD = "2026.10.27"`, equal to `CURRENT_TABLE_METHOD`, checked by a test). A table with another
   or no version shows "earlier method" in Cross tabs; its findings say "Table built with an earlier
   method"; insights, pre-insights, recommendations and narratives resting on them read "Support changed
   since drafted" (reason `method_changed`), on screen and in exports. Nothing is recalculated; wording and
   decisions are kept; rebuilding the table clears it.
4. **Quick charts for every question.** The chart button draws one chart per single or multiple response
   question, in table order; others are named. "Charts only" hides the figures table (kept in the page).
5. **AI reading.** Each question carries its whole-table test (chi-square p, Cramer's V, 95% verdict) and,
   for a coded question, the mean and spread of its codes; the prompt says a question can differ overall
   with no cell marked. A reading with a headline and no cards is refused.

## Impact checklist

1. Rules: column tests (`_pooled_prop_se`, new row), answer domain (`_DK_RE`, owner), table method (new
   row and contract), support status (`supportStatusShared`, owner, new reason), AI reading
   (`crosstabInsights.ts`, owner). `descriptiveFindings.ts` `DK` is a drifting copy of `_DK_RE` (wording of
   level findings only), recorded in the registry, not changed here.
2. Inputs: a table without a method version is "earlier", never "current". A finding without a calculated
   table is never judged on method. The method reason is read from the table itself, so it is reported
   even when the data file's settings cannot be resolved (alongside "could not be checked").
3. Persistence: none changed; the version is part of the stored table.
4. Freshness: as item 3. Every table built before 27 October is marked, including ones a rebuild would
   not change; the record cannot tell those apart (stated in the contract).
5. Screens: the chart and charts-only switches are display state; no saving involved.
6. Proof: see Gates. Each repair's checks were shown failing on the code before it:
   selftest 0 of 53 (3 checks), run-together labels (3 checks); `supportStatus.test.ts` (2 cases);
   `crosstabInsights.test.ts` (2 cases).

## Tests that named the old test

The golden reference (`fixtures/golden-thread-1`) was always computed with the pooled test; the engine
was compared with it only "in conclusion, within a factor of 2" because the methods differed. With the
same method the comparison is now tight (`goldenReferenceFixtures.test.ts`: p equal within the engine's
rounding to 4 places, |z| within 0.005), which the unpooled engine fails (Purchase z 2.886 against 2.828).
The table-notes expectations in that test and in `journey-exports.check.mjs` name the pooled test. A
support fixture (`supportNetInputs.db.test.ts`) records the current method, and the mounted findings card
test mocks the new module. Why the tests missed the 0% flag: no reference case had a 0% cell, and the
golden comparison allowed the unpooled form.

## Files

Engine `api/parse-stats-file.py`; selftest `scripts/crosstab_selftest.py`; `src/lib/tableMethod.ts` (new),
`crosstabs.ts`, `supportStatus.ts`, `supportStatusShared.ts`, `crosstabInsights.ts`, `parseStatsFile.ts`;
screens `CrosstabWorkspace.tsx`, `CrosstabExtras.tsx`, `FindingsTable.tsx`, `page.tsx`; tests
`tableMethod.test.ts` (new), `supportStatus.test.ts`, `crosstabInsights.test.ts`; browser check
`e2e/ui/quick-charts.check.mjs` (new); contracts and registry.

## Gates

Batches 46R, 47 and 48 form one stack; the full gates ran on its top (Batch 48, worktree `83eab93`):

- `npx tsc --noEmit` passed; `npx eslint src e2e --quiet` 0 errors; `python3 scripts/crosstab_selftest.py`
  all checks passed (with the batch 47 and 48 reference cases).
- `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: 260 files, 1,923 passed, 82 skipped.
- `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`: 126 passed, 1 skipped, 1 failed
  (`mean-tick`); `npx playwright test` (smoke) 1 passed. Targeted: `quick-charts`, `journey-exports`,
  `starter-banners`, `reversed-items` passed.
- The `mean-tick` failure was the new check, not the app: the screen now names a mean row's measure "Mean",
  so the row's text reads "Mean" twice with no gap and the check's pattern ("Mean" then a word break) no
  longer matched. The pattern is corrected (commit `2c83958`, the check only); on the same stack:
  2 of 2 passed (`--repeat-each=2`).
- Real infrastructure: disposable PostgreSQL 16 and the local stack; the model replayed from recorded
  fixtures; storage the local disposable store. Nothing ran against cloud Supabase.

Batch 47's own first full run (worktree `e23863b`, before the test updates): library 6 failures in 3 files
and one browser failure (`journey-exports`), all tests that still expected the unpooled test or a table
without a method version. Updated as described above; the eight affected files then passed on their own
(43 passed, 2 skipped), and in the top-of-stack run.

## Limits

Means and scores keep their difference-of-means test. The pooled test does not make a 0% cell against a
genuinely large share untestable: 0 of 200 against 60 of 800 is still flagged, as it should be.
