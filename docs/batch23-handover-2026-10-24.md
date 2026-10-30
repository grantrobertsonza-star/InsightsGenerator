# Handover: DI-F01 to DI-F07 (main copy), 24 October 2026

Status: **implemented, ready for independent review.** Main copy, on top of batch22. Follows
`docs/independent-data-integrity-extension-review-main-2026-10-24.md`. **Migration 0114** (additive)
for Grant to apply. Nothing pushed or deployed.

| Commit | What | Kind |
|---|---|---|
| repair commit | DI-F01 to DI-F07; migration 0114 | correctness, security |
| docs commit | This handover and the status line | |

Contracts in `claude/output-set-integrity.md` (new).

## DI-F01 (S2): an output-set merge accepted another project's or tenant's destination

`mergeOutputSets` now locks both sets by id, run and tenant (in id order) and refuses unless both are
this run's; then checks clashes, moves documents with run, tenant and source set in the predicate, and
requires the emptied set's delete to remove one row. A source from another project is refused instead
of "moved 0". Documents already pointing at a set outside their project are left as they are.

## DI-F02 (S2): an unread output file had its reviewed findings retired

`loadSetFiles` now records files that should have a table but could not be read (download failed,
stored file missing, no table). `generateOutputFindings`: all such files unreadable fails, naming them,
with nothing retired; some unreadable keeps their findings and replaces only the readable files'
(`keptFrom`, shown on the card: "<files> could not be read, so their earlier findings were kept. Make
findings again to read them."); all readable replaces all. Findings and checks are written in one
transaction.

## DI-F03 (S2): checks could overwrite another project's set or claim an unpersisted result

`checkOutputSet` and `generateOutputFindings` lock the owned set first. `storeChecks` writes with run
and tenant in the predicate inside that transaction and requires one changed row; any failure is an
error. Only migration 0062's absence returns `saved: false`, and the card says "These checks are shown
for this visit only: keeping them needs database migration 0062."

## DI-F04 (S2): set name and wave saves lost the winning wave or acknowledged no row

`saveOutputSetAction(runId, setId, name, waveLabel, opened)` locks the set, refuses with the stored
values when it is gone (or another project's or tenant's) or either value differs from `opened`, and
requires one changed row. The card keeps what it last knew stored, sends it, and on a refusal shows
"Stored now: <name>, wave <label>" with "Use current values" and "Replace with mine".

## DI-F07 (S2): retiring a finding dropped its researcher note

Migration 0114 (`supabase/migrations/0114_finding_history_researcher_note.sql`) adds
`finding_history.researcher_note`; `archiveAndReplaceFindings` copies it. Before 0114, retiring a
finding with a non-blank note is refused (naming the migration) and rolls back; findings without notes
retire as before. The History table shows "Your note: ..." under the finding, and the history CSV has a
last column "Researcher note". Notes already lost are not recoverable; nothing is back-filled. This
applies to every caller of the shared archive (report rereads, output findings, wave comparisons,
reprocessing).

## DI-F05 (S3): processing status reported true when no row was updated

`markDocumentProcessingStatus` has the tenant in the predicate and returns true only when one row was
updated. The page's and coding actions' messages for an unsaved status now say "the document may have
been removed, or a database migration is pending"; the comment describes both.

## DI-F06 (S3): renaming reported success with nothing saved, or overwrote a newer name

`renameRun(runId, name, opened)` locks the run by id and tenant and returns a result: refused when the
project is gone, the name is blank, or the stored name differs from `opened` (with the stored name);
one changed row required. `RenameRunButton` sends the stored name it opened from, keeps the typed name
on a refusal and shows "Stored now", "Use current name" and "Replace with mine"; it closes only after a
confirmed rename.

## Files

- `src/lib/outputAnalysisRun.ts`: set lock, merge, unreadable files, checks storage.
- `src/lib/outputSetActions.ts`: label save with opened values; results carry `saved` and `keptFrom`.
- `src/app/runs/[id]/OutputSetCard.tsx`: conflict panel, not-saved and kept notices.
- `src/lib/findingArchive.ts`: history note; pre-0114 refusal.
- `src/app/runs/[id]/page.tsx`: history note shown; status messages.
- `src/app/api/runs/[id]/history/export/route.ts`: "Researcher note" column.
- `src/lib/documentUpload.ts`, `src/lib/codingAnalysisActions.ts`, `src/lib/extractThemes.ts` (comment): status.
- `src/lib/runActions.ts`, `src/app/RenameRunButton.tsx`, `src/app/page.tsx`: rename.
- `supabase/migrations/0114_finding_history_researcher_note.sql` (new).
- Tests: `src/lib/__tests__/dataIntegrityDI.db.test.ts` (12, new); `findingArchive.test.ts` (3 new cases,
  mock answers the note checks); `helpers/fakeFindingsDb.ts` (answers the note checks);
  `e2e/ui/stale-label-editors.check.mjs` (new).
- Docs: `claude/output-set-integrity.md` (new), this handover.

## Checks run

Fresh disposable PostgreSQL 16 (port 55432) and a fresh disposable application stack (production
`next build --webpack`, `next start`, every migration including 0113 and 0114 applied to its
throwaway database); no development or live database, storage or provider.

- `npx tsc --noEmit`: exit 0. `eslint` on the changed files: 0 errors, 0 warnings.
- **Full library suite, final tree** (`07e2b6d`; only documentation follows),
  `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: **exit 0, 1,698 passed,
  0 failed, 72 skipped**, 223 files passed and 1 skipped, 437.8s.
  The first full run, on the repair tree `0cccbf6`, failed 15 tests in two mocked-client files
  (`findingArchive.test.ts`, `reportImportCompletion.test.ts` through `helpers/fakeFindingsDb.ts`): their
  fake clients did not answer the new history-note column check. Test-only; both mocks now answer it,
  and `findingArchive.test.ts` gained three cases for the note (copied; refused before 0114; no-note
  rows retire before 0114).
- `dataIntegrityDI.db.test.ts`: 12 passed.
- New browser check `stale-label-editors`: **passed** (two pages: a stale rename refused with the stored
  name, then replaced deliberately; a stale wave label refused with the stored values, then the current
  values taken).
- **Full browser suite** on the repair tree `0cccbf6` (later commits change only tests and documents):
  **104 passed, 0 failed, 1 skipped** (the real-model quality check), 28.1 min.
- Golden-thread smoke: **1 passed**.

Mutation checks (each fix removed, `dataIntegrityDI.db.test.ts` rerun, then restored): F01 ownership
check removed, F02 unreadable files archived again, F02 all-unreadable refusal removed, F03 old storage
(by id, failure swallowed) with the set lock removed, F04 compare removed, F05 always true, F06 compare
removed, F07 note column not copied: **each makes its own test fail** (1, 1, 1, 2, 1, 1, 1 and 1 of 12
respectively), the others still pass.

## Migration and compatibility

Apply `0114_finding_history_researcher_note.sql` (one nullable column). Before it: retiring a finding
that has a researcher note is refused with a message naming the migration; everything else works, and
the History table and CSV show no note. Migration 0113 (batch22) is separate.

## Limits

- Existing documents whose output set belongs to another project are not repaired or removed.
- Notes lost from history before 0114 cannot be recovered.
- Storage is controlled in the library tests; the browser check covers the two editors, not unreadable
  output files.
