# Output sets, retired findings, status and names: integrity contracts

Codex data-integrity extension, DI-F01 to DI-F07 (2026-10-24).

## Output sets (`src/lib/outputAnalysisRun.ts`, `src/lib/outputSetActions.ts`)

- **Ownership (DI-F01, DI-F03).** Checking, making findings, comparing waves and merging lock the set (or both sets, in id order) by id, run and tenant
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
- **Wave comparisons (DI-F02, batch21-23 review).** A comparison needs both waves read in full: any
  unreadable file in either set (the same read outcome) refuses the whole comparison, naming the files,
  before the earlier comparison's findings are archived ("<files> could not be read, so the waves were
  not compared and the earlier comparison's findings were kept"). Retrying once the files read replaces
  them, with their notes kept in history.
- **Name and wave label (DI-F04).** `saveOutputSetAction(runId, setId, name, waveLabel, opened)`: the
  set is locked; the save is refused with the stored values when the set is gone (or another
  project's or tenant's) or either value differs from `opened`; a save must change one row. The card
  keeps what it last knew stored as `opened`, shows "Stored now: <name>, wave <label>" with "Use
  current values" and "Replace with mine". The wave label is copied into findings made later, so a
  stale save would mis-attribute them. Names are kept to 120 characters and wave labels to 60 (the
  inputs cap them too); a save returns the values actually stored, which become the card's values and
  its next opened values (B23-F01: the card used to keep longer typed text and refuse its own next save).

## One selection, one set (B52-F01, batches 52R and 65; migration 0129)

`ingestOutputFiles` (`src/lib/outputIngest.ts`) owns grouping; `resolveOutputSet` decides the set for each request
inside its transaction, every query scoped by tenant and project.

- **Selection id.** The Add files dialog makes one id per selection of statistical output (the files chosen as
  Statistical output when Upload is pressed) before the first request, and sends it as `outputSelectionId` with every
  request carrying that selection's output. Unsent output files keep it after any failure, so the enabled retry
  sends it again without a reload. With 0129 (`output_sets.client_selection_id`, unique per tenant) the first request
  to arrive creates the set (`insert ... on conflict do nothing`) and every later or retried request joins it, even
  when no reply ever named the set. Two requests at once give one set.
- **Set id.** `outputSetId` (52R) is still sent once a reply named the set. With a selection id it must be that
  selection's set, otherwise "belongs to a different upload" and nothing is added. A set with no selection id (made
  before 0129) is claimed for the selection that names it, unless the selection already has a set.
- **Bin and other projects.** The selection id stays on a set moved to the bin, so a late request of that selection
  finds it there and is refused ("no longer in this project"); it never starts a replacement set. The same holds for
  a set in another project. Nothing is stored for a refused request.
- **Families** are recomputed over the whole set after every request of a selection.
- **Never merged by name.** Two selections are two sets whatever their file names. A known stored file is not sent
  again: a file whose request got no answer leaves the list, and the message says to reload and check.
- **Before 0129.** The selection id is ignored and the set id works as in 52R. When a request of the selection got no
  answer before any reply named the set, the dialog marks the rest `outputSelectionUnconfirmed`, and the server
  refuses them with "this server cannot find that set yet (database migration 0129 is not applied). Nothing was
  added, so no second set was started. Reload the page and check Sources, then choose the files that are missing and
  upload them; they will form a new set." Detected through `information_schema` (`outputSelectionIdentityAvailable`).
- **Limits.** Files chosen while the remaining files of a selection wait in the dialog join that selection when
  uploaded together, as in 52R. A selection whose set was merged into another set (Merge) and then retried after a
  lost reply starts a new set, because the merged set is deleted.

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
