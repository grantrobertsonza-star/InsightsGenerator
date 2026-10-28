# Batch 49 handover: questionnaire links through the codebook, and the AI reading's shape (27 October 2026)

Base: Batch 48R (`a55d4d30`). Status: implemented, ready for independent review. Tier A. **Migration 0125**
(`0125_instrument_codebook_links.sql`, additive and idempotent; back up the local database first). Contracts:
`claude/codebook-import.md` ("Questionnaire through the codebook"), `claude/crosstab-ai-reading.md`
("Batch 49"); registry row added.

## 1. A questionnaire question worded like a confirmed codebook entry

Grant: questionnaire 1A and codebook Q1 have the same wording, yet 1A was offered to Q1 at 63% and had to be
confirmed again. Each document was matched to the data file on its own, and the questionnaire's wording was
compared only with the data file's short label for Q1, never with the codebook's confirmed wording.

- Rule (`instrumentMatch.codebookWordingMatches`, `normalisedWording`): a question whose wording is identical
  to a codebook entry confirmed for a variable of the same data file (case, spacing, punctuation, quotes and a
  leading question number ignored; at least five words; unambiguous on both sides) is that variable.
- Persistence (`suggestInstrumentLinks`, migration 0125): written in the matching transaction as method
  `codebook`, confirmed, with `basis_item_id` the codebook entry. It upgrades a suggestion only; a link the
  researcher confirmed or rejected is never overwritten; matching again adds nothing.
- Freshness (`CODEBOOK_BASIS_HOLDS`): such a link counts only while its codebook entry stays confirmed for the
  same variable; rejecting, re-linking or deleting the entry withdraws it from every calculation, and the card
  says so.
- Before 0125: nothing is linked this way and the match says it needs migration 0125
  (`codebookUnavailable`); confirmed meanings read as before.
- Screens: "Codebook links" tab for a codebook; "Variable in <data file>" column with the variable's label;
  "Identical to codebook Q1"; buttons "Confirm: 1A is Q1" and "Not Q1"; "No variable named w2 in <data file>".

Proof: `codebookWordingMatch.test.ts` (Grant's two texts, close wording, too short, ambiguous both sides),
`codebookWordingLinks.db.test.ts` (real database with 0125: linked with its basis, idempotent, withdrawn and
restored with the codebook entry, a researcher's rejection kept, a deleted basis not confirmed),
`codebookWordingLinksPre0125.db.test.ts` (a database stopped before 0125), and the browser check
`codebook-questionnaire-links`. The database cases fail on Batch 48R (the rule did not exist).

## 2. "The AI reading came back empty"

Grant's trace showed the model sent 14,311 tokens in and wrote 962 back, but not in the exact shape the tool
schema gives. Now (`crosstabInsights.ts`): a reading wrapped once or twice in a single field, or sent as JSON
text, is read (`readingIn`); cards sent as JSON text are read as a list; a failed reading is retried once with
more room (3,000 tokens instead of 1,500); if both fail, the error names what came back (field names and types,
never their text) and how much of the table was sent, and the same goes to the trace
(`crosstab_insights_failed`). Proof: `crosstabInsights.test.ts`, 5 cases that fail on Batch 48R (the model is
the mocked boundary). The cause on Grant's machine is not yet confirmed against a live reading.

## Impact checklist

1. Rules: the matcher (`instrumentMatch`) and the confirmed-items reader own them; a registry row names them.
2. Inputs: close or ambiguous wording stays an ordinary suggestion; a withdrawn basis is not confirmed; an
   unreadable AI answer is an error with its shape, never an empty reading.
3. Persistence: links written in the matching transaction; upgrade only from suggested; idempotent.
4. Freshness: a link through the codebook follows its basis; tables recompute on the next build.
5. Screens: the card names the basis and its withdrawal; "saved" wording unchanged.

## Gates (run on `29fce88`, the code of this package)

- `npx tsc --noEmit` passed; `npx eslint src e2e --quiet` 0 errors; `python3 scripts/crosstab_selftest.py` all
  checks passed.
- `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: 263 files passed (1 skipped), 1,944
  passed, 82 skipped.
- `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`: 128 passed, 1 skipped, 0 failed (23.2 min);
  targeted `codebook-questionnaire-links`, `codebook`, `codebook-waves`, `label-documentation`,
  `questionnaire-family-link` passed, and `data-setup-hydration` passed three times in a row.
  `npx playwright test` (smoke): 1 passed.
- An earlier full run on this batch (before it was rebased onto 48R) failed two browser checks:
  `codebook-questionnaire-links`, whose first version read the review rows without opening Review matches and
  expected "Variables read" on a questionnaire (it reads "Items read"): faults in the check, fixed; and
  `data-setup-hydration` once, a click during page load that did not register; it touches nothing this batch
  changed and passed three times on this commit.
- Real infrastructure: disposable PostgreSQL 16 with every migration; the model mocked or replayed; storage the
  local disposable store. Nothing ran against cloud Supabase.

## Limits

The codebook's entries must be confirmed before the questionnaire is matched (matching again picks them up).
Close wording is not linked through the codebook. Batch 51 adds the project and bin scope (IS-F03) to these
writes.
