-- UA1: separate U&A researcher choices. 0134 through 0139 are reserved by the integration brief.
-- Additive and idempotent. Grant applies this migration after review, never this implementation task.
create table if not exists ua_dashboards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid references runs(id) on delete cascade,
  program_id uuid references programs(id) on delete cascade,
  revision integer not null default 1 check (revision >= 1),
  choices jsonb not null default '{}'::jsonb check (jsonb_typeof(choices) = 'object'),
  choices_by text,
  choices_at timestamptz not null default now(),
  check ((run_id is null) <> (program_id is null))
);
create unique index if not exists ua_dashboards_project_idx on ua_dashboards (tenant_id, run_id) where run_id is not null;
create unique index if not exists ua_dashboards_program_idx on ua_dashboards (tenant_id, program_id) where program_id is not null;
alter table ua_dashboards enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ua_dashboards' and policyname='tenant_isolation') then
    create policy tenant_isolation on ua_dashboards using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
