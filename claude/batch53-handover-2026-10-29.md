# Batch 53 handover: grid questions and Confirm all (29 October 2026)

Status: **implemented, ready for independent review.** Tier A (matching, persistence) and B (card). Migration
**0130** (adds the link method 'grid'; additive; not applied to any database; back up first).

Grant, 28 October 2026: grid (battery) questions "are very common, and we should try and pick them up
automatically" (May 2026 IGS Poll: questionnaire 5A and 5B, data Q5_1..8 and Q5b_1..8, codebook "Q5_1 Regardless
of whom ... - Tony Thurmond"); FinScope families listed out of order and confirmable only one by one.

## Built

1. **Grid rows** (`gridRowMatches`, `gridRowOf` in `src/lib/instrumentMatch.ts`; method `grid`): a column's
   label is read as stem and row (leading column name set aside; row after the last spaced dash). For a
   questionnaire, each column's confirmed codebook wording is read too, because the IGS data file has no labels.
   When an item's question (text up to the first "?") is the stem of two or more columns, exactly or followed
   by a note ("(already voted)"), each column is suggested at 0.92 if that grid fits that item only and the item
   that grid only, else at 0.8. Codes may differ; rows match by label, never by position; "(summary)" and
   "Combines ..." columns are never rows; questions under five words are not compared.
2. **Before migration 0130** no grid link is made (`gridLinksAvailable` checks the constraint), so matching is
   exactly as before.
3. **Confirm all N** for one question (`confirmQuestionLinksAction`, `confirmInstrumentLinks` with an item):
   every suggestion of that question, through the shared confirm rule; a column another question already has
   stays a suggestion and is named; a retry confirms nothing more; another questionnaire's question confirms
   nothing.
4. **Order**: a question's links are listed in the data file's column order.

## Not in this batch (next)

- Reading a grid inside Word, PDF and XLSForm questionnaires as one question with its rows (the stem is
  enough for linking today; the card does not yet show the rows).
- "Match again" offered with its reason when a questionnaire was matched under an older rule.
- A row label containing its own spaced dash splits in the wrong place and is not matched (listed in the
  contract).

## Checks

- `gridRows.test.ts` (8): IGS shape, randomised and missing rows, data labels only, ambiguity, short and
  different questions, code rule kept, label parsing.
- `gridLinks.db.test.ts` (3, real database): grid links written and stable on a second match; found through
  the confirmed codebook wording when the data labels are short (fails without that change); Confirm all.
- `gridLinksPre0130.db.test.ts` (database stopped before 0130): no grid link.
- Browser `grid-question-links`: passed.

Gates on the final tree (`83665a3` in the cloud; batches 66, 67, 68, 53 and D1 on top of `16253c5b`): tsc and eslint clean; engine self-test passed; library 304 files, 2,315 tests passed, 91 skipped, 0 failed (real disposable PostgreSQL, run on `0bcbfc0`, which differs only in the control check); full browser suite 140 passed, 1 skipped (the real-model check), 0 failed; smoke 1 passed.

Contract `claude/questionnaire-variable-linking.md` and registry row updated.
