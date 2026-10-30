# Batch 58 handover: Respondents tab, codebook Code column, failed-read screen (28 October 2026)

Status: **implemented, ready for independent review.** Worktree `b68`, on top of batch 52R (`0acab2f`).
Not pushed. No migration. Tier B (client screens only; no rule, calculation or stored data changes).

## What was asked (Grant, 28 October 2026)

1. "Move this respondent check to a separate tab next to the main tabs."
2. Codebook links: long variable codes overlapped the question wording (Findex codebook screenshot).
3. Findex microdata over the case limit: the file said "Read failed" but the Preview still said it was
   being read, and a Setup chip and "Open Crosstabs" were offered beside it.

## What changed

1. **Respondents tab** (`page.tsx`): `RespondentQualityPanel` moves out of Data quality into its own
   panel `{ id: "respondents", label: "Respondents" }` beside it. Same component, same server data; no
   change to what the checks compute or store. Contract note in `claude/respondent-quality.md`.
2. **Code column and link buttons** (`InstrumentCard.tsx`): the Code column is `w-36` and wraps with
   `[overflow-wrap:anywhere]`, so usual names fit on one line and a long unbroken name wraps inside its
   own cell instead of running into the question. `data-testid="item-code"` added for the check. The confirm and reject
   buttons wrap under the variable when the names are long instead of covering it.
3. **Failed read** (`TranscriptSetup.tsx`): `SourcePreview` takes `readFailed`; when processing failed it
   says the file could not be read (`data-testid="preview-read-failed"`) instead of "being read", and the
   Setup chip and next-step button are hidden. The refusal reason already shown is unchanged.

Impact checklist: inputs, persistence and freshness are untouched (display only). Screens: the panels
render from the same props as before; a failed read is decided from the processing status the page
already loads, so a reload or document switch shows the same state.

## Checks

- `e2e/ui/codebook-long-codes.check.mjs` (new): four codes from a short `q1` to a 63-character name
  with no breaks; each Code cell must not overflow and must end before the question cell starts.
  First run in the stack failed because the matches table is folded until "Review matches" is pressed;
  the check now presses it (commit `5b45367`). Rerun on a fresh stack of the stack tip with the fix
  (`68949f4`): `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1 e2e/ui/codebook-long-codes.check.mjs`,
  1 passed. Why the first run missed it: the check was written against the open table and never run
  before the stack; it is now part of the full browser suite.
- Second overlap found from the check's screenshot: with long names the Confirm and Not buttons covered
  the variable name and its "Same code, 100%" line. The buttons now wrap under the variable
  (`linkChoiceBtn`, `flex-wrap`; the unused `linkBtn` removed). The check also measures this column:
  two buttons, none covering the variable, nothing past the column. Without the layout change (hooks
  only) it fails: "the links run past their column", 721 px. With it: 1 passed, together with
  `codebook-questionnaire-links`, `questionnaire-manual-link` and `questionnaire-family-link` (each 1
  passed) on the stack tip with batch 64 (`f8807dd`).
- Updated for the new tab: `respondent-quality`, `reversed-items`, `add-files-panel`.
- `over-limit-refusal` extended: after a refused read, the Preview shows `preview-read-failed` and no
  Setup chip or "Open Crosstabs".
- Stack gate run `gstack2` on `bfecb11` (batches 54 to 63 and 65, which include this batch): tsc and lint
  clean; selftest passed; library 293 files passed, 2 skipped (2,208 tests passed, 85 skipped, 0 failed);
  full browser suite 136 passed, 1 skipped, 1 failed (codebook-long-codes, the check defect above);
  smoke 1 passed. All browser checks ran against the real disposable stack (PostgreSQL on 55432, the
  local engine); the model is not involved in these screens.

## Limits

- The Code column width is fixed; an extremely long label in another column is not addressed here.
- Screenshots: `shots/cblc/codebook-long-codes.png` from the rerun, and the respondent and failed-read
  screens from the batch runs.
