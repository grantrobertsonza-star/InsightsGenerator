# Output sets, retired findings, status and names: integrity contracts

Codex data-integrity extension, DI-F01 to DI-F07 (2026-10-24).

## Output sets (`src/lib/outputAnalysisRun.ts`, `src/lib/outputSetActions.ts`)

- **Ownership (DI-F01, DI-F03).** Every entry point locks the set by id, run and tenant
  (`lockOwnedSet`, `for update`) before reading or writing, and refuses "That output set is not in this
  project" otherwise. Merging locks both sets in id order (no deadlock between two merges of a pair),
  refuses unless both are this run's and this tenant's, then checks clashes, moves the documents
  (`run_id`, `tenant_id` and source set in the predicate) and requires the emptied set's delete to
  remove one row. Documents already pointing at a set outside their project are left as they are.
- **Stored checks (DI-F03).** Written in the locked transaction with run and tenant in the predicate;
  the write must change one row. Only migration 0062's absence (no `checks` column, checked through
  `information_schema`) returns `saved: false`, and the card says the checks are shown for this visit
  only. Every other failure is an error, never a stored-looking result.
- **Unreadable files (DI-F02).** A file that should have a table (a table extension, a table kind and
  a stored copy) whose table could not be read is unreadable. Policy:
  - every such file unreadable: nothing is retired or written; the action fails naming the files;
  - some unreadable: the readable files' findings are replaced; the unreadable files keep their
    findings, are listed in the stored checks' `unread`, and the card says "<files> could not be read,
    so their earlier findings were kept. Make findings again to read them." (`keptFrom`);
  - all readable: every file's findings are replaced, as before.
  Findings and checks are written in one transaction.
- **Name and wave label (DI-F04).** `saveOutputSetAction(runId, setId, name, waveLabel, opened)`: the
  set is locked; the save is refused with the stored values when the set is gone (or another
  project's or tenant's) or either value differs from `opened`; a save must change one row. The card
  keeps what it last knew stored as `opened`, shows "Stored now: <name>, wave <label>" with "Use
  current values" and "Replace with mine". The wave label is copied into findings made later, so a
  stale save would mis-attribute them.

## Finding history keeps the researcher note (DI-F07)

`findingArchive.archiveAndReplaceFindings` (rereads, regenerated output findings, wave comparisons)
copies `researcher_note` into `finding_history` (migration 0114). Before 0114, retiring a finding that
has a non-blank note is refused with a message naming the migration and the transaction rolls back;
findings without a note retire as before. The History table shows the note under the finding ("Your
note: ...") and the history CSV has a last column "Researcher note" (last, so the earlier columns keep
their places). Both read it through `to_jsonb(fh)->>'researcher_note'`, so they work before 0114.
Notes lost before this change are not recoverable; nothing is back-filled.

## Processing status (DI-F05)

`markDocumentProcessingStatus` returns true only when this tenant's document row was updated (tenant
in the predicate, row count checked). False covers a pending migration and a document that is gone
(for example removed while being processed); the callers' messages name both.

## Project rename (DI-F06)

`renameRun(runId, name, opened)` locks the run by id and tenant, refuses a gone project, a blank name,
and a name changed since the editor opened (with the stored name), and requires one changed row. The
rename control keeps the typed name on a refusal, shows "Stored now", "Use current name" and "Replace
with mine", and closes only after a confirmed rename.

## Tests

`src/lib/__tests__/dataIntegrityDI.db.test.ts` (real PostgreSQL, actual actions and the history CSV
route; storage controlled): every finding above, including foreign-tenant and other-project cases, a
write fault and retry for the checks, and the pre-0114 refusal. Browser:
`e2e/ui/stale-label-editors.check.mjs` (two pages: rename and output-set wave label).
