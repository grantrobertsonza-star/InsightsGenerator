-- Stores the generated SCQA/Pyramid Principle narrative that the client-
-- ready "Insights Report" deck is built from: one row per run, regenerated
-- (upserted, not re-inserted) whenever the researcher clicks "Generate" or
-- "Regenerate" after reviewing more findings/insights/recommendations.
--
-- Only the framing fields live here (situation, complication, question,
-- governing thought, and per-pillar headline/so-what groupings). The actual
-- evidence text shown on each pillar's slide -- the insight headlines,
-- observations, and quotes -- is never stored here and never written by the
-- model: the deck renderer pulls that straight from insights/findings by
-- the insight_ids each pillar references, the same "the application, never
-- the model, verifies the numbers" principle the statistical pattern
-- detection pass already follows. That keeps the one part of this table
-- that IS model-authored prose (the narrative framing) clearly separated
-- from the part that must stay verbatim.
create table if not exists deck_narratives (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  situation text not null,
  complication text not null,
  question text not null,
  governing_thought text not null,
  pillars jsonb not null default '[]',
  recommendations_intro text not null default '',
  caveats jsonb not null default '[]',
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (run_id)
);

alter table deck_narratives enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'deck_narratives' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on deck_narratives
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
