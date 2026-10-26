-- Evidence per data set. A project can hold several data files, so each
-- evidence question is answered once for every data file and the answers are
-- combined afterwards (supports in one file and against in another gives
-- mixed). A file that has no variable for the question answers "silent",
-- which is a result, not an error. Needs 0066 first.
-- Run npm run backup before applying.

create table if not exists objective_evidence_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  evidence_id uuid not null references objective_evidence(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  dataset_name text not null,
  table_id uuid references document_tables(id) on delete set null,
  stance text check (stance in ('supports', 'against', 'mixed', 'inconclusive', 'silent')),
  basis text check (basis in ('computed', 'judged')),
  estimate jsonb,
  summary text,
  error text,
  evaluated_at timestamptz not null default now(),
  unique (evidence_id, document_id)
);

create index if not exists objective_evidence_results_run_idx on objective_evidence_results (run_id);

alter table objective_evidence_results enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'objective_evidence_results' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on objective_evidence_results
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;

-- Carry over answers already stored on the question rows (one data file each).
insert into objective_evidence_results
  (tenant_id, run_id, evidence_id, document_id, dataset_name, table_id, stance, basis, estimate, summary, error, evaluated_at)
select e.tenant_id, e.run_id, e.id, e.document_id, d.source_filename, e.table_id, e.stance, e.basis, e.estimate, e.summary, e.error,
       coalesce(e.evaluated_at, now())
  from objective_evidence e
  join documents d on d.id = e.document_id
 where e.document_id is not null and (e.stance is not null or e.error is not null)
on conflict (evidence_id, document_id) do nothing;
