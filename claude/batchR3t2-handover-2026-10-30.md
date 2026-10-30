# Batch R3t2: handover (30 October 2026)

Status: implemented, ready for independent review. Repairs Codex's independent T2 review
(`docs/independent-t2-review-2026-10-30.md`, held outside the repo), findings T2-F01 and T2-F02. Branch `r3t2`,
worktree b109, based on `16fe56e`. Commits: `dc451f6` (T2-F01 code and tests), `a0a0f3c` (T2-F02 code and tests),
then the docs commit carrying this file. Tier A (engine, calculation, AI prompt, stored tables).

## T2-F01: the driver performance measure comes from the declared answer domain

- **Before.** `driverPerformance.ts` chose the measure from the answers present (observed minimum, maximum, number
  of codes), even when the engine knew a larger declared answer list. A declared 1 to 5 scale answered only 4 and 5
  read as a mean with no top two; a declared 0 to 10 scale answered only 0 and 1 read as a 0/1 indicator with a 50%
  "share" instead of top two 0%. The same rule served the whole file and each segment. Stated importance had its
  own copy of the observed rule in `drivers.ts` (top two counted from the highest answer present), the same defect.
- **Change.**
  - Engine `driver_columns` (`api/parse-stats-file.py`, `describe`) returns `answerDomain` for the outcome and each
    predictor: `source` ("declared" or "observed"), `min`, `max`, `count`, `integers`. Declared: the declared
    substantive codes, non-answers left out by the answer-domain owner `_non_answer_codes` (the non-answer set is
    the one already used for the column's values; no new pattern), together with every observed answer. Observed:
    no answer list, so the answers present.
  - `driverPerformance.ts` reads the measure from that domain: every code 0 or 1 is an indicator (share);
    whole-number codes spanning 3 to 11 points are a scale (top two counted down from the domain's top, and the
    mean), where an observed domain also needs 3 or more different answers (as before); anything else is a mean.
    Every result now says `domainSource`, and a scale result `scaleMin` beside `scaleTop`. Without an engine domain
    (columns that did not come from `driver_columns`), `answerDomainOf` takes the observed answers and marks the
    result "observed".
  - A list that labels only the end points (0 "Not at all likely", 10 "Extremely likely") spans its range, so it is
    an eleven-point scale whatever is answered.
  - `performanceScales` compares scale lengths from the domain (`scaleTop - scaleMin`), so a sparse and a full
    declared 1 to 5 share one axis; means compare domain ranges.
  - Stated importance in `drivers.ts` now calls `predictorPerformance` for its top two (the removed copy is the
    drift named above).
- **Inputs.** No answers: mean and top two unknown (null), never 0. A non-answer code is never the scale top. A file
  with no answer list falls back to the observed answers and says so; that measure can change when new answers
  appear, which is the stated limit of an undeclared scale.
- **Persistence.** None new. A driver report is calculated when asked; saved driver analyses store the report as
  calculated.
- **Freshness.** Saved driver analyses calculated before keep their stored performance (no `domainSource`) until
  recalculated; nothing marks them stale. The importance against performance quadrants in Analytics and the CSM
  panel read `topTwo`, so for a sparse declared scale they now plot a top two where they plotted a mean or nothing
  (a sparse 0 to 10 predictor moves from an apparent 50% share to 0%). Posted driver findings and their exports
  carry importance, not performance, so their wording is unaffected.
- **Screens.** No screen code changed. The quadrants still choose top two or mean by count, not by
  `performanceScales`; the dedicated performance chart remains deferred (D5).
- **Codex's counterexamples.** His three assertions are permanent in `driverPerformance.test.ts` ("the measure
  comes from the declared answer domain"). His inputs gave only the declared top (`scaleTop`, `scaleStated`); that
  is not enough to know a sparse scale's lowest point, which is why the engine now carries the whole domain, and
  the permanent versions pass the domain as the engine emits it (pinned by the selftest's T2-F01 checks). The
  actual engine path is `driverPerformanceDomain.test.ts`.
- **Why earlier tests missed it.** Every D2b test fed answers that already covered the scale's lower end, so
  "observed" and "declared" never disagreed below the top.

## T2-F02: a document table runs on across three or more reading parts

- **Before.** `joinAcrossParts` compared the accumulated table's `sourcePage` with the previous part's last page.
  After joining pages 5 and 6 the table kept source page 5, so at page 11 the comparison was 5 against 10 and the
  third piece was stored as a second table.
- **Change.**
  - Each shaped table keeps `sourcePage` (the start page, the citation page, unchanged and what is stored) and
    separately `lastPage`, the last page it is known to reach, with `lastPageStated`.
  - The reading may now give `last_page_number` (new optional field in the `record_tables` schema, and one sentence
    in the instruction). It is used only when it is a page of the part after the start page; otherwise the reading
    notes say it was not used and the table ends on its own page.
  - A joined table carries the reach forward: the continuation's stated end, else, when the continuation is the
    only table read in its part, that part's last page (and a note says so if a later join relies on it), else its
    own page. So 1-5, 6-10, 11-15 (and more) join into one ordered table with every row and every "Continues on
    page N" note.
  - Unchanged: a title of its own or different columns starts a new table; a part read with no tables breaks the
    run; a table that does not reach its part's end is not joined. New: a table that starts mid-part and is said
    to reach the part's last page now joins the next part (before, only one starting on the last page could).
- **Failure and retry.** Unchanged and now pinned at the store: any part cut off, refused or answering without its
  list fails the whole read before anything is written, so the previous stored tables and notes stay; the retry
  stores the joined table under the same table id.
- **Persistence.** None new: `last_page_number` and `lastPage` are not stored (no migration). The table and its
  notes are written in the existing single transaction.
- **Freshness.** A document read before keeps its split tables until it is read again. A reread replaces table 0
  with the joined table but, by the existing rule of `extractAndStoreDocumentTables` (fewer tables leave the old
  extra rows in place so findings on them are not cascade-deleted), the old second piece stays stored as table 1,
  now duplicating rows that table 0 holds. Not changed here (it is the document deletion contract's choice); it
  needs a decision before such documents are reread.
- **Why earlier tests missed it.** The shipped join test had two parts only, so accumulated continuation state
  was never compared.

## Rule owners and contracts

- New registry row "Driver performance for importance against performance" (owner `driverPerformance.ts`, domain
  from engine `driver_columns` `answerDomain`, owner `_non_answer_codes`). There was no row before.
- Updated row "Tables read from a Word, PDF or PowerPoint document's pages" (any number of parts, start page kept,
  reach tracked separately) and its pinned tests.
- `claude/answer-domain.md`: section "Driver predictors carry their answer domain".

## Files

- `api/parse-stats-file.py` (`driver_columns` `describe`: `answerDomain`)
- `src/lib/driverPerformance.ts`, `src/lib/drivers.ts`
- `src/lib/documentTableShape.ts`, `src/lib/documentTables.ts` (instruction sentence and schema field)
- `scripts/crosstab_selftest.py` (3 T2-F01 checks)
- Tests: `src/lib/__tests__/driverPerformance.test.ts` (13), `driverPerformanceDomain.test.ts` (9, new),
  `documentTableShape.test.ts` (14), `documentTableContinuation.db.test.ts` (3, new)
- Docs: this file, `claude/rules-registry.md`, `claude/answer-domain.md`
- Callers checked: `runDriverAnalysisFor` (file, segments, stated importance), the quadrants in
  `AnalyticsBuilder.tsx` and `CsmAnalyticsPanel.tsx` (read `topTwo`, unchanged code), `detectTablesAcrossPages` and
  `extractAndStoreDocumentTables`, conformance L4 `documents.test.ts` B-03.

## Proof (fails without, passes with)

- T2-F01, engine change in, TypeScript change reverted: `driverPerformanceDomain.test.ts` 7 failed, 1 passed (of 8
  then; the stated importance case was added after). Both changes reverted: `driverPerformanceDomain.test.ts` plus
  `driverPerformance.test.ts` 18 failed, 4 passed (22). Engine change reverted: selftest's 3 T2-F01 checks FAIL.
  With the change: 22 of 22 and the selftest's checks pass.
- T2-F02, both files reverted to `16fe56e`: `documentTableShape.test.ts` plus `documentTableContinuation.db.test.ts`
  7 failed, 10 passed (17), including Codex's counterexample and the real-database three-part store. The
  incomplete-part and retry cases pass either way (they guard the failure path, which was already right).
  With the change: 17 of 17.

## Gates (worktree b109)

- `npx next typegen`, then `npx tsc --noEmit`: exit 0.
- `npx eslint .`: 0 errors, 52 warnings (none new; `documentTables.ts` `setCell` unused was already there).
- `python3 scripts/crosstab_selftest.py`: exit 0, 558 PASS, 0 FAIL, "All checks passed".
- `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run src/lib/__tests__ --pool=forks`:
  367 files: 364 passed, 1 failed, 2 skipped; 2,868 tests: 2,775 passed, 1 failed, 92 skipped (743 s). The one
  failure is `changeTier.test.ts` "is A when server or data behaviour is removed": its scratch repository's
  `git commit -qm base` fails because this container's global git config sets `commit.gpgsign=true`. Rerun alone
  with `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false`: 7 of 7 passed. Neither the test
  nor `scripts/change-tier.cjs` is touched by this batch; it is an environment failure, reported, not a pass.
- `node scripts/change-tier.cjs --base 16fe56e`: tier A (`api/parse-stats-file.py`, `documentTableShape.ts`,
  `documentTables.ts`, `driverPerformance.ts`, `drivers.ts`).
- Also run: `npx vitest run conformance/l4/runner/documents.test.ts --pool=forks` (disposable database): 11 passed,
  3 failed (DOC-04 picture of a table, B-08 chart data, C-01 exact values). The same 3 fail on `16fe56e` without
  this change; they are recorded conformance gaps, and B-03 (two-part continuation) passes.
- Not run by me: the browser suite and smoke (to be run by the orchestrator).

## Mocks versus real

- Real: the Python engine (local runner and worker) on SPSS files written by pyreadstat; PostgreSQL built from every
  migration (`documentTableContinuation.db.test.ts` and the full library run); the join, shaping, store and trace
  write.
- Stubbed: storage (in-memory), the saved data layout, document row, overlay and corrections in the engine-path
  driver test (no database needed for a calculation that is not saved); the PDF page text (`extractDocumentText`)
  and the model's answer per part in the document test. No live model was called, so whether the model actually
  fills `last_page_number` is not tested.

## Limits and open points

- The outcome's default top box: fixed in the follow-up section below (R3 combined package).
- A reread document that was split before keeps the stale second piece (see T2-F02 freshness).
- Without a stated end page, a continuation that is the only table of its part is taken to fill the part; a table
  that in fact ended early, followed by pages without tables and then an untitled table with the same columns,
  would be joined. The note records when that inference was relied on.
- Saved driver analyses are not marked stale by this change.

## Follow-up in the combined R3 package: a binary outcome's default top box

Added on the combined branch r3 after the T2 repair reported it. Same bug class as T2-F01, in the outcome rather than
the predictors: `runDriverAnalysisFor` defaulted the top box to `o.distinct === 2 ? o.max : o.max - 1`, counted down
from the highest answer present, so a declared 1 to 5 outcome answered only 1 to 4 had a top box of 3 and 4.

- Owner: `driverPerformance.outcomeTopBox`, reading the same answer domain (`answerDomainOf`). A domain of two codes
  (or within 0 and 1) is its top code; any other scale is its top two codes. Without an answer list the observed
  answers are the domain, exactly the earlier rule, and the outcome note now says so ("no answer list, so the scale
  is the answers present").
- A researcher's chosen top box is checked against the domain's lowest code (the scale's lowest answer), not the
  lowest answer present.
- The outcome note gives the scale's top (5), not the highest answer present.
- Wave tracking's driver path goes through the same function. The screens' "top two" placeholder now matches.
- Freshness: a saved driver analysis on a sparse declared outcome keeps its earlier top box until recalculated; not
  marked stale (the same limit as above).
- Proof: `driverPerformanceDomain.test.ts` "binary outcome" (actual engine; a declared 1 to 5 outcome answered 1 to 4
  gives "answers from 4 up to 5"; an unlabelled 4/5 outcome gives the observed fallback, said; a chosen top box of 1
  is refused). With `drivers.ts` reverted: 1 failed, 9 passed. With the fix: 10 passed. Pure cases in
  `driverPerformance.test.ts` (`outcomeTopBox`): 2 added.
