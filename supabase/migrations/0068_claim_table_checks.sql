-- A stated claim checked against tables with no raw data (the validate path).
-- Tier a: does the stated figure match the table, within rounding?
-- Tier b: does the stated comparison or level hold when re-derived from the
-- percentages and bases in the table? One row per check per table, so a claim
-- checked against several data sets keeps a result for each one.
-- "silent" is a real result: no table speaks to the claim, or a base is missing.
-- Run npm run backup before applying.
create table if not exists claim_table_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  finding_id uuid not null references findings(id) on delete cascade,
  -- The data set (document) the table belongs to, kept with its name so a later rename or delete does not blur the record.
  document_id uuid references documents(id) on delete set null,
  dataset_name text,
  table_id uuid references document_tables(id) on delete set null,
  table_label text,
  tier text not null check (tier in ('a', 'b')),
  check_kind text not null check (check_kind in ('locate', 'stated_figure', 'level_vs_threshold', 'two_group_gap')),
  stance text not null check (stance in ('supports', 'against', 'mixed', 'inconclusive', 'silent')),
  summary text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists claim_table_checks_run_idx on claim_table_checks (run_id);
create index if not exists claim_table_checks_finding_idx on claim_table_checks (finding_id);

alter table claim_table_checks enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'claim_table_checks' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on claim_table_checks
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
