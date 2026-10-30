# Batch 35 handover: Codex's batch 31/32 findings, the import defect and two comment fixes

26 October 2026. Implemented, ready for review. The base is laptop `3253a39d`; the batch is the commit titled "Batch35: ..." directly on top of it. Tier A, because the engine, the project page and `parseStatsFile.ts` changed.

## What changed, by finding

**R2P-F01 (S2), the Codebook showed "Saved" before the save had finished.**
- Owner: new `src/app/runs/[id]/remountConfirmation.ts`, used by `CodebookPanel.tsx` (registry row added).
- Each save writes a record with its own token and page load, marked pending. The call that started the save moves the record to succeeded or failed when it settles. A remounted panel waits for its own request's outcome. A pending record left from an earlier page load means the reload abandoned the request: the panel says the outcome is unknown, never "Saved", and puts the draft back.
- A success is always recorded, because the remount a success causes may still be to come. It is offered only to the mount that follows within 15 s, and it is shown once.
- A refusal with the panel still mounted keeps the draft and the error in that panel, as before.
- Drafts are put back only onto the codebook version they were written against.
- Proof: `codebookSaveConfirmation.test.tsx` mounts the actual component with held action answers. It has five cases:
  - pending save, then remount, then late refusal;
  - pending save, then remount, then late success;
  - success, then remount, then a later remount (control);
  - reload while pending;
  - ordinary refusal, retry, and another document's panel.

  With the previous `CodebookPanel.tsx`, 4 of the 5 fail; the success-then-remount control passes in both versions.
- Not covered: Next's real server-action transport. The mounted test holds the action's answer.

**R2P-F02 (S2), accepting one decision discarded another decision's open draft.**
- Cause: in `page.tsx` the decision section's key followed whether a decision had been set, so the first accept remounted every card. The key is removed; the cards stay keyed by candidate id.
- The same pattern was removed from the Recommendations section, which was keyed on the same flag.
- Removed with it: the comment describing that keying scheme, and the unused `decisionReached`, `decisionDone`, `recommendationsReached` and `generateMode`.
- Proof: `e2e/ui/decision-other-draft.check.mjs` runs on the actual app, action and database:
  - the first-decision boundary (no `decision_statement` before it);
  - an already-set-decision control;
  - saving B's draft, then a reload.

  Shown failing without the fix: with only the old key put back (a proof build, never packaged), the check fails at B's editor (`toHaveValue("Decision B, my wording")`: element not found), because the accept remounts the section.
- Not changed, noted for review: `InsightsWorkspace` is keyed by `synthesizedInsights.length` (page.tsx), so adding or removing an insight remounts it and resets its tab. No editor draft there was shown to be lost; a candidate for the same family check.

**B31-F01 (S3), a worker started by older code was reused after an upgrade.**
- `parseStatsFile.ts` tags every worker it starts with `WORKER_PROTOCOL = 2`. A worker on the global holder without that tag, or with an older one, is stopped and replaced before it is used. Its pending requests fail as a stopped worker would.
- Proof: a new case in `statsWorkerFreshness.test.ts`. A stand-in legacy worker reads every request as a convert and refuses CSV, as the old worker did. The current public `runEngineConversion("table")` gets the correct headers and rows, the old process exits, and the fresh worker keeps answering. With the previous `parseStatsFile.ts` the case fails (the old process is never stopped).
- Limit: the legacy worker is a stand-in, not the historical `dbf2e8e` script.

**B32-M01 (S3), the tier script rated the server page as screen-only.**
- `scripts/change-tier.cjs` now reads screen files. A file under `src/app` or `src/components` is A when it:
  - defines server actions (`"use server"`);
  - is under `src/app` and is not a client component;
  - imports the database or storage clients.

  Unreadable content is A. `--no-renames` lists both paths of a rename, and a deleted file is read at the base.
- AGENTS.md says so.
- Proof: `changeTier.test.ts` (5 cases):
  - the real `page.tsx` is A;
  - an inline server action is A;
  - a data import is A;
  - a client file after leading comments is B;
  - a mixed change is A;
  - unreadable content and an unknown path are A.

**B31-V01 (S3), the worker test failed on Windows.** The fixture's directory link is created with type `"junction"`, which Windows allows without admin rights; other systems ignore the type. The restart, refusal and recovery assertions are unchanged.

**B31-V02 (S3), the narrow-viewport check could pick a hidden navigation button.**
- New `clickSectionButton` in `e2e/ui/helpers/nav.mjs`. It clicks a visible button for the section only; when none is visible it opens the main menu, chooses the section and hides the menu again.
- `recommendations-report-overview.check.mjs` uses it in its narrow loop.
- The layout and count assertions are unchanged.
- The original failure was not reproduced here; the check passed here before and after.

**CAL-R1-F03, Excel TRUE/FALSE merged with 1/0.**
- New `_excel_sheet_grid` builds the grid exactly as pandas' openpyxl and xlrd readers convert cells, without the DataFrame step that merged them.
- In `_typed_series`, a logical cell in a variable that also holds other values becomes its text, TRUE or FALSE, because Python counts True as 1. A variable of logical cells only keeps them as logical values.
- Versions:
  - `TABLE_READER` is now `engine-plain-2026.10.26c`;
  - `DICTIONARY_VERSION` is 14;
  - `minimumDictionaryVersion` is 14 for .xlsx/.xls and stays 13 for CSV/TSV;
  - `ENGINE_VERSION` is `2026.10.26-3`.
- Contract updated in `claude/one-reader-import.md`.
- Proof: a new case in `oneReaderImport.db.test.ts` covers .xlsx and .xls, both layouts, the stored preview and category counts, with a logical-only control. With the previous engine it fails (`[true, true, false, false, 2]`).

**RP0-V02, the Research quality test budget.** The two cases with the most database round trips (deleting a project document; continuing an interrupted run) get a 20 s budget. Their comment gives the measurement: about 1.6 s alone here, and 7.2 s under Codex's imposed load, with all 54 assertions passing at 15 s. A hang still fails.

**RP0-M02, two comments.**
- The `_exact_decimal` docstring now says Excel whole-number cells are held to the 2^53 rule by `_as_numbers`.
- `exactNumberBoundary.db.test.ts` now names the current reader and dictionary version instead of fixed numbers.

## Also in this batch (from Grant)

- The Objectives scores table follows the left list's order (`inListOrder`). Proof: `objective-row-colours.check.mjs` stores the candidates in reverse order and requires the rows in the cards' order, plus a unit case in `objectiveAccents.test.ts`.

## Gates (cloud test copy, same files as the package)

- Typecheck clean; lint 0 errors / 41 warnings (unchanged count).
- Engine self-test (`scripts/crosstab_selftest.py`): all checks passed.
- Full library (`npx vitest run src/lib/__tests__ --pool=forks`, disposable PostgreSQL 16): 238 files passed, 1 skipped; 1,779 tests passed, 72 skipped, 0 failed.
- Full browser suite (`npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`, production build, disposable stack): 113 passed, 1 skipped, 0 failed.
- Golden-thread smoke: 1 passed.
- An earlier run on the batch without the last two fixes found two library failures caused by this batch (the reader name check reads `TABLE_READER` as a whole line, and one test named the old reader) and one browser check of mine that counted the Add decision box as an editor; all three are fixed and the run above is clean.
- Not run here: Windows (the junction change is untested on Windows by me), real model calls.

## Impact checklist (tier A)

1. **Rule:**
   - Excel reading uses the owner `_read_plain`/`_excel_sheet_grid`/`_typed_series`.
   - Worker freshness uses `parseStatsFile.ts` and the worker script.
   - The confirmation owner is new (registry row added).
2. **Inputs:**
   - An unknown save outcome is shown as unknown.
   - Unreadable tier content is A.
   - An Excel engine other than openpyxl or xlrd falls back to the earlier read.
3. **Persistence:** no change to writes or transactions.
4. **Freshness:** older Excel dictionaries and stored previews are re-read (reader and dictionary versions raised); CSV/TSV caches stay valid.
5. **Screens:**
   - Codebook remount and reload are covered.
   - Decision editors survive another decision's accept.
6. **Proof:** as listed above.
