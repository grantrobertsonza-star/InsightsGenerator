# Batch 42 handover: reverse-coded items and Stata missing codes (27 October 2026)

Base: Batch 41. Status: implemented, ready for review. Tier A. No migrations. Contracts:
`claude/codebook-import.md` (import step 3) and `claude/respondent-quality.md`.

## What it does

- **Stata extended missing values** (.a to .z) declared in a .dta file now count as non-answers in the
  respondent check, as SPSS user-missing values already did. A plain "." stays a blank: pyreadstat returns
  it as 0 when user-missing values are kept, so only declared letters are taken from that read, and only
  where the analysis read has no value.
- **Reverse-coded battery items** (import step 3, part): the Data quality tab suggests items worded the
  other way in a battery, from the wording (item label, else the linked codebook or questionnaire) and a
  negative item-rest correlation over at least 30 cases, non-answers excluded. Confirming is a click; the
  battery and scale come from the engine's reading, never the request. The engine computes `<name>_r` as
  (min + max) - code on the scale's whole points, keeping other codes and blanks, with the original's value
  labels, missing declarations and type correction. The original stays, out of the battery. Undo removes
  it. The respondent check flags someone giving the same answer across items worded in opposite
  directions.

## Impact checklist

1. Rules: variable corrections (`variableOverrideTypes.ts`, `labelOverlay.ts`), crosstab inputs
   (`crosstabs.ts`), respondent quality (`respondentQuality.ts`, engine); new owner `reverseCoding.ts`.
2. Inputs: an item not in a battery the engine read, or a battery with no usable scale, is refused with
   nothing saved; fewer than 30 cases gives no correlation evidence (the suggestion rests on wording only).
   A reversal that can no longer be built (the file replaced by one with its own column of that name, or
   the item now holding text answers) fails with its reason when the variable is used; the file's own
   column keeps its name in the variable list. Found while writing this handover: before the fix, a
   request by name read the reversed values while a full read used the file's column.
3. Persistence: confirm and undo lock the document row (`for update`, run and tenant on the lock) and
   write the corrections in the same transaction; confirming an item already reversed changes nothing.
4. Freshness: tables built on the derived variable depend on the source's corrections, so a change or undo
   marks them changed.
5. Screens: the suggestion list updates only after the action returns; failures shown in place.
6. Proof: `reverseCoding.db.test.ts` (3 cases; the can-no-longer-be-built case failed before the fix), `respondentQuality.db.test.ts` (Stata labelled and declared cases),
   `supportNetInputs.test.ts`, `e2e/ui/reversed-items.check.mjs`.

## Gates

Batches 41 to 46 form one straight stack on Batch 44 and are applied together, so the full gates
were run on the top of the stack (Batch 46, worktree `878cd00`) and the library on each batch's own top:

- Top of the stack: `npx tsc --noEmit` passed; `npx eslint src e2e --quiet` 0 errors;
  `python3 scripts/crosstab_selftest.py` all checks passed;
  `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks` 258 files, 1,908 passed, 82 skipped;
  `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1` 124 passed, 1 skipped, 1 failed;
  `npx playwright test` (smoke) 1 passed.
- The one browser failure was in the new `codebook-waves` check, not the app: it looked for the
  questionnaire line on the data file's Preview tab, while the app shows it on the Labels and
  documentation tab (as `import-file-detail` already reads it). The check now opens that tab; rerun on
  the same stack: 1 passed. The full browser suite will be rerun on Batch 47, which sits on top.
- Each batch's own top, library and typecheck: Batch 41 251 files, 1,874 passed; Batch 42 252 files,
  1,880 passed; Batch 43 254 files, 1,891 passed; Batch 45 254 files, 1,894 passed (all with tsc and lint
  passing, 78 or 79 skipped).
- Real infrastructure: disposable PostgreSQL 16 and local stack for the library database tests and the
  browser suite; the model is replayed from recorded fixtures (scripted model boundary) and storage is the
  local disposable store. Nothing ran against cloud Supabase.

## Limits

Import step 3's always-shown data preview and single Variables editor are not built yet.
