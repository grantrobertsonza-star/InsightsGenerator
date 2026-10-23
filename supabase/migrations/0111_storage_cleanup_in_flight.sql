-- Converted copies tracked before they exist (Codex batch12 RR-F03, 2026-10-23). The remote
-- statistics parser writes a converted copy of a data file (`<storage path>.converted.json`),
-- respondent-level data, which the app removes after reading. A record of it is now written
-- before the parser is asked, in project_storage_cleanup (0110), which does not cascade from the
-- project, so a project deleted while the parser is working, or a removal that fails after the
-- project is gone, still leaves a record to retry. Requires 0110. Additive: existing rows are
-- deleted projects' files, as before. Without it, project deletion and reading a data file through the
-- remote parser are refused with a message naming this migration (nothing deleted, nothing read);
-- the local parser writes no converted copy.
alter table project_storage_cleanup
  add column if not exists kind text not null default 'deleted_project';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'project_storage_cleanup_kind_check') then
    alter table project_storage_cleanup
      add constraint project_storage_cleanup_kind_check check (kind in ('deleted_project', 'converted_copy'));
  end if;
end $$;
-- While set and in the future, the parser may still be writing the copy: a retry leaves the record
-- alone until then, so the copy cannot be removed before it is written and the record lost.
alter table project_storage_cleanup
  add column if not exists in_flight_until timestamptz;
