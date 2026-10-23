# Deleting a project

Codex release audit RR-F03 (2026-10-23); migrations `0110_project_storage_cleanup.sql` and
`0111_storage_cleanup_in_flight.sql` (adds `kind` and `in_flight_until`).

A project's database rows cascade from `runs`, so the list of its storage files has to live where
it does not cascade: `project_storage_cleanup` (tenant-scoped, RLS, no foreign key to `runs`).

`runActions.deleteRun`, one transaction:

1. Refuses, deleting nothing, when 0110 or 0111 is missing (the message names it) or the project is not
   this organisation's.
2. Locks the project row (`for update`). Uploads take the same lock between storing a file and
   recording its document, so no recorded file can be added after the next step's read; an upload
   that starts after the delete finds no project and stores nothing.
3. Lists every path the project's rows name (`projectStoragePaths`): each document's
   `storage_path` and `preview_storage_path`, each source's converted copy
   (`documentStorageCleanup.convertedCopyPath`, `<storage path>.converted.json`, see below), and the
   paths of pending single-document cleanups (`document_storage_cleanup_pending`, which would
   otherwise cascade away).
4. Records them in `project_storage_cleanup`, then deletes the project.

Then `finishProjectStorageCleanup` removes the files: under a row lock (`skip locked`, so two
retries never work on one record), it leaves a path another document in the organisation still
names (and, on a deleted project's record, that path's converted copy), skips a record still in
flight (below), keeps any path outside `<tenant>/` on the record with an error (not removed, not
forgotten), and removes the rest. A storage error or a thrown call is recorded on the record
(`attempts`, `last_error`, `last_attempt_at`); the record is deleted only after storage reports no
error. Removing an object that is already gone is not an error, so a retry is safe. A failed
record delete rolls back and the next retry repeats the (idempotent) removal.

`deleteRun` returns `{ ok: true, cleanupPending }` or `{ ok: false, error }`; the dashboard's
Delete button shows a refusal beside it. The dashboard (`ProjectCleanupNotice`) lists records whose
removal storage has not confirmed, counted as storage locations, not files (Codex RR-M02): a
deleted project's record lists every place its files could be, including a converted copy that may
never have been made. Each item reads "Deleted project X: N storage locations" or "A converted copy
of a data file in X", with the last error and "Remove them now"
(`retryProjectStorageCleanup`), or says the list could not be read.

## Converted copies (Codex RR-F03, batch10 and batch12 reviews)

The remote statistics parser (`api/parse-stats-file.py`, used on Vercel) writes a converted JSON copy
of a data file next to it, `<storage path>.converted.json`, which is respondent-level data.

`parseStatsFile`:

1. Before asking the parser, records the copy (`projectStorageCleanup.beginConvertedCopy`): a
   `project_storage_cleanup` row of kind `converted_copy` with `in_flight_until` = now + 15 minutes
   (`CONVERTED_COPY_IN_FLIGHT_MS`; the parser function's limit is 60 s in `vercel.json`). The
   row does not cascade from the project. When it cannot be written (the path is in no project's
   folder, the project is gone, 0111 is missing, the database fails) the parser is not asked and the
   read fails with that reason.
2. Accepts only the expected location in the parser's reply; any other is refused and nothing is
   removed for it.
3. Once the parser has answered (any HTTP response), removes the copy and deletes its row in a
   `finally` (`finishConvertedCopy`), whether the read worked or not. A failed or thrown removal
   keeps the row, clears `in_flight_until` and records the error, so the dashboard lists it with
   "Remove them now". A failure to update the row is logged without contents; the row then stays in
   flight and becomes due after its time.
4. When the request fails without an answer, the parser may still write the copy, so the row is
   left in flight: neither listed nor retried until `in_flight_until` passes, then listed and
   removed by the retry. Nothing is "removed" before it is written and then forgotten.

A project deleted while the parser runs is therefore covered: deletion removes the copy's location
if it exists, and the in-flight row, which outlives the project, removes a copy written afterwards.
On a `converted_copy` row the copy is removed even when its source file is still named by a
document (the copy has no use once read); on a deleted project's row a copy is kept with its
still-named source. Deleting a document or a project also removes the copy by its derived path.
The local path (no remote parser) writes no converted copy; its temporary files are in
`claude/stats-cache.md`.

Limit: if this server process stops after the parser was asked and the parser runs longer than
the in-flight time, a retry could remove the location before the copy is written; the copy would
then be left with no record. The in-flight time is fifteen times the parser function's limit
(`vercel.json`, `maxDuration` 60 s), so this needs that limit raised towards it.

Not covered: objects stored under the project's folder that no row names (none are known: every
upload records its path before or as it stores the file); a retention deadline (removal happens
at delete and on retry, not on a schedule); organisation deletion.

Tests: `releaseAuditRepairs.db.test.ts` (success removes source, preview and a pending
single-document path; storage error then thrown call then success; another organisation's or an
unknown project refused; a still-named path kept and an outside path recorded; refusal without
0110 or 0111; the converted copy: in flight while the parser runs then removed with its row, a
reply naming another object refused, a project deleted mid-read with a failed removal kept and
retried, no answer kept in flight until due, a still-named source's copy removed, the parser not
asked when the copy cannot be recorded) and `e2e/ui/project-delete-storage.check.mjs` (outage: project gone, notice with the error,
file still stored, record kept after reload; retry removes file, notice and record).
