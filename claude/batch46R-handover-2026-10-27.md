# Batch 46R handover: repairs for the batch 41 to 46 review (27 October 2026)

Base: Batch 46 (`5959a8d1`). Status: implemented, ready for independent review. Tier A. No migrations.
Repairs Codex's B42-F01 (S1) and B41-F01 (S2) from `independent-batch41-46-review-2026-10-27.md`
(review commit `de97effb`). Contracts: `claude/codebook-import.md` (scales that cannot be mirrored),
`claude/evidence-chain.md` (CE-6, planned tables). Please replay the retained repros before resuming the
ordered review.

## B42-F01 (S1): reverse coding over a scale with a non-answer inside it

Cause: the engine reversed every whole number from the scale's minimum to its maximum, and copied the
source's missing declarations to the derived variable. With code 2 declared missing and labelled
"Refused" inside 1 to 5, every valid 4 became 2 and left the base (35 instead of 47), with no error.
Confirmation took min and max from the battery's usable points (1, 3, 4, 5) without checking for the gap.

Repair (one rule, engine `_reversal_collisions` and `_reversal_problem`):

- A scale can be reversed only when its usable points are every whole number from lowest to highest and
  no non-answer code (declared missing, or labelled don't know, refused, not applicable) lies inside that
  range. Otherwise confirmation is refused with the reason and nothing is saved: `"Q1_3" cannot be
  reversed: code 2 (labelled "Refused") lies inside the scale 1 to 5, so turning the scale around would
  move valid answers onto a non-answer code. Nothing was saved.` A gap (1, 3, 4, 5) gives "... not every
  whole number from 1 to 5, so the scale has no single mirror".
- The respondent check reports the reason per battery (`reversalProblem`); the Data quality panel shows it
  in place of "Reverse this item" (an existing reversal can still be undone). A battery read without the
  check (field absent) is refused as "could not be checked", never assumed safe.
- A stored reversal is checked again on every read: if the file's labels or missing declarations now put a
  non-answer inside the scale, the derived variable is not built, any use of it fails with the reason
  (`... could not be built: Code 2 (labelled "Refused") lies inside its scale 1 to 5 ...`), no table is
  saved, and undo recovers. So the missing declarations copied to a derived variable never fall on a code
  valid answers are turned into.
- Codes outside the range (9, 99) and blanks are kept as they were (the existing case covers 9).

Proof (`reverseCoding.db.test.ts`, real database and engine, three new cases, all fail on Batch 46):
declared-and-labelled and labelled-only internal code refused with nothing saved and the original's valid
base equal to the generator's arithmetic; a gap scale refused; a stored reversal after a recoded file not
built, its use and a table build refused with nothing saved, undo recovers. Why the earlier tests missed
it: the fixture's only non-answer code (9) lay outside the scale.

## B41-F01 (S2): bulk promotion of an orphaned approved plan line

Cause: `promoteApprovedPlanTables` selected every approved, non-excluded line in the run, without the
current-item rule the screen counts the plan with (`planCounts`, `rollUp`).

Repair: promotion reads the current objectives and decisions in its own transaction
(`readCurrentEvidenceItems`) after locking the run and its accepted objectives and decisions (`for
share`; unaccepting and other context changes take the run's lock, so a change in progress is waited
for), and moves only lines whose identity (`evidenceIdentity`) matches a current item (`currentItemKey`).
Lines of an unaccepted or deleted objective, or with an unknown or conflicting origin, are counted
(`notCurrent`, "... belong to an objective or decision no longer in the plan, so their tables were not
added") and their tables are untouched. A table already moved keeps the plan line it was moved with.
`approved` now counts the current approved lines, as the screen does.

Proof (`analysisPlan.db.test.ts`, real database and engine, two new cases): a mixed plan after unaccepting
one objective moves only the current line's table (the orphan's stays an evidence table with no plan
record), the listing marks that group orphaned; re-accepting moves it and leaves the earlier move's plan
line unchanged; a deleted objective's line is not current; and a promotion started while an unaccept holds
the run lock waits for it and acts on its outcome. The first case fails on Batch 46 (it moved 2 tables).
The existing promotion case now expects `notCurrent: 0`. Why the earlier tests missed it: no case changed
an objective after its line was approved.

## Impact checklist

1. Rules: reverse coding (`reverseCoding.ts`, engine `_apply_reversals`, owners) and the plan's current
   items (`evidenceIdentity`/`readCurrentEvidenceItems`, owner reused; no second rule).
2. Inputs: an unchecked battery is refused, not assumed reversible; a reversal that cannot be built fails
   with its reason; an origin that is unknown or conflicting is not current.
3. Persistence: confirmation writes only after the check passes; promotion is one transaction, with the
   run and candidate locks taken before the current items are read.
4. Freshness: unchanged; a refused reversal saves nothing, a skipped line's table is untouched.
5. Screens: the panel names the reason; the promotion note names the skipped lines.

## Gates

Run on the repair commit (worktree `679862f`, the code of this package; the later commit adds only the
check fix below and these contract lines):

- `npx tsc --noEmit` passed; `npx eslint src e2e --quiet` 0 errors; `python3 scripts/crosstab_selftest.py`
  all checks passed.
- `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: 258 files, 1,913 passed, 82 skipped
  (Batch 46: 1,908; the five new repair cases).
- `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`: 124 passed, 1 skipped, 1 failed
  (`codebook-waves`); `npx playwright test` (smoke) 1 passed. Targeted: `reversed-items` and `analysis-plan`
  passed.
- The `codebook-waves` failure was the check, not the app: after clicking Match for the second file it
  waited for the text "links suggested", which the first match had already put on screen, so it could
  reload while the second match was still saving and then find only one link. It now waits for that file's
  option to be marked "(linked)". Rerun three times in a row (`--repeat-each=3`): 3 passed. It also passed
  in the two other full runs today (Batch 47 and the top of the stack).
- Real infrastructure: disposable PostgreSQL 16 and the local stack; the model replayed from recorded
  fixtures; storage the local disposable store. Nothing ran against cloud Supabase.
