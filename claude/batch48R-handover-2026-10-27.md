# Batch 48R handover: B48-F01, a Mean row refused for repeated answer labels (27 October 2026)

Base: Batch 48 (`49826a90`). Status: implemented, ready for independent review. Tier A. No migrations.
Repairs B48-F01 (S2) from `independent-batch48-review-2026-10-27.md`. Contract: `claude/mean-tick.md`
("Answer labels do not enter it").

## Cause

The Mean tick added its row as a mean group whose answers were listed by label, and every group went through
`_resolve_group_labels`, which refuses a label shared by several codes. The mean branch never used the
resolved codes (it is the mean of the raw numeric answers, non-answers left out), so unique labels had become
a condition of a calculation that does not use them: with codes 2 and 3 both labelled "High" on an ordinal
1 to 3 scale, no Mean row, although the codes, the scale and the arithmetic were unchanged.

## Repair

In the engine's `crosstab` group loop, a group marked `autoMean` (the Mean tick's) takes no label resolution; its
row is computed by the existing mean branch on the raw codes, as before. A group the researcher defines by
its labels (net, score, a requested mean) still refuses a shared label, with its reason in `skipped`. No
second mean calculation.

## Proof (`meanTick.db.test.ts`, the actual `buildCrosstab`, `commitCrosstabs` and export route, real database
and engine; 4 new cases, all fail on Batch 48)

A designed ordinal .sav (300 respondents, codes 1 to 3, 9 = "Don't know", a weight of 1 or 2, Segment A
higher), with expected means computed by plain arithmetic in the generator, independently of the engine:

- Codes 2 and 3 both "High": the Mean row is there, first, with Segment A, Segment B and total equal to the
  generator's means; weighted, the total equals the weighted arithmetic; "Don't know" left out of both;
  `meanNotAdded` empty. Mean off: no row. The same file with distinct labels (Low, Middle, High) gives
  identical figures (labels do not enter the arithmetic). Fails on Batch 48 (no row).
- A net group "Top" defined by the shared label "High" is still refused, its reason in `skipped`
  ("matches more than one answer code"), and the Mean row is still added. Fails on Batch 48 (no Mean row).
- Committed, the table's mean difference becomes a finding worded "The mean of Level is higher for Segment
  "Segment A" ...". Fails on Batch 48.
- The export route's Excel file prints the Mean row with the total equal to the generator's mean, and
  `mean=0` leaves it out. Fails on Batch 48 (no Mean row was saved, so none is exported).

Why the earlier tests missed it: every Mean fixture had one label per code.

## Impact checklist

1. Rule: the Mean-tick owner (`crosstab` mean branch, `_is_ordered_scale`) and raw-code identity; the
   label-group refusal stays with `_resolve_group_labels`. No second rule.
2. Inputs: duplicate labels no longer refuse an unaffected calculation; non-answers are still left out.
3. Persistence: unchanged; the row is saved with the table as before.
4. Freshness: a table built on Batch 48 for such a question has no Mean row until rebuilt; nothing else changes.
5. Screens: unchanged.

## Gates

Run on `1706f79`, the code of this package (Batch 48 plus this repair):

- `npx tsc --noEmit` passed; `npx eslint src e2e --quiet` 0 errors; `python3 scripts/crosstab_selftest.py`
  all checks passed.
- `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: 260 files passed (1 skipped),
  1,929 passed, 82 skipped (Batch 48: 1,925; the four new cases).
- `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`: 127 passed, 1 skipped, 0 failed (23.3 min);
  targeted `mean-tick`, `quick-charts`, `journey-exports` passed. `npx playwright test` (smoke): 1 passed.
- Real infrastructure: disposable PostgreSQL 16 and the local stack; the model replayed; storage the local
  disposable store. Nothing ran against cloud Supabase.
