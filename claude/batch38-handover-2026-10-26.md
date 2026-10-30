# Batch 38 handover: repairs for the batch 36 review (26 October 2026)

Base: laptop a942b3cf (Batch 37). Status: implemented, ready for review. Tier A (scripts/change-tier.cjs).
No migrations. The batch 36 review (Codex, commit fe1ff253) reported 3 S1, 2 S2 and 4 S3 findings. All
nine are repaired here, each with a retained test shown failing on the code before the fix. Batch 37
(evidence chain, migrations 0119 to 0122) has not been reviewed yet; review 37 and 38 together.

## Findings and repairs

| Finding | Repair | Rule owner | Test (fails before the fix) |
|---|---|---|---|
| B36-F01 S1: codebook code "1.0" saved as "1", so response "1" took the decimal code's label | Engine keeps codes as written (`_cb_code` returns `_cb_text`); matching against the data column decides identity. On a numeric column two codes for one value with different labels become an IMP-015 conflict label and a `meta.label_conflicts` entry, never a silent pick | `api/parse-stats-file.py` `_cb_code`, `_apply_overlay` | `codebookImport.db.test.ts` "keeps text codes as written": JSON, long CSV, long Excel and XLSForm; text column with "1.0", "1", "1e0", "AA"; numeric column collision; read, confirm, `loadCategories` |
| B36-F02 S1: Parquet Int64 beyond 2^53 collapsed (two ids became one) | `_r_and_parquet_frame` turns integer columns (nullable or not) with a value beyond 2^53 into exact text, the policy the delimited readers use (`_MAX_EXACT_WHOLE`) | `_beyond_exact_whole`, `_r_and_parquet_frame` | `dataFileFormats.db.test.ts` "whole numbers beyond 2^53": nullable, plain and safe-boundary columns, missing cell, stored preview, reread, categories |
| B36-F07 S1: a codebook giving one answer label was dropped, so the questionnaire's different label was used with no conflict | `resolveLabels`: the base map is the strongest source labelling two or more answers; every code a stronger source gives takes precedence for that code and a differing base label is a conflict; weaker sources are compared on shared codes; when every source labels one answer, none is applied and the tab says so | `src/lib/labelOverlay.ts` `resolveLabels` (LBL-01) | `labelOverlay.test.ts` (both orders, agreeing, only single-code, weaker single-code, zero options); `instrumentTwoSources.db.test.ts` (Codex's case through confirmation, overlay and the documentation, both orders); `label-documentation.check.mjs` (screen and built table) |
| B36-F03 S2: malformed CSV quoting merged rows and was saved as complete | Document grids read with `csv.reader(strict=True)`; malformed quoting is refused with its line before anything is stored | `_sheet_grids` | `codebookImport.db.test.ts` "refuses malformed quoting": unclosed then another variable (Codex's shape), text after a closing quote, unclosed at end of file; the earlier read, its items and its confirmed links unchanged after each refusal; valid multiline cell; recovery |
| B36-F04 S2: non-answer check missed labelled text codes ("DK") and SPSS user-missing codes | `_rq_non_answers` compares codes as identities (no numeric coercion) and honours declared missing values and ranges. For .sav/.zsav the check reads the file a second time with user-missing kept (`_rq_raw_answers`); the analysis read and its cache are unchanged | `respondent_quality`, `_rq_non_answers` | `respondentQuality.db.test.ts`: text "DK", declared 9, numeric 99 control; 10/10, 5/10 (50%, flagged), 4/10, 9 answers (below the minimum), none; denominators and median share; the analysis read still has the declared codes missing |
| B36-F05 S3: header plus one variable refused | Header naming variable and label columns accepted with one variable | `_cb_sheet_items` | `codebookImport.db.test.ts` "one-variable codebook": CSV, Excel, two variables; prose and a misleading table still refused |
| B36-F06 S3: a late Codebook save showed "Saved" beside newer unsaved edits | When edits were made after the save was sent (same panel or a remount), the message says "Your earlier change was saved. The edits you have made since are not saved yet." | `CodebookPanel.tsx` | `codebookSaveConfirmation.test.tsx` (mounted): late success after a remount, and in the same panel, then the newer edits save to a plain "Saved" |
| V-B36-01 S3: a fresh install picked python-calamine for .xls (pandas 3.1) and refused valid files | The engine names its workbook readers (`WORKBOOK_ENGINES`: openpyxl for .xlsx/.xlsm, xlrd for .xls). requirements.txt now declares `pandas>=2.3,<3.2` and `xlrd==2.0.2` (pandas 3.1 refuses xlrd 2.0.1). CI installs only requirements.txt | `_open_workbook` | `workbookReaderEngine.test.ts`: the actual engine with pandas' automatic choice made to fail as a fresh install does |
| V-B36-02 S3: LibreOffice exit 1 in the full parallel library run | Cause reproduced: four conversions at once on the shared default profile, two exit 1; on profiles of their own, four of four succeed. Every test conversion now uses a fresh profile (`helpers/officeRender.ts`), with exit code and output kept in the failure message. The product converter's profile is per process | `src/lib/convertToPdf.ts`; tests `helpers/officeRender.ts` | `officeRenderIsolation.test.ts`: four concurrent conversions; fails 2 of 4 without the private profile (run twice) |

Why the tests missed these: codebook tests used numeric columns and integer codes only; Parquet tests used
small ids; label-overlay tests always gave two or more codes per source; malformed quoting and
one-variable codebooks had no case; non-answer tests had numeric labelled codes only; the late-success
test asserted "Saved"; Office checks ran alone in development. Each family above now has the case.

## Impact checklist

1. **Rule.** LBL-01 in `labelOverlay.ts` (the one implementation used by calculations and the
   documentation tab); answer-code identity in the engine; respondent non-answers in `respondent_quality`.
   Contracts updated: `claude/codebook-import.md`, `claude/respondent-quality.md`.
2. **Inputs.** Ambiguous codes on a numeric column are shown as a conflict, not resolved. A source with one
   answer label is never the base and, alone, is reported as not applied. Malformed quoting is refused with
   a location. Unsupported workbook extensions are refused. A non-answer check with no labels or
   declarations is "not measured", never zero.
3. **Persistence.** No schema change. A refused reread stores nothing and leaves items and confirmed links
   as they were (test above).
4. **Freshness.** Tables built before keep their labels until rebuilt; a variable whose one-code codebook
   now takes precedence shows the codebook label in tables built from now on, and the disagreement in the
   Labels and documentation tab. Respondent checks are computed on demand.
5. **Screens.** Codebook late success qualified (mounted test). Labels tab note (screenshot below).
6. **Proof.** Below.

## Gates (worktree b45)

- Repairs commit 28038a2: full library `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`
  **250 files passed, 1 skipped; 1,859 passed, 78 skipped, 0 failed** (real disposable PostgreSQL and
  the local Python engine; storage, model and request context are mocked boundaries).
- Commit 8a5a8c3 (removes an unused test helper that failed typecheck; nothing else changed):
  `npx tsc --noEmit` ok; `npx eslint src e2e --quiet` ok; `python3 scripts/crosstab_selftest.py` all
  checks passed; `codebookImport.db.test.ts` 7 passed; full browser suite (production build, disposable
  stack) **119 passed, 1 skipped** (the live-model check); smoke **1 passed**; the four affected checks
  (label documentation, codebook, respondent quality, main recommendation exports) passed first.
- Fresh install (isolated venv from requirements.txt: pandas 3.1.0, xlrd 2.0.2, no python-calamine):
  engine self-test passed (scipy added only for the self-test's reference values); codebookImport,
  dataFileFormats, respondentQuality, oneReaderImport, workbookReaderEngine, instrumentTwoSources and
  crosstabSlides **47 passed, 1 skipped**.
- Not run here: Windows. V-B36-02's acceptance asks for a full passing declared gate on Windows.

## Changed files

Engine `api/parse-stats-file.py`; `src/lib/labelOverlay.ts`, `labelDocumentation.ts`,
`respondentQuality.ts`, `convertToPdf.ts`; screens `CodebookPanel.tsx`, `LabelDocumentationPanel.tsx`,
`RespondentQualityPanel.tsx` (wording: "labels them or declares them missing"); `requirements.txt`, both
CI workflows; tests listed above plus `crosstabSlides.test.ts`, `mainRecommendationExport.db.test.ts`,
`main-recommendation-exports.check.mjs` (fresh Office profiles); docs `codebook-import.md`,
`respondent-quality.md`, this handover.

## Limits

- Stata extended missing values (.a to .z) are not yet counted as declared non-answers.
- A conflict's "used from" line names the stronger document even where its single code is the only part
  taken from it; the per-variable note says which.
- R files go through the same frame step; R stores numbers as 32-bit integers or doubles, so the Parquet case was the reachable one. No separate R fixture beyond 2^53 was added.
