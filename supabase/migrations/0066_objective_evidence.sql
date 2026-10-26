-- Evidence for and against each research objective, read straight from the
-- data file. One row per evidence question. An objective is broken into a few
-- questions (what is measured, for whom, and what result would support or
-- undermine the objective). Each question is answered with a table built by
-- the same engine as every other crosstab, and the result is read as a stance.
-- No significance is needed: an estimate with its interval, a comparison, or a
-- level against a stated threshold all count. "silent" is a real result.
-- Run npm run backup before applying. Needs 0059 first.

-- Tables built only to answer an evidence question are kept out of the draft
-- set (they must not be committed into findings) but stay traceable.
alter table document_tables drop constraint if exists document_tables_crosstab_status_check;
alter table document_tables
  add constraint document_tables_crosstab_status_check
  check (crosstab_status is null or crosstab_status in ('draft', 'committed', 'evidence'));

create table if not exists objective_evidence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  document_id uuid references documents(id) on delete cascade,
  item_kind text not null check (item_kind in ('objective', 'decision')),
  item_order int not null,
  item_text text not null,
  -- The question as the researcher would read it, and the plain-English table request.
  question text not null,
  request_text text not null,
  -- In words: what result would support the objective, and what would undermine it.
  supports_if text not null default '',
  against_if text not null default '',
  -- Machine-readable expectation when the result can be judged in code
  -- ({kind, answer, direction, threshold, margin, groupA, groupB}); null means judged by the model.
  expectation jsonb,
  -- auto: made by the app. edited: the researcher changed it. manual: added by the researcher.
  source text not null default 'auto' check (source in ('auto', 'edited', 'manual')),
  excluded boolean not null default false,
  table_id uuid references document_tables(id) on delete set null,
  stance text check (stance in ('supports', 'against', 'mixed', 'inconclusive', 'silent')),
  -- computed: decided in code from the numbers. judged: read by the model and labelled as a judgement.
  basis text check (basis in ('computed', 'judged')),
  estimate jsonb,
  summary text,
  error text,
  evaluated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists objective_evidence_run_idx on objective_evidence (run_id);

alter table objective_evidence enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'objective_evidence' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on objective_evidence
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
