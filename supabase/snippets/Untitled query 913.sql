-- Statistical output (models, cluster results, diagnostics, run logs). A zip or
-- a batch of files uploaded together becomes one "output set": a named group of
-- files from the same study, optionally labelled with a wave. Each file is a
-- document of kind 'output' with what it appears to be (role and kind), read
-- from its headers, a few rows and its name. Nothing here is a finding yet.
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'documents'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%'
      and pg_get_constraintdef(oid) like '%transcript%'
  loop
    execute format('alter table documents drop constraint %I', c);
  end loop;
end $$;

alter table documents
  add constraint documents_kind_check
  check (kind in ('report', 'table', 'evidence', 'transcript', 'instrument', 'output'));

create table if not exists output_sets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  name text not null,
  wave_label text,
  -- 'zip' or 'files'
  source text not null default 'files',
  created_at timestamptz not null default now()
);
create index if not exists output_sets_run_idx on output_sets (run_id);

alter table documents add column if not exists output_set_id uuid references output_sets(id) on delete set null;
-- Path inside the zip, so folders keep meaning ("robustness_final/04_x.csv").
alter table documents add column if not exists output_path text;
alter table documents add column if not exists output_family text;
alter table documents add column if not exists output_role text
  check (output_role is null or output_role in ('evidence', 'assurance', 'provenance', 'unclassified'));
alter table documents add column if not exists output_kind text;
-- {headers, rowCount, sample, numericColumns, sheets?, textLength?, confidence, signals}
alter table documents add column if not exists output_profile jsonb;
create index if not exists documents_output_set_idx on documents (output_set_id);

alter table output_sets enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'output_sets' and policyname = 'tenant_isolation') then
    create policy tenant_isolation on output_sets using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
