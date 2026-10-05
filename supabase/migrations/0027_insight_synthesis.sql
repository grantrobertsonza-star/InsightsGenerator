-- Insight synthesis layer. The `insights` table (one row per verified
-- finding) is kept exactly as-is and becomes the pre-insight rung: the
-- auditable chain-of-evidence step between a finding and a real insight,
-- still visible in the product (hideable later, not removed), still
-- written by the existing generator in src/lib/insightGenerator.ts.
--
-- A genuine insight, per the research behind this change (DVL Smith's
-- triangulation-before-promotion, the consulting-synthesis materiality
-- test, and Simoudis 2015's definition of insight as a relation selected
-- from a larger set, not generated one-to-one from it) comes from
-- clustering several pre-insights that triangulate across sources, then
-- reframing that cluster around the tension or motivation underneath it.
-- synthesized_insights is where that output lives, decoupled from the
-- 1:1 pre-insight table rather than replacing it.
create table if not exists synthesized_insights (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  decision_context text,
  headline text not null,
  observation text not null,
  tension text not null,
  implication text not null,
  -- Simoudis: an insight with no hypothesizable action plan yet is
  -- retained for later, not discarded as though it had failed validation.
  action_plan_status text not null default 'has_action'
    check (action_plan_status in ('has_action', 'retained_no_action')),
  -- Triangulation evidence, stored rather than re-derived, so the UI can
  -- show why this insight was trusted enough to surface.
  triangulation_count smallint not null default 0,
  source_theme_count smallint not null default 0,
  materiality_rationale text,
  confidence_tier text check (confidence_tier is null or confidence_tier in ('strong', 'moderate', 'exploratory')),
  created_at timestamptz not null default now()
);

alter table synthesized_insights enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'synthesized_insights' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on synthesized_insights
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;

-- The chain-of-evidence record itself: which pre-insights (and, through
-- them, which findings) a given synthesized insight was built from.
create table if not exists synthesized_insight_sources (
  synthesized_insight_id uuid not null references synthesized_insights(id) on delete cascade,
  pre_insight_id uuid not null references insights(id) on delete cascade,
  primary key (synthesized_insight_id, pre_insight_id)
);

-- Recommendations move to attach to real insights going forward, but the
-- existing insight_id column (pointing at a pre-insight) is left in place
-- and nullable rather than migrated, so nothing that already reads it
-- breaks during the transition. The check keeps every recommendation
-- anchored to at least one layer.
alter table recommendations alter column insight_id drop not null;
alter table recommendations add column if not exists synthesized_insight_id uuid references synthesized_insights(id) on delete cascade;
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'recommendations_has_an_anchor'
  ) then
    alter table recommendations add constraint recommendations_has_an_anchor
      check (insight_id is not null or synthesized_insight_id is not null);
  end if;
end $$;

create index if not exists synthesized_insights_run_id_idx on synthesized_insights (run_id);
create index if not exists synthesized_insight_sources_pre_insight_id_idx on synthesized_insight_sources (pre_insight_id);
create index if not exists recommendations_synthesized_insight_id_idx on recommendations (synthesized_insight_id);
