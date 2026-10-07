-- Model-assisted check, per theme, of whether the later respondents added a
-- distinct dimension that the earlier ones had not expressed. One row per
-- theme, replaced on each check. The researcher reads the quotes and decides.
-- Requires 0043.
create table if not exists coding_meaning_checks (
  code_id uuid primary key references coding_codes(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  verdict text not null check (verdict in ('new_meaning', 'no_new_meaning', 'too_few_turns')),
  early_turns integer not null default 0,
  late_turns integer not null default 0,
  dimensions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table coding_meaning_checks enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'coding_meaning_checks' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on coding_meaning_checks
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
