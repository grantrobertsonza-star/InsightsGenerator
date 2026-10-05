-- Audit trail for the three reprocessing tiers on the run page. Deleting a
-- finding already cascades to its verdict, its insight, and any
-- recommendation built on that insight (see 0005_cascade_deletes.sql); this
-- migration gives whatever is about to be deleted a chance to be snapshotted
-- first, so "Regenerate unreviewed" and "Reprocess all documents" stop
-- being silent, irreversible overwrites and start being an append to a
-- record a researcher (or a client, eventually) can look back on.
--
-- These four tables are write-once snapshots, populated by the application
-- immediately before a delete that would otherwise lose the row with no
-- trace. They are never updated and never read by the live pipeline, only
-- by a history view. original_*_id columns are NOT foreign keys to the
-- live tables (the whole point is that the live row is about to be gone),
-- they are a plain record of what that row's id used to be.
--
-- finding_history.original_finding_id is unique because a given finding id
-- is only ever archived once: it is deleted in the same transaction as the
-- snapshot, so that id can never reappear in the live findings table or be
-- archived a second time. verdict_history / insight_history therefore link
-- to their finding's snapshot through that natural key rather than a
-- separate surrogate join column.

create table if not exists finding_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  original_finding_id uuid not null unique,
  origin text,
  finding_text text not null,
  finding_kind text,
  theme text,
  status text not null,
  source_document_id uuid,
  source_table_id uuid,
  source_page integer,
  source_quote text,
  data_type text,
  original_created_at timestamptz not null,
  archived_at timestamptz not null default now(),
  archived_reason text not null
    check (archived_reason in ('regenerate_unreviewed', 'full_reprocess', 'manual_reextract'))
);

create index if not exists finding_history_run_id_idx on finding_history (run_id, archived_at desc);

create table if not exists verdict_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  original_finding_id uuid not null references finding_history (original_finding_id) on delete cascade,
  original_verdict_id uuid not null,
  verdict_tier text not null,
  rationale text not null,
  verification_method text not null,
  corroboration_level text not null,
  original_created_at timestamptz not null,
  archived_at timestamptz not null default now()
);

create index if not exists verdict_history_finding_idx on verdict_history (original_finding_id);

create table if not exists insight_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  original_finding_id uuid not null unique references finding_history (original_finding_id) on delete cascade,
  original_insight_id uuid not null unique,
  headline text not null,
  observation text not null,
  tension text not null,
  implication text not null,
  decision_context text,
  quality_score smallint,
  quality_tier text,
  quality_rationale text,
  original_created_at timestamptz not null,
  archived_at timestamptz not null default now()
);

create table if not exists recommendation_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  original_insight_id uuid not null references insight_history (original_insight_id) on delete cascade,
  original_recommendation_id uuid not null,
  action_text text not null,
  owner_role text not null,
  timeline text not null,
  metric text not null,
  priority text not null,
  status text not null,
  original_created_at timestamptz not null,
  archived_at timestamptz not null default now()
);

alter table finding_history enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'finding_history' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on finding_history
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;

alter table verdict_history enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'verdict_history' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on verdict_history
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;

alter table insight_history enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'insight_history' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on insight_history
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;

alter table recommendation_history enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'recommendation_history' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on recommendation_history
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
