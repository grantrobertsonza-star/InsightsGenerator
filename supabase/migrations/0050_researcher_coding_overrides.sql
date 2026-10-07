-- Researcher changes to which themes sit on a turn, kept apart from what the
-- model assigned so exports can tell the two apart and a re-apply of the
-- codebook does not wipe them out.
--   * coding_assignments.source: who put the theme on the turn;
--   * coding_assignment_overrides: each manual add or remove, keyed by the
--     theme NAME (not its id) so it carries over to a new codebook version;
--   * coding_codes.added_by_researcher: a theme created by hand after coding.
-- Additive. Requires 0043.

alter table coding_assignments
  add column if not exists source text not null default 'model'
    check (source in ('model', 'researcher'));

alter table coding_codes
  add column if not exists added_by_researcher boolean not null default false;

create table if not exists coding_assignment_overrides (
  segment_id uuid not null references coding_segments(id) on delete cascade,
  code_key text not null,
  code_name text not null,
  action text not null check (action in ('add', 'remove')),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (segment_id, code_key)
);
create index if not exists coding_assignment_overrides_doc_idx
  on coding_assignment_overrides (document_id);

alter table coding_assignment_overrides enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'coding_assignment_overrides' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on coding_assignment_overrides
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
