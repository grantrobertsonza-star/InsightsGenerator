-- The research assistant's chat history for a run: a lightweight, persisted
-- back-and-forth a researcher can use to ask questions about this run's
-- evidence, or ask for a specific edit to the generated Insights Report
-- narrative, without leaving the run page. Scoped to one run, not kept
-- globally per tenant, so each project's conversation only ever sees that
-- project's own evidence -- same reasoning as every other run-scoped table
-- here.
create table if not exists assistant_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists assistant_messages_run_id_idx on assistant_messages (run_id, created_at);

alter table assistant_messages enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'assistant_messages' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on assistant_messages
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
