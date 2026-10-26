-- IMP-008: one logical import per file per project, enforced by the database.
--
-- A retried batch upload (the researcher re-picks the whole batch after a partial failure, or
-- resubmits after a lost response) stored every already-successful file again as a NEW document,
-- which then fed findings and tables twice - double counting. The upload path now records each
-- file's SHA-256 and refuses a second copy of the same content as the same kind in the same
-- project; this partial unique index makes that hold even when two retries race.
--
--   documents.content_sha256   hex SHA-256 of the uploaded bytes. Null for documents uploaded
--                              before this migration (no back-fill: their bytes live in storage,
--                              not here), so a legacy document is not recognised as a duplicate.
--
-- Additive and idempotent. A different kind (the same file uploaded once as a report and once as
-- a table) and a different project are not duplicates.

alter table documents add column if not exists content_sha256 text;

comment on column documents.content_sha256 is
  'IMP-008: hex SHA-256 of the uploaded bytes (null before 0098). Unique per (run, kind) when set.';

create unique index if not exists documents_run_kind_content_uidx
  on documents (run_id, kind, content_sha256)
  where content_sha256 is not null;
