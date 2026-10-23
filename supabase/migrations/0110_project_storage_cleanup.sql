-- Files of a deleted project still to be removed from storage (Codex RR-F03, 2026-10-23). Deleting
-- a project removes its database rows (documents and everything else cascade from runs), so the
-- list of its storage objects has to live in a table that does not cascade from runs: the row is
-- written in the same transaction that deletes the project and removed only once storage confirms
-- the removal. Until then the dashboard shows it with a retry. Requires 0001 (tenants). Additive:
-- without it, deleting a project is refused with a message naming this migration.
create table if not exists project_storage_cleanup (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id),
  -- The deleted project's id: kept for identity and for checking each path's folder, with no
  -- foreign key, because the project is gone.
  run_id uuid not null,
  project_name text,
  storage_paths text[] not null check (cardinality(storage_paths) > 0),
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  last_attempt_at timestamptz
);

create index if not exists project_storage_cleanup_tenant_idx on project_storage_cleanup (tenant_id, created_at);

alter table project_storage_cleanup enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'project_storage_cleanup' and policyname = 'tenant_isolation') then
    create policy tenant_isolation on project_storage_cleanup
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
