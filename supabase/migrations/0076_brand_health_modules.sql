-- Brand Health module: the variable-mapping a user sets up for a data file (the brand variable,
-- which coded brand is "ours", the funnel/attribute/loyalty/moment/positioning variables), so it
-- can be reopened without re-dragging variables every time. Mirrors csm_modules (0075).
-- Run npm run backup before applying.

create table if not exists brand_health_modules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  mapping jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id)
);

create index if not exists brand_health_modules_run_idx on brand_health_modules (run_id, created_at);

alter table brand_health_modules enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'brand_health_modules' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on brand_health_modules
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
