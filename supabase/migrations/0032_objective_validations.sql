-- Closes the loop standard market-research reporting expects: every stated
-- research objective and confirmed decision gets an explicit disposition in
-- the final report (resolved, partially answered, or a named gap), rather
-- than insights surfacing through synthesis with no check that they
-- actually covered what the project set out to answer. See src/lib/
-- objectiveValidator.ts for how this gets populated.
--
-- One row per discrete objective/decision item (the researcher's
-- research_objective and decision_statement text each parsed into however
-- many numbered items it actually contains), not one row per run: a
-- project can have several research questions and/or several confirmed
-- decisions, and each deserves its own explicit conclusion. Regenerating
-- (same trigger as the Insights Report) deletes and re-inserts this run's
-- rows rather than upserting by some natural key, since the number and
-- wording of items can change between runs of the objective/decision
-- framers.
--
-- synthesized_insight_ids is deliberately many-to-many and may be empty:
-- a gap is exactly a row with no insights behind it, and one insight can
-- legitimately support several objectives/decisions at once (cross-cutting
-- evidence is common and shouldn't be forced into a single bucket, see the
-- doc comment on generateObjectiveValidation). The reverse case -- an
-- accepted synthesized insight that appears in no row's array at all -- is
-- not stored separately; it's computed by set difference against
-- synthesized_insights at read time (see story/export/route.ts), since
-- that's a property of what this table doesn't contain, not something it
-- needs its own column for.
create table if not exists objective_validations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  item_kind text not null check (item_kind in ('objective', 'decision')),
  item_order int not null,
  item_text text not null,
  status text not null check (status in ('resolved', 'partial', 'gap')),
  conclusion text not null,
  synthesized_insight_ids uuid[] not null default '{}',
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists objective_validations_run_id_idx on objective_validations (run_id);

alter table objective_validations enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'objective_validations' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on objective_validations
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
