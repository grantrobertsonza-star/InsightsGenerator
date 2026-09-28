-- Insights Elevator: initial schema
-- Tenant isolation is built in from this first migration, per the engineering brief.

create extension if not exists pgcrypto;
create extension if not exists vector;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  decision_statement text,
  evidence_threshold text,
  audience text,
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'running', 'awaiting_human_review', 'complete', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid references runs(id),
  kind text not null check (kind in ('report', 'table', 'evidence')),
  source_filename text not null,
  storage_path text not null,
  extracted_text text,
  uploaded_at timestamptz not null default now()
);

create table evidence_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  document_id uuid not null references documents(id),
  chunk_text text not null,
  embedding vector(1536),
  source_date date,
  method text,
  base_size integer,
  created_at timestamptz not null default now()
);

create table claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id),
  origin text not null check (origin in ('stated', 'generated')),
  claim_text text not null,
  source_document_id uuid references documents(id),
  source_page integer,
  source_table_id uuid references documents(id),
  source_cells jsonb,
  pattern_type text check (pattern_type in ('segment_difference', 'trend', 'outlier', 'relationship')),
  stated_stats jsonb,
  created_at timestamptz not null default now()
);

create table verdicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  claim_id uuid not null references claims(id),
  verdict_tier text not null
    check (verdict_tier in ('robust', 'use_with_caution', 'not_supported', 'insufficient_information')),
  rationale text not null,
  statistical_checks jsonb not null default '{}',
  verification_method text not null check (verification_method in ('single_pass', 'dual_model')),
  corroboration_level text not null
    check (corroboration_level in ('cross_source_corroborated', 'single_source', 'contradicted')),
  dual_model_agreement boolean,
  due_care jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table insights (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id),
  claim_id uuid not null references claims(id),
  decision_context text not null,
  headline text not null,
  observation text not null,
  tension text not null,
  implication text not null,
  created_at timestamptz not null default now()
);

create table recommendations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  insight_id uuid not null references insights(id),
  action_text text not null,
  owner_role text not null,
  owner_feasibility_note text not null,
  timeline text not null,
  metric text not null,
  priority text not null check (priority in ('high', 'medium', 'low')),
  assumptions_and_risks text not null,
  alternatives_considered text not null,
  follow_up_date date,
  impact_outcome text
);

create table review_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id),
  reviewer_id uuid not null,
  decision text not null check (decision in ('approved', 'changes_requested')),
  note text,
  decided_at timestamptz not null default now()
);

create table trace (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id),
  event text not null,
  detail jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);

alter table runs enable row level security;
create policy tenant_isolation on runs
  using (tenant_id = current_setting('app.current_tenant_id')::uuid);

alter table documents enable row level security;
create policy tenant_isolation on documents
  using (tenant_id = current_setting('app.current_tenant_id')::uuid);

alter table evidence_chunks enable row level security;
create policy tenant_isolation on evidence_chunks
  using (tenant_id = current_setting('app.current_tenant_id')::uuid);

alter table claims enable row level security;
create policy tenant_isolation on claims
  using (tenant_id = current_setting('app.current_tenant_id')::uuid);

alter table verdicts enable row level security;
create policy tenant_isolation on verdicts
  using (tenant_id = current_setting('app.current_tenant_id')::uuid);

alter table insights enable row level security;
create policy tenant_isolation on insights
  using (tenant_id = current_setting('app.current_tenant_id')::uuid);

alter table recommendations enable row level security;
create policy tenant_isolation on recommendations
  using (tenant_id = current_setting('app.current_tenant_id')::uuid);

alter table review_log enable row level security;
create policy tenant_isolation on review_log
  using (tenant_id = current_setting('app.current_tenant_id')::uuid);

alter table trace enable row level security;
create policy tenant_isolation on trace
  using (tenant_id = current_setting('app.current_tenant_id')::uuid);
