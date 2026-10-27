# Batch 45 handover: which data file a codebook or questionnaire belongs to; dense questionnaires (27 October 2026)

Base: Batch 43. Status: implemented, ready for review. Tier A. No migrations. Contract:
`claude/codebook-import.md` ("Which data file", "Dense questionnaires"); registry row added.

## What it does

**Which data file it is matched to.** Grant asked: "If I add a data file to an existing project with other
data files, then import a codebook and questionnaire, how does the system know which data file to link
them to?" Before, it took the first raw data file, and the Import list said "Linked to" that file before
anything was matched.

Now `chooseMatchTarget` (`instruments.ts`) decides, in this order:
- the file it was matched to before, while that is still a data file of the project;
- else the only raw data file;
- else the file whose variables match the most of its items, when the lead is clear (at least 3 items
  and a quarter ahead of the next file).

Waves of one tracker fit equally, and a file whose variables cannot be read cannot be compared. In
either case nothing is matched, and the card lists each file's count and asks the researcher to choose.

**Linked to, and several waves.** "Linked to" lists only files with suggested or confirmed links
(`InstrumentSummary.linkedDataDocumentIds`), plus the file last matched to. A questionnaire not matched
yet keeps its own card, with "Choose a data file". One questionnaire can be matched to each wave in turn;
every wave lists it.

**Read failed is said.** A questionnaire whose latest read failed is "Read failed" in the list, not "Not
read yet".

**Dense questionnaires** (Grant's May 2026 IGS poll questionnaire: "No question items were found in this
file"). A part of the document whose questions and answer lists need more output than one read returns
(the ballot of 61 candidates) used to be dropped as failed. When every part was dropped, the read said
the file had no questions.

Now an overflowing part is read again in halves, split at a line (a page boundary near the middle when
there is one), down to three times. A read where every part failed says "None of this file could be
read: N of its parts failed (reason)". "No question items were found" is kept for a read that worked
and found none.

I could not run the real model here, so overflow is the likely cause of Grant's failure, not a confirmed
one. Reading that file again after this batch will say which: its questions, or the actual reason.

## Impact checklist

1. Rules: instrument matching (`instruments.ts`, owner), import list state (`importSources.ts`).
2. Inputs: no data file means no match; an unreadable data file is never compared by guesswork; a read
   whose every part failed is a failure with its reason.
3. Persistence: matching is unchanged (`suggestInstrumentLinks`); choosing writes nothing.
4. Freshness: unchanged. Links are per data file, as before.
5. Screens:
   - the automatic first match runs once per page;
   - "choose" is a message on the card, not an error;
   - the picker never shows a silent default.
6. Proof:
   - `codebookImport.db.test.ts` "chooses the data file": none, only, best, equal waves, before,
     unreadable, another project; linked to both waves;
   - `instrumentReread.db.test.ts`: dense parts read in halves (72 questions, pages kept); every part
     failing says so and then recovers. Both failed on the old code;
   - `importSources.test.ts`: read failed;
   - `codebook-waves.check.mjs` (browser).

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

The real model's output budget was not measured on the IGS file here.
