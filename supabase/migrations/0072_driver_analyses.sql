-- Saved driver analyses (Analytics tab): the request, and the full result with its
-- warnings, so a ranking can be reopened and cited without recomputing.
-- Run npm run backup before applying.

create table if not exists driver_analyses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  title text not null,
  request jsonb not null,
  report jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists driver_analyses_doc_idx on driver_analyses (document_id, created_at);

alter table driver_analyses enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'driver_analyses' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on driver_analyses
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
