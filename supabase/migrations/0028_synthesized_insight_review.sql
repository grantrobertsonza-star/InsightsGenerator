-- Gives synthesized insights (0027_insight_synthesis.sql) the same
-- researcher review gate the rest of the pipeline already has: every row
-- comes out of insightSynthesizer.ts auto-accepted, the same
-- auto-accept-by-default convention decisions, objectives and
-- recommendations already follow, with explicit Accept/Reject to flip that
-- in place. Delete is the one operation that actually removes a row, and
-- (unlike recommendations.deleteRecommendation, which is a bare delete) it
-- snapshots into synthesized_insight_history first, same reasoning as
-- finding_history/insight_history in 0021: a researcher explicitly asked
-- for this record to exist so a deleted synthesized insight is an append
-- to an audit trail, not a silent disappearance. Deleting the live row also
-- cascades its synthesized_insight_sources rows, which is what makes its
-- member pre-insights eligible again for a future synthesis pass, same as
-- "delete and let it be reconsidered" implies.

alter table synthesized_insights
  add column if not exists review_status text not null default 'accepted'
    check (review_status in ('accepted', 'rejected'));

create table if not exists synthesized_insight_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  original_synthesized_insight_id uuid not null unique,
  headline text not null,
  observation text not null,
  tension text not null,
  implication text not null,
  action_plan_status text not null,
  triangulation_count smallint not null,
  source_theme_count smallint not null,
  materiality_rationale text,
  confidence_tier text,
  review_status text not null,
  -- A plain text snapshot of the chain-of-evidence headlines at the moment
  -- of deletion. The member pre-insights themselves aren't deleted (only
  -- the join rows are, via cascade), but re-querying them later could pull
  -- in whatever they've since become part of, so the history record keeps
  -- its own fixed copy of what justified this insight at the time.
  source_headlines text[] not null,
  original_created_at timestamptz not null,
  archived_at timestamptz not null default now(),
  archived_reason text not null
    check (archived_reason in ('researcher_deleted'))
);

create index if not exists synthesized_insight_history_run_id_idx
  on synthesized_insight_history (run_id, archived_at desc);

alter table synthesized_insight_history enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'synthesized_insight_history' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on synthesized_insight_history
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
