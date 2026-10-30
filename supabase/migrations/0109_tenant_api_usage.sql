-- Model usage that belongs to no project (2026-10-23): the Research assistant outside a project (the
-- dashboard, Programs, Knowledge base and Manual). Usage inside a project stays in trace
-- (event 'api_usage'), whose run_id is required. Requires 0001 (tenants). Additive: nothing else
-- reads or writes this table; without it the assistant still answers and the dashboard says the
-- usage needs this migration.
create table if not exists tenant_api_usage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  agent text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_creation_input_tokens bigint not null default 0,
  cache_read_input_tokens bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists tenant_api_usage_tenant_created_idx on tenant_api_usage (tenant_id, created_at);

alter table tenant_api_usage enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'tenant_api_usage' and policyname = 'tenant_isolation') then
    create policy tenant_isolation on tenant_api_usage
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
