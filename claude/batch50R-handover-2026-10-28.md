# Batch 50R handover: repairs for the Batch 49 and 50 reviews (28 October 2026)

Base: Batch 50 (`07758e8e`). Status: implemented, ready for independent review. Tier A (B49-F01, B49-F02) and
B (B50-F01). No migrations. Repairs B49-F01 (S1) and B49-F02 (S3) from `independent-batch49-review-2026-10-28.md`
and B50-F01 (S2) from `independent-batch50-review-2026-10-28.md`. Contracts: `claude/codebook-import.md`
("Questionnaire through the codebook": Rule, Links made by the first rule), `claude/crosstab-ai-reading.md`.

## B49-F01 (S1): wording that differs in meaning was confirmed as identical

Cause: `normalisedWording` reduced text to ASCII letters and digits and dropped any leading number, so
"< 5000"/"> 5000", "-500"/"+500", 東京/大阪 and "18 years"/"21 years" were one wording, and the pair was
written confirmed through the codebook with no researcher.

Repair (the single matcher, `instrumentMatch.ts`):

- `normalisedWording(text, code)` sets aside formatting only: NFKC, case, runs of spacing, quotation-mark and
  dash styles, closing punctuation. Symbols and signs, numbers and every script are kept. A leading label is
  dropped only when unmistakable: the item's own code at the start, or a number label closed by ".", ")" or
  ":". Grant's 1A/Q1 texts still match.
- `wordingIdentical` is the one check of a stored link through the codebook. `getConfirmedItemsForData`
  leaves out a link whose wording fails it (so a false link made by the first rule stops counting at once,
  nothing deleted), and `getInstrumentLinks` reports it (`basisLapse: "wording"`; the card says "The wording
  is not identical to codebook Q1, so this link is not used").
- `suggestInstrumentLinks` turns a link the matcher made (method `codebook`) that the current rule does not
  support back into a suggestion (method `wording`, 0.85, no basis). Links the researcher chose, confirmed or
  rejected are never touched. As on every match, suggestions are worked out afresh next time.

Proof: `codebookWordingMatch.test.ts` (Codex's four pairs as negatives, their formatting-only controls, the
leading-number rule; the first test's expectations updated where they encoded the old rule: a bare "Q1"
prefix is stripped only with the code given, quotation marks are kept); `codebookWordingLinks.db.test.ts`
(real database with 0125: the comparison, place-name and leading-age pairs give `fromCodebook` 0 and no
confirmed link; a false link stored as the first rule made it is not returned by the reader, is reported as
a wording lapse, becomes a suggestion on matching, matching again adds nothing, and corrected wording then
links and confirms; a researcher's own confirmed link is untouched). 8 of the 19 cases fail on Batch 50.

## B49-F02 (S3): malformed cards were not traced

`readOnce` now routes every failure through `traceReadingFailure` (shape only): cut off, no reading returned,
no headline, and no usable cards ("... without any patterns described (fields returned: headline (string),
cards (object))"). Proof: `crosstabInsights.test.ts` "B49-F02" (both attempts traced, token limits 1500 and
3000, no model text in the trace); fails on Batch 50.

## B50-F01 (S2): switching tabs discarded work in progress

Cause: the inactive tab was unmounted, so `CrosstabAsk`'s reviewed plan and each `TableCard`'s local choices
(Mean, measures, an unsaved title, a generated reading) were lost. Repair: both tab panels stay mounted and
the inactive one is `hidden`. The workspace's messages (added, committed, refused) now render once, above both
tabs: with both mounted, one copy per tab put the same text on the page twice (the first full run of this
batch failed 13 journey checks and smoke on that duplicate; fixed before the run below). A reload still starts afresh, as before; the late-refresh guard and All tables
are unchanged. Proof: new `crosstab-tabs-state.check.mjs` (real browser): a reviewed SemanticTabs plan (its
request, summary and Add table now) survives View tables and back; on a built starter table an unticked
Mean, its `mean=0` Excel link and an unsaved title survive Build table and back. Fails on Batch 50 at the
plan step, passes on this batch. `crosstabs-entry` now expects the variable list hidden, not removed, on
View tables.

## Impact checklist

1. Rules: the matcher owns identity of wording (`normalisedWording`, `wordingIdentical`), used by the
   writer and both readers; no second rule.
2. Inputs: anything not formatting-identical is left to the researcher; an unreadable AI shape is traced.
3. Persistence: the downgrade runs in the matching transaction; only matcher-made links change.
4. Freshness: tables built after this use only links that pass the rule; earlier tables are not rebuilt.
5. Screens: switching tabs keeps in-progress state; reload behaviour unchanged.

## Gates

Run on `6b9daa3`, the code of this package:

- `npx tsc --noEmit` passed; `npx eslint src e2e --quiet` 0 errors; `python3 scripts/crosstab_selftest.py` all
  checks passed.
- `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: 263 files passed (1 skipped), 1,954
  passed, 82 skipped.
- `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`: 129 passed, 1 skipped, 0 failed (35.4 min);
  targeted `journey-changes` (7), `band-preferences`, `findings-narrow`, `crosstab-tabs-state`,
  `crosstabs-entry` passed. `npx playwright test` (smoke): 1 passed.
- `crosstab-tabs-state` on Batch 50 plus only that check (probe commit `7598845`): fails at the reviewed-plan
  step, as Codex reproduced.
- Real infrastructure: disposable PostgreSQL 16 with every migration and the local stack; the model mocked or
  replayed; storage the local disposable store. Nothing ran against cloud Supabase.
