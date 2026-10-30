# Batch 36 handover: import module, step 1 and step 2 (26 October 2026)

Base: laptop a03ccaeb (Batch 35). Status: implemented, ready for review. Tier A (scripts/change-tier.cjs:
63 files). Requires migration 0118 and `pip install -r requirements.txt` (pyreadr, fastparquet).

## What it does

1. **Data file formats.** Tab-delimited and other delimited .txt (a .txt with fewer than two columns is
   refused with the separators tried); SAS .sas7bdat and .xpt (blank character values are missing);
   R .rds, .RData, .rda (largest data frame; factors become codes 1..k with their levels as labels);
   Parquet (categoricals keep their own values). Pickle is refused for security and Feather with what to
   upload instead. Verified against reference files: pandas' SAS test files (airline, test1) and files R
   wrote (fixtures/sas, fixtures/r, each with a README and hashes).
2. **Respondent checks** on the Data quality tab: straightlining across batteries, mostly non-answers,
   speeders and long interviews, interviewers whose cases stand apart, and the flagged cases. Flags only;
   nothing is excluded (claude/respondent-quality.md has every rule and threshold).
3. **Codebook as its own type** (migration 0118 adds 'codebook' to documents.instrument_type). Excel,
   CSV, text and JSON codebooks are read without the model (name column found by content, "1=Democrat,
   2=..." lists, section rows, long one-row-per-code layouts); Word and PDF by the model. Excel and
   XLSForm questionnaires: XLSForm read directly (questions, choice lists, groups, relevance), other
   spreadsheets by the model. The real Berkeley IGS May 2026 codebook: 266 entries, all 264 data columns
   matched, 255 with answer labels.
4. **LBL-01, two documents for one data file** (step 2 of the import plan). A codebook and a
   questionnaire can now both confirm the same variable; IR-04 still holds inside one document. Labels
   come from the data file, then the codebook, then the questionnaire; question wording from the
   questionnaire first. Different answer labels are applied from the codebook and listed. A raw data
   file's links tab is now **Labels and documentation**: coverage tiles, the linked documents, the
   disagreements, a per-variable table with where each label comes from, filters and search, and
   codebook entries with no confirmed column.

5. **Codex batch 35 review (20a1178f), all five repaired:**
   - **B35-F01 (S2).** `CodebookPanel.tsx`: a late refusal restores the submitted drafts only onto a
     panel nothing has been typed in since it mounted (`editedSinceMount`, set by every edit path through
     `editDrafts`). Otherwise the newer wording is kept and the error says so. Mounted tests: the review's
     repro (FIRST_SUBMITTED, remount, NEW_UNSAVED_EDIT, late refusal) fails on the old code and passes; the
     newer edit then saves; a late success after a newer edit keeps it. The existing pending, reload,
     retry and other-document cases still pass.
   - **B35-F02 (S3).** `parseStatsFile.ts`: the legacy-worker replacement is single flight. Only the caller
     that finds the holder still on the promise it awaited stops the old worker and starts the replacement;
     the others await that replacement. `__statsWorkerStarts` counts workers that reached ready, so the
     test is portable. Four callers released together on one held legacy worker: 4 workers started on the
     old logic, 1 now, owned and running; the old one stopped; all four tables correct.
   - **M-B35-01 (S3).** `change-tier.cjs`: every changed file is classified at both sides (HEAD and the
     merge base, or working copy and HEAD) and takes the higher tier. Found while testing it: `git show
     REF:path` for a path deleted at REF printed nothing and exited 0, so a deleted file read as empty
     (which happened to fail closed to A); now `git cat-file blob`. Real temporary git repositories and the
     actual CLI: server page to client-only A, data import removed A, display-only edit B, deleted server
     page A, deleted display-only component B, added display-only component B.
   - **V-B35-01 (S3).** `analytics-posted-unknown.check.mjs`: the revoke now happens after the file
     choice has refreshed the page and settled, just before Charts opens, so it reaches the card's
     posted-state read. Assertions unchanged (unknown state, no Post, no Remove, rows unchanged, the page
     still rendered, Retry and reopen recover). It passed on Linux before and after; the Windows production
     timing that failed for Codex is not reproduced here, so this needs Codex's run to confirm.
   - **V-B35-02 (S3).** `historyCsvFormula.db.test.ts` builds the LibreOffice profile with
     `pathToFileURL`, as `convertToPdf.ts` already does in the app. Passes on Linux; Windows to confirm.

## Impact checklist (LBL-01)

1. **Rule:** IR-04 (`variableTakenBy`) narrowed to one document; new registry row "Which document
   labels a variable" owned by `labelOverlay.ts` `resolveLabels` / `LABEL_SOURCE_ORDER`. buildLabelOverlay
   and the tab both use resolveLabels; no second implementation.
2. **Inputs:** a link with no recorded instrument type ranks last and is never reported as a conflict.
   A failed confirmed-link read (InstrumentMeaningUnavailableError), a failed setup read, or a document of
   another project refuses the tab with its reason; it never shows "not documented" for an unread source.
3. **Persistence:** no new writes. Confirmation keeps its transaction and the data file's row lock; only
   the taken-check's scope changed (`i.document_id = (select document_id from instrument_items where id = $3)`).
4. **Freshness:** unchanged. Confirming a link changes the labels of tables built afterwards, as before.
   For a project with a codebook already confirmed, labels do not change when a questionnaire is
   confirmed later (codebook outranks it). Where a questionnaire was confirmed first and the codebook
   was refused, confirming the codebook now replaces the questionnaire's labels with the codebook's;
   the tab lists any difference.
5. **Screens:** the panel reads when it comes into view and on Refresh; a late response for an earlier
   request is dropped (request token). It is keyed by the data file.
6. **Proof:** see below.

## Tests that fail without the change

- `labelOverlay.test.ts`: 4 of 8 fail on the old code (precedence both orders, conflict, unknown source).
- `instrumentTwoSources.db.test.ts`: 3 of 3 LBL-01 cases fail on the old code (the second document's
  suggestion, Confirm and hand choice were refused; labels came from whichever was confirmed).
- Retained IR-04 tests (`instrumentConfirmCollision`, `instrumentFamilyLink`, `instrumentManualLink`)
  still pass: the rule inside one document is unchanged.
- Browser: `label-documentation.check.mjs` (codebook and XLSForm questionnaire disagreeing on party_reg;
  both confirm; the tab shows sources, the disagreement, an undocumented variable and an entry with no
  column; a table uses the codebook's labels).

## Bugs that got through, and why

- `uploadPurposes.test.ts` still expected the type list without Codebook and "codebook.xlsx" as raw
  data: b38 ran targeted tests only and the full library run caught it. Fixed, with cases for codebook,
  data dictionary, JSON and spreadsheet questionnaires. Also fixed: "questionnaire responses.xlsx" would
  have been suggested as a questionnaire; a name saying responses, answers, data, results or export
  stays raw data.
- `codebook.check.mjs` closed the Add files dialog with Escape and added the file again; the dialog keeps
  its files, so the second add listed it twice. The check now uploads from the dialog it opened.

## Gates (run on 0e68215, Linux, local disposable stack)

| Gate | Result |
| --- | --- |
| Typecheck | `npx tsc --noEmit -p .` exit 0 |
| Lint | `npx eslint src e2e --quiet` exit 0 |
| Engine self-test | `python3 scripts/crosstab_selftest.py` exit 0, all checks passed |
| Full library, real disposable PostgreSQL 16 | `npx vitest run src/lib/__tests__ --pool=forks`: 243 files passed, 1 skipped; **1,816 passed / 73 skipped** |
| Full browser suite, one worker, production build | **117 passed / 1 skipped**, 0 failed (24.6 min) |
| Golden-thread smoke | 1 passed |
| New and changed checks first | label-documentation, codebook, analytics-posted-unknown: 3 passed |

After the run, one wording fix ("1 entry", not "1 entries") on the Labels tab; lint and typecheck rerun.
Models are replayed; nothing ran against a live database, storage or model. Windows was not run here
(V-B35-01 and V-B35-02 need Codex's Windows run).

## Apply

1. Apply migration `0118_codebook_instrument_type.sql` (adds 'codebook' to the instrument type check).
2. `pip install -r requirements.txt` (adds pyreadr 0.5.8 and fastparquet 2026.9.0 for R and Parquet).
3. Restart `next dev` so the statistics worker picks up the new engine actions (it also restarts by
   itself when its script changes).

## Limitations

- Disagreements are about answer labels; a different variable label between a codebook and a
  questionnaire is expected (short label against full question) and is not reported.
- Disagreements between the data file's own answer labels and a linked document are not compared
  (the dictionary records only that the file has labels).
- The tab lists at most 300 variables at a time (search and filter reach the rest) and 200 codebook
  entries with no column.
- Negatively phrased items: planned in step 3 (claude/codebook-import.md), not built.
