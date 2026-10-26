-- Analytic memos for qualitative coding. A memo is free text the researcher
-- writes while analysing: an analytic thought, a note on their own stance
-- (reflexivity), or a record of a coding decision and why it was taken.
-- Keyed by code NAME (code_key) like coding_code_meta, so it follows the code
-- across codebook versions. document_id is null for a project-wide memo.
-- Additive. Requires 0043.

create table if not exists coding_memos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  document_id uuid references documents(id) on delete cascade,
  code_key text,
  kind text not null default 'analytic' check (kind in ('analytic', 'reflexivity', 'decision')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists coding_memos_run_idx on coding_memos (run_id, created_at desc);

alter table coding_memos enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'coding_memos' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on coding_memos
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
