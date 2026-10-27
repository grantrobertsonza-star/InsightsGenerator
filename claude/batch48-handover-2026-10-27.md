# Batch 48 handover: the Mean tick (27 October 2026)

Base: Batch 46R2 (`be2d56ae`, on Batch 47). Status: implemented, ready for independent review. Tier A. No migrations. Contract:
`claude/mean-tick.md` (new); registry rows added. Grant: "add Mean to the Show in each cell list", a mean
row at the top of each rating-scale question, ticked by default.

## What changed

- Table settings, Cell display: "Mean", on by default, sent with CrossTabs and StarterTabs builds as the
  request's `meanRows` and saved with the table (`savedRequest.meanRows`, `provenance.meanRows`).
- Engine: with `meanRows: true`, each single choice question whose numeric codes form an ordered scale
  (`_is_ordered_scale`) gets a "Mean" row above its answers: the weighted mean of the codes, don't know and
  other non-answers left out, per column and in total, tested like any mean, with letters. A question with
  its own mean group gets no second one. Questions whose codes are not a scale get none and are named
  under the table (`notes.meanNotAdded`). Absent or false: as before; an older saved request rebuilds as
  it was.
- A built table with mean rows has a "Mean" tick (in "Show in each cell" in the stacked view): unticking
  hides them on screen, and the Excel, PowerPoint and PDF links carry `mean=0`, so the export route leaves
  them out of every format (`withoutMeanTickRows`). Defined mean groups are never hidden.
- Findings: a tested difference on a mean row is a finding, "The mean of <question> is higher for <group>
  (x) than overall (y)".
- Repair found while proving it: a question's candidate findings were ranked by gap across units (scale
  points against percentage points), so a tested mean or score difference almost never kept a place. Mean
  and score rows now rank first, then answers, each by its own gap. This applies to defined mean and score
  groups too.
- A mean or score row's measure is named "Mean" or "Net score (points)" on screen (it read "% within
  column"), as the Excel export already names it.
- The test footnote under a table names the pooled test for a table built with the current method, and
  says "shares not pooled (built with an earlier method)" otherwise.

## Impact checklist

1. Rules: new row "Mean row above rating-scale questions" (engine owner, `_is_ordered_scale` reused) and
   "Which candidate findings a question keeps" (`crosstabFindings`).
2. Inputs: a non-boolean `meanRows` is refused at `buildCrosstab` with nothing saved; a question that
   cannot be given a mean is named, never silently skipped.
3. Persistence: part of the saved table; no new store.
4. Freshness: none; tables built before keep their rows. More findings can come from a committed table
   (its mean rows), by design.
5. Screens: the display tick is per view; the build choice is saved with the table and survives reload.
6. Proof: selftest batch 48 cases (independent weighted means, placement, named question, off, no second
   mean); `meanTick.db.test.ts` (saved, provenance, off and legacy, invalid refused, commit makes the mean
   finding: fails without the ranking repair); `e2e/ui/mean-tick.check.mjs` (default on, hide and export
   links, reload).

## Files

Engine `api/parse-stats-file.py`, selftest; `src/lib/parseStatsFile.ts`, `crosstabs.ts`,
`crosstabActions.ts`, `crosstabMeanRows.ts` (new); screens `CrosstabOptions.tsx`, `CrosstabWorkspace.tsx`;
export route `api/runs/[id]/crosstab/export/route.ts`; tests `meanTick.db.test.ts` (new),
`e2e/ui/mean-tick.check.mjs` (new); contract and registry.

## Gates

Run on Batch 48's own code (worktree `9806b32`, on Batch 46R2; the code of this package):

- `npx tsc --noEmit` passed; `npx eslint src e2e --quiet` 0 errors; `python3 scripts/crosstab_selftest.py`
  all checks passed (with the batch 47 and 48 reference cases).
- `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: 260 files passed (1 skipped),
  1,925 passed, 82 skipped.
- `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`: 127 passed, 1 skipped, 0 failed
  (24.6 min); targeted `mean-tick`, `quick-charts`, `journey-exports`, `starter-banners`, `reversed-items`
  passed. `npx playwright test` (smoke): 1 passed.
- Real infrastructure: disposable PostgreSQL 16 and the local stack; the model replayed from recorded
  fixtures; storage the local disposable store. Nothing ran against cloud Supabase.

An earlier full run on the stack's top (`83eab93`) failed only the new `mean-tick` check, because the screen
now names a mean row's measure "Mean", so the row reads "Mean" twice with no gap and the check's word-break
pattern no longer matched; the pattern was corrected (check only) before the run above.

The check's first versions failed while it was written (a CSV 0 to 10 column is a number question in
StarterTabs; Cross tabs reopens on CrossTabs after a reload); the final check builds a labelled SPSS
scale. Screenshots: the Mean row at the top of Satisfaction (3.47, 3.11, 3.11; total 3.23) with Channel
named, and the table with Mean unticked.

## Limits

A rating scale stored as text answers gets no mean (named). Plain-English, assistant and objective tables
do not set the tick. The display tick is not remembered across page loads (the build choice is).
