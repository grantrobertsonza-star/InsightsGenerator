-- Quality control at the objective and recommendation stages, alongside the
-- existing import checks and the synthesized insight scores.
--
-- Objectives: each numbered item of runs.research_objective is judged on
-- four adapted SMART dimensions, 1, 3 or 5 each (max 20): Specific,
-- Measurable, Answerable with the data supplied, Relevant to the decision.
-- "Achievable" and "time-bound" are left out on purpose: a research
-- objective is not a project target, and what matters is whether the data
-- in hand can answer it. Rows are keyed by the item's text, so editing an
-- objective makes its old score stale and it is scored again.
--
-- Recommendations: Actionability, Feasibility and Evidence strength are
-- scored 1, 3 or 5 and summed (max 15). Expected impact is scored the same
-- way but kept out of the total and shown beside it, since a recommendation
-- can be well-formed and still small.
--
-- Additive only. Requires 0027 (synthesized recommendations).

create table if not exists objective_quality (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  item_order int not null,
  item_text text not null,
  specific_score smallint not null check (specific_score in (1, 3, 5)),
  measurable_score smallint not null check (measurable_score in (1, 3, 5)),
  answerable_score smallint not null check (answerable_score in (1, 3, 5)),
  relevant_score smallint not null check (relevant_score in (1, 3, 5)),
  quality_score smallint not null,
  quality_tier text not null check (quality_tier in ('weak', 'workable', 'strong')),
  rationale text not null default '',
  suggestion text not null default '',
  scored_at timestamptz not null default now(),
  unique (run_id, item_order)
);

alter table objective_quality enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'objective_quality' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on objective_quality
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;

alter table recommendations
  add column if not exists rec_actionability_score smallint check (rec_actionability_score in (1, 3, 5)),
  add column if not exists rec_feasibility_score smallint check (rec_feasibility_score in (1, 3, 5)),
  add column if not exists rec_evidence_score smallint check (rec_evidence_score in (1, 3, 5)),
  add column if not exists rec_impact_score smallint check (rec_impact_score in (1, 3, 5)),
  add column if not exists rec_quality_score smallint,
  add column if not exists rec_quality_tier text check (rec_quality_tier in ('weak', 'workable', 'strong')),
  add column if not exists rec_quality_rationale text;
