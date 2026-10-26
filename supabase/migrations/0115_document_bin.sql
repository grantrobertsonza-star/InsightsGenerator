-- Removing a file puts it in the project's bin for 30 days (Grant, 2026-10-25;
-- claude/document-deletion-contract.md). Additive; existing rows are unaffected.
--
-- 1. The bin is a hidden run attached to the project (runs.bin_of). A removed file, and every row of
--    its own material that carries a run (imported tables, coding, analyses, instrument items and
--    links, objective evidence), is moved into it, so no project query sees it, and moved back on
--    restore. Deleting the project deletes its bin (cascade).
-- 2. documents.removed_* record who removed it, when, and from which project.
-- 3. document_removals keeps, for each removal, a full copy of what removing the file deleted from
--    the project's research (its findings and what hangs on them), so a restore puts back the same
--    rows under the same ids; and the counts the researcher was shown.
-- 4. objective_candidates.source_document_ids and decision_candidates.source_document_ids record which
--    files a suggestion was drawn from (null: not known), so an unreviewed suggestion drawn only from a
--    removed file can be removed with it, and a kept one can say a source was removed.
-- 5. finding_history accepts the archive reason 'source_removed'.

alter table runs add column if not exists bin_of uuid references runs(id) on delete cascade;
create unique index if not exists runs_bin_of_uidx on runs (bin_of) where bin_of is not null;

alter table documents add column if not exists removed_at timestamptz;
alter table documents add column if not exists removed_by uuid;
alter table documents add column if not exists removed_from_run uuid references runs(id) on delete cascade;
create index if not exists documents_removed_from_idx on documents (removed_from_run) where removed_from_run is not null;

create table if not exists document_removals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  filename text not null,
  removed_at timestamptz not null default now(),
  removed_by uuid,
  -- Full rows (to_jsonb) of what the removal deleted from the project, restored as they were.
  snapshot jsonb not null,
  -- What the researcher was told and what was actually done.
  counts jsonb not null,
  restored_at timestamptz
);
create index if not exists document_removals_run_idx on document_removals (run_id, removed_at desc);
alter table document_removals enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'document_removals' and policyname = 'tenant_isolation') then
    create policy tenant_isolation on document_removals using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;

alter table objective_candidates add column if not exists source_document_ids uuid[];
alter table objective_candidates add column if not exists source_removed_at timestamptz;
alter table decision_candidates add column if not exists source_document_ids uuid[];
alter table decision_candidates add column if not exists source_removed_at timestamptz;

alter table finding_history drop constraint if exists finding_history_archived_reason_check;
alter table finding_history
  add constraint finding_history_archived_reason_check
  check (archived_reason in ('regenerate_unreviewed', 'full_reprocess', 'manual_reextract', 'wave_recompare', 'source_removed'));
