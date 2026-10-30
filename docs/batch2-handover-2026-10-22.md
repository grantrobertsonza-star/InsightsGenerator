# Handover: M-BATCH-01, sidebar roll-up and 10 point scales (main copy), 22 October 2026

Status: **implemented, ready for independent review.** Main copy only; 3001 out of scope. Follows
`docs/independent-design-batch-review-main-2026-10-22.md` (frozen `cbfb4df`), whose accepted
closures stand. Nothing pushed or deployed; no development or live database touched; **no
migration**.

| Commit | What | Kind |
|---|---|---|
| `f8f0420` | M-BATCH-01: `claude/research-quality-presentation.md`, the Research quality presentation contract | documentation |
| `1f220a6` | Sidebar: each group rolls up from its heading (Grant, 15:04) | design |
| `9a03ad7` | 10 point scales (Grant, 15:06): StarterTabs adds a mean row above the answers of a 10 or 11 point numeric question; the engine reads an unlabelled numeric column's own whole-number codes as a numbered scale (10 or more distinct values) | correctness, statistics |

## M-BATCH-01

`claude/research-quality-presentation.md` states: the ring and category scores are the stored
whole-review figures and are never recalculated by the Show filter; the filter's choices
(`criterionRows`, `statusChoices`, order and unknown-last rule) and its predicate
(`filterDimensionsByStatus`, category heading kept beside matching criteria, keyed by criterion id);
Pending, Failed and Not rated as states, never bands (`criterionStatus`); Improvements grouping
(`improvementsByTiming`) and figures (`criterionRating`); selection and scoping (opening another
review clears the selection and resets the filter; a review shows only with its document; switching
tabs keeps the selection); failed-step listing; tests and limits. No code change.

## Sidebar roll-up

`RunShell.tsx`: each group heading is a button (`aria-expanded`, `aria-controls`, Enter or click).
Folded groups are remembered per browser (`run-nav-folded:v1`, guarded reads and writes, applied after
the first render so server and client agree). A folded group still lists the open section. The
collapsed icon rail is unchanged. Check: `e2e/ui/sidebar.check.mjs` step 5 (fold, open section kept,
reload, keyboard, unfold).

## 10 point scales

- Cause found while building: `_is_ordered_scale` (engine) judged a column by its value labels only;
  a spreadsheet's unlabelled 0 to 10 rating has none, so it was "not ordered": no default mean and
  spread, and a requested mean labelled "mean of the answer codes, which may not be in order".
  Now, with no value labels, whole-number codes with 10 or more distinct values are a numbered scale
  by the existing `_is_numbered_scale` rule (`raw` passed at both call sites). Fewer distinct codes,
  non-integer codes, a declared nominal level and labelled columns are unchanged. Effect beyond
  StarterTabs: such columns now get the default mean and spread in every crosstab, as a labelled
  "0".."10" list already did.
- `src/lib/meanRow.ts` (new): `meanGroupFor` moved here from `crosstabAsk.ts` (re-exported there) so
  client code can use it without the model client; `isTenPointScale` (numeric, 10 or 11 distinct
  values). `planStarterTables` adds the mean row to such items and reports `meanScales`; the panel
  says how many.
- Tests: `starterMeanScaleEngine.test.ts` (actual engine: hand-computed 73 / 13, unqualified, above
  the answers, all eleven answers kept; a 5 point column gets none), `engineNumberedScaleMean.test.ts`
  (+1: unlabelled 0 to 10 has the default mean; unlabelled 1..9 and a 0 to 10 with only 7 values
  given do not), `starterTables.test.ts` (+1: 9, 10, 11, 12 distinct values). Previous-code control:
  the engine case fails on the previous engine (qualified label, no default mean).

## Checks run (cloud workspace, disposable PostgreSQL 16, real Python engine, production build, model replayed)

| Gate | Tree | Result |
|---|---|---|
| `npx tsc --noEmit -p .` | final | pass |
| Full library, `TEST_DATABASE_URL=… npx vitest run src/lib/__tests__ --pool=forks` | final | 1,454 passed, 69 skipped (192 files, 1 skipped) |
| Full native browser suite (`ui-check.config.mjs`, 1 worker, no filter) | final | 85 passed, 0 failed, 1 skipped |
| Golden-thread smoke; objective review acceptance | final | passed |
| `npx eslint` on changed files | | 0 errors added (RunShell's two existing set-state-in-effect errors unchanged) |

## Limits

- A rating scale is recognised by its count of distinct values; a 0 to 10 question with fewer than 10
  values given has no mean row and no default mean.
- An unlabelled numeric column with blanks shows its answers as "0.0" .. "10.0" (existing labelling).
- The sidebar fold is per browser; the collapsed icon rail does not fold.
