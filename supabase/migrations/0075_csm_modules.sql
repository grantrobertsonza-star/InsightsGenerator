-- CSM Analytics module: the variable-mapping a user sets up for a data file (overall
-- satisfaction, attributes with their box-cut metric, loyalty/NPS, segmentation), so it
-- can be reopened without re-dragging variables every time.
-- Run npm run backup before applying.

create table if not exists csm_modules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  mapping jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id)
);

create index if not exists csm_modules_run_idx on csm_modules (run_id, created_at);

alter table csm_modules enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'csm_modules' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on csm_modules
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
