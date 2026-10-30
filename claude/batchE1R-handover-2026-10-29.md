# Batch E1R handover (29 October 2026, night)

Status: **implemented, ready for independent review.** Repairs Codex's E1 review
(`docs/independent-e1-review-2026-10-29.md`, pinned tree `7e09578c`). On top of BatchE1. No migration.

## E1-F01: CSM compared different companies when a code was reused (high)

- **Rule:** the CSM tile row in `claude/rules-registry.md`. The identity rule is now one function,
  `trackerFigures.codeNamesDiffer`, used by the brand funnel (`changesAgainst`, wording unchanged) and by
  `trackerCsmFigures.csmChangesAgainst`.
- **Change:** `csmChangesAgainst` takes both waves' company questions (`CsmCompanies`), carried by
  `trackerOverview.loadBrandOverview` from each wave's own `csmCompanyOf`. A company's box and mean changes are
  computed only when all three hold:
  - both waves' companies are known;
  - the company question is the same variable in both waves;
  - the code names the same company in both answer lists (trimmed, ignoring case).

  Otherwise `changePp` and `meanChange` are null, with one of these reasons:
  - "Company code 1 was Different Bank in the previous wave, so it is not compared."
  - "The previous wave used a different company question (X) ..."
  - "Which company each code named in one of the two waves is not known ..."
- **Unchanged:** the all-customer row is calculated exactly as before.
- **Inputs:** a missing company in either wave is unknown, never assumed the same. A code missing from the
  previous list is not compared.
- **Proof:**
  - `csmCompanyIdentity.test.ts` covers six cases: same company (control, +20), a reused code (Codex's repro),
    unknown in either wave, a changed company question, a missing code, and recovery.
  - `csmCompanyIdentity.db.test.ts` runs the banking pack with wave 1's code 1 relabelled "Different Bank"
    through pyreadstat, on the real database and the actual engine. Every tile's code 1 row is withheld, bank 2
    and all customers still equal the references' difference, and FNB is compared again once wave 1 is the
    original file.
  - Without the fix, 6 of the 8 cases fail. The two that pass are the same-company control and the DB recovery case.

## E1-F02: Setup accepted a structure the researcher had not seen (high)

- **Rule:** the data setup saves row.
- **Change:** `rebaseSetupEdit` now judges acceptance in both directions:
  - a structure change made here asks for acceptance again;
  - an acceptance from a view whose unit, layout or method changed elsewhere is a conflict. It is never
    re-applied, and the latest version is shown for review.

  A wave label still merges onto a changed structure and keeps that structure's acceptance state.
  `SETUP_STRUCTURE_KEYS` names the structure fields. The Setup tab's save, conflict, rebase and retry sequence
  moved from `TranscriptSetup.tsx` into `saveSetupEdit` (lib), so it is tested through the real compare-and-swap.
  Screen behaviour is unchanged, apart from what it shows on these conflicts:
  - on a failed first save the edit stays on screen;
  - on a failed re-application what is saved is shown.
- **Proof:**
  - `dataSetupRebase.test.ts` has 10 new cases: both interleavings for each structure field, the repro, the
    wave-label merge, unchanged-structure acceptance and recovery.
  - `setupAcceptanceRace.db.test.ts` has 8 cases on a disposable database:
    - for each field, B saves a new structure and A then accepts the old view: the acceptance is refused, not
      retried, and reload shows B's structure unaccepted;
    - the other interleaving asks for acceptance again;
    - a wave label merges;
    - accepting after reload succeeds.
  - Without the fix, 4 unit cases and 3 database cases fail.
- **Why the earlier tests missed it:** they covered a structure change here meeting an acceptance there, not
  the reverse.

## E1-F03: a failed Update table followed by a retry left two drafts (medium)

- **Rule:** the Build table and Update table row.
- **Change:** `buildCrosstab` takes `replacesDraft`:
  - Under the file's row lock and in one transaction, it inserts the new table and deletes the old draft, only if
    the old one is still a draft of this file, so a committed table is never removed. A failure rolls both back.
  - The new table records `replacedDraft`. Retrying the same edit (compared by canonical request), after a
    failure or a lost answer, returns that table.
  - A different edit of a draft already updated is refused, with a message to reload.
- **`replaceDraftCrosstab`:** when the old draft is gone because this edit replaced it, it finds the recorded
  replacement and does not report "not found".
- **Proof:**
  - `crosstabReplaceAtomic.db.test.ts` runs on the real database with the actual engine on the banking pack:
    - a disposable trigger refusing the delete makes Update fail, and only the old draft remains, with no new
      table;
    - after the trigger is dropped, the retry gives exactly one edited draft, and the same edit sent again gives
      the same table;
    - two simultaneous updates with the same edit give one table, and with different edits one is refused, with
      one table left;
    - a committed table is kept.
  - Without the fix, 2 of the 3 fail.
  - `crosstabWaveCopy.db.test.ts` (5) still passes.

## E1-F04: Read again left an automatic codebook confirmation standing after its fit stopped holding (medium)

- **Rule:** the codebook automatic confirmation row and `claude/codebook-import.md` (CB1, Re-checked).
- **Change:** in the read's publishing transaction (`storeInstrumentRows`), an existing entry whose answer list
  or code changed has its confirmed `decided_by = 'automatic'` links set back to suggestions. The researcher's
  links are untouched.
- **After the read:** `readInstrumentItems` calls `matchCodebookToDataFiles`. The matching owner and
  `answerCodesFit` re-confirm, on every wave, those that still fit. `automaticRecheck` reports how many were
  withdrawn and how many were re-confirmed, counted by entry and file.
- **If the re-check fails:** they stay suggestions, and Read again says so. A failed read changes nothing.
- **Questionnaire links:** links through the codebook stand only while the codebook entry is confirmed
  (`CODEBOOK_BASIS_HOLDS`), so they follow automatically.
- **Proof:**
  - `codebookRereadRecheck.db.test.ts` has 6 cases, on a real database with the actual engine and a CSV codebook
    (no model):
    - before the reread: confirmed on both waves;
    - the list loses code 10: wave 1, which holds 10, becomes a suggestion and is not returned as confirmed by
      `getConfirmedItemsForData`; wave 3, which holds only 1 and 8, is confirmed again; the unchanged region entry
      is untouched; `reconfirmed` is 1 of 2;
    - a list that still fits is re-confirmed 2 of 2;
    - the researcher's confirm and reject survive;
    - a failed read keeps everything;
    - recovery.
  - Without the fix, 3 fail.
  - The codebookAutoLinks, instrumentScope, codebookImport and gridLinks suites (29 tests together) pass.

## Also: brands named from confirmed labels (found on Grant's laptop, 29 October)

- **Symptom:** the Brand tracking dashboard said "This file numbers its brands ... without naming them" for the
  BMW tracker. Reproduced with Grant's real files on a disposable database (Master_Codebook.csv, links confirmed).
- **Cause:** `labelOverlay` shows a confirmed label as "aware_b01. Prompted resolved recognition Toyota". The code
  in front differs for each brand, so `trackerNameFamilies.varyingLabels` found no shared wording, and the
  recogniser read the brand list as unnamed.
- **Change:** `trackerRoleVariables.wordingOfLabel` removes a leading copy of the variable's own name before role
  recognition. Screens and tables keep the full label. Measure names are now the question's wording
  ("Prompted resolved recognition", not "aware_b01. Prompted resolved recognition").
- **Proof:** `trackerInput.db.test.ts`, CSV codebook with links confirmed. Type is brand, the ten brands are named
  b01 to b10, there is no brand-names question, and the awareness measure has all ten variables. It fails without
  the fix (type "unknown").
- **Expectation changed:** this test used to expect no brand list from the CSV codebook. That expectation recorded
  the defect; the labels do name the brands.
- **The xlsx codebook:** its answer lists name the brands through `findBrandFrame`. Codes 1 to 10 with BMW 8 were
  confirmed with Grant's files once matched after migration 0133.

## Files

- `src/lib/trackerFigures.ts`, `trackerCsmFigures.ts`, `trackerOverview.ts`
- `src/lib/dataSetupRebase.ts`, `src/app/runs/[id]/TranscriptSetup.tsx`
- `src/lib/crosstabs.ts`
- `src/lib/instruments.ts`, `instrumentActions.ts`, `src/app/runs/[id]/InstrumentCard.tsx` (the Read again
  message)
- `src/lib/trackerRoleVariables.ts` (brand names from labels)
- Tests:
  - `csmCompanyIdentity.test.ts` and `.db.test.ts`
  - `dataSetupRebase.test.ts`
  - `setupAcceptanceRace.db.test.ts`
  - `crosstabReplaceAtomic.db.test.ts`
  - `codebookRereadRecheck.db.test.ts`
  - `trackerInput.db.test.ts` (CSV codebook case)
- Docs: `claude/rules-registry.md`, `claude/codebook-import.md`, `claude/d2-design-2026-10-29.md`

## Mocks and real

Real disposable PostgreSQL and the actual Python engine everywhere above. Storage, the request context, the
model client, `revalidatePath` and `next/server` are stand-ins. The deletion-failure trigger exists only in the
disposable database.

## Gates

See `docs/current-engineering-status.md`, section "batch E1R". The full library and browser suites run on this
exact tree.

## Limits

- `saveSetupEdit` covers the Setup tab's path. Server enforcement of "accept again" on a structure change
  remains the screen's job, as before.
- The F04 re-check runs after the read's transaction. Between the two, withdrawn links are suggestions, never
  confirmed.
- Codex's gate-provenance note is answered by running the full suites on this exact tree.
