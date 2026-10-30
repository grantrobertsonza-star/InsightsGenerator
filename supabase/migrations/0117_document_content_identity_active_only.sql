-- SYS5B-F04 (Codex, 2026-10-25): two copies of the same file may both be in a project's bin.
--
-- 0098 made (run, kind, content) unique so a retried upload cannot import the same file twice into a
-- project. Since 0115 a removed file moves into its project's bin, a run of its own, so the index also
-- refused a second identical copy there: after removing a file and uploading it again, the restore
-- message's own advice ("remove that copy first") failed, and the only way out was to erase the
-- original with its reviewed history. The rule is about files in use: removed files (removed_at set)
-- are excluded, so both copies can wait in the bin while the researcher chooses, and a copy in the
-- project is still unique there. Restore refuses to bring a copy back while the project has one
-- (documentBin.restoreDocumentFromBin). Requires 0115 (documents.removed_at).
drop index if exists documents_run_kind_content_uidx;
create unique index if not exists documents_run_kind_content_uidx
  on documents (run_id, kind, content_sha256)
  where content_sha256 is not null and removed_at is null;
