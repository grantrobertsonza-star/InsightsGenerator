# Deleting a project

Codex release audit RR-F03 (2026-10-23); migration `0110_project_storage_cleanup.sql`.

A project's database rows cascade from `runs`, so the list of its storage files has to live where
it does not cascade: `project_storage_cleanup` (tenant-scoped, RLS, no foreign key to `runs`).

`runActions.deleteRun`, one transaction:

1. Refuses, deleting nothing, when 0110 is missing (the message names it) or the project is not
   this organisation's.
2. Locks the project row (`for update`). Uploads take the same lock between storing a file and
   recording its document, so no recorded file can be added after the next step's read; an upload
   that starts after the delete finds no project and stores nothing.
3. Lists every path the project's rows name (`projectStoragePaths`): each document's
   `storage_path` and `preview_storage_path`, and the paths of pending single-document cleanups
   (`document_storage_cleanup_pending`, which would otherwise cascade away).
4. Records them in `project_storage_cleanup`, then deletes the project.

Then `finishProjectStorageCleanup` removes the files: under a row lock (`skip locked`, so two
retries never work on one record), it leaves a path another document in the organisation still
names, keeps any path outside `<tenant>/` on the record with an error (not removed, not
forgotten), and removes the rest. A storage error or a thrown call is recorded on the record
(`attempts`, `last_error`, `last_attempt_at`); the record is deleted only after storage reports no
error. Removing an object that is already gone is not an error, so a retry is safe. A failed
record delete rolls back and the next retry repeats the (idempotent) removal.

`deleteRun` returns `{ ok: true, cleanupPending }` or `{ ok: false, error }`; the dashboard's
Delete button shows a refusal beside it. The dashboard (`ProjectCleanupNotice`) lists deleted
projects whose files are still in storage, with the last error and "Remove them now"
(`retryProjectStorageCleanup`), or says the list could not be read.

Not covered: objects stored under the project's folder that no row names (none are known: every
upload records its path before or as it stores the file); a retention deadline (removal happens
at delete and on retry, not on a schedule); organisation deletion.

Tests: `releaseAuditRepairs.db.test.ts` (success removes source, preview and a pending
single-document path; storage error then thrown call then success; another organisation's or an
unknown project refused; a still-named path kept and an outside path recorded; refusal without
0110) and `e2e/ui/project-delete-storage.check.mjs` (outage: project gone, notice with the error,
file still stored, record kept after reload; retry removes file, notice and record).
