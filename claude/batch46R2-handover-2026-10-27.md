# Batch 46R2 handover: B42-F01 stored-reversal replay (27 October 2026)

Base: Batch 47 (`bb5bf6cd`). Status: implemented, ready for independent review. Tier A. No migrations.
Repairs B42-F01 as Codex replayed it after Batch 46R (`independent-batch46R-review-2026-10-27.md`, and again
in `independent-import-stress-review-2026-10-27.md`): the retained stored-gap test failed because
`_apply_reversals` checked only non-answer collisions on read, not the full scale fit used at confirmation.
Contract: `claude/codebook-import.md` (scales that cannot be mirrored). I had argued the collision-only check
on read was enough; Codex was right that it was not.

## Cause

Confirmation refused a scale whose usable points were not every whole number from lowest to highest, or with a
non-answer inside that range (`_reversal_problem`). On read, a stored reversal was checked for collisions only
(`_reversal_collisions`), so after the file was replaced and the scale became 1, 3, 4, 5, the reversal was still
built, mirroring answers onto a code no one chose.

## Repair (one rule)

- `_reversal_problem(points, labels_by_item, missing_by_item, items, lo=None, hi=None)` is now the single rule,
  at confirmation and on every read. On read it is given the confirmed range (lo, hi) and the scale's points now
  (`points_now`: labelled substantive codes in that range, plus observed whole values), so a gap or a non-answer
  inside the confirmed range refuses the stored reversal.
- A refused stored reversal is not built; any use of it fails with the reason and "Undo the reversal, or correct
  the item's scale, and confirm it again."; no table is saved; undo recovers.
- Scale points at confirmation (`_battery_scale_points`) also include labelled answer codes, so a fully labelled
  scale on which nobody happened to choose 2 is a full scale, not a gap (the control below).

## Proof (`reverseCoding.db.test.ts`, real database and actual engine)

- "B42-F01 replay: a stored reversal whose scale now has a gap is not built, says why, saves no table, and undo
  recovers": Codex's retained shape (stored reversal, the file's scale replaced with 1, 3, 4, 5). Fails on
  Batch 47 (`loadCategories` resolved), passes now.
- "control: a fully labelled scale on which nobody chose 2 is a full scale, at confirmation and on every read".
- The stored-collision case's message expectation now names the undo step:
  `Code 2 (labelled "Refused") lies inside the scale 1 to 5, ... Undo the reversal`.

Why the earlier tests missed it: the stored-reversal cases changed labels and missing declarations, never the
observed scale itself.

## Impact checklist

1. Rule: `_reversal_problem` is the one owner, used at confirmation and on read; no second rule.
2. Inputs: a scale that no longer fits is refused with its reason, never built on a guess.
3. Persistence: unchanged; a refused reversal saves no table, the confirmed record is kept so undo works.
4. Freshness: tables using the derived variable cannot be rebuilt until the reversal is undone or confirmed again.
5. Screens: the reason reaches the table build and the Data quality panel as before.

## Gates (run on `d32e570`, the code of this package)

- `npx tsc --noEmit` passed; `npx eslint src e2e --quiet` 0 errors; `python3 scripts/crosstab_selftest.py` all
  checks passed.
- `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: 259 files passed (1 skipped),
  1,921 passed, 82 skipped.
- `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`: 126 passed, 1 skipped, 0 failed (26.7 min);
  targeted `reversed-items`, `analysis-plan`, `codebook-waves` passed. `npx playwright test` (smoke): 1 passed.
- Real infrastructure: disposable PostgreSQL 16 and the local stack; the model replayed; storage the local
  disposable store. Nothing ran against cloud Supabase.

## Batch 47 receipt (Codex's handover discrepancy)

Codex noted that the Batch 47 handover cited gates run on top of Batch 48. Batch 47's exact code (worktree
commit `c2465b5`, the same content as `bb5bf6cd`) was gated on its own: library 259 files, 1,919 passed /
82 skipped; browser 126 passed / 1 skipped / 0 failed; smoke 1 passed; engine selftest passed; typecheck and
lint passed.
