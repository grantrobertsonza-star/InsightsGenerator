-- Research Quality Review v1 (brief 2026-10-16, fit assessment 2026-10-16, Grant's authorisation
-- 2026-10-18). Seven module-owned tables; nothing in the existing findings, recommendations,
-- verdict or narrative tables changes.
--
-- Ownership: every table carries tenant_id and run_id, has row-level security with the standard
-- tenant_isolation policy, and module-to-module references are scoped by tenant through composite
-- foreign keys, so a row can never point at another tenant's source, review or observation.
-- Project deletion removes every module row (runs on delete cascade). Deleting a project
-- DOCUMENT does not: research_quality_sources.document_id becomes null and the retained text
-- snapshot stays with its reviews until a researcher purges it (researchQualityRepository
-- purgeSourceText), which the module discloses on screen.

create table if not exists research_quality_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  run_id uuid not null references runs (id) on delete cascade,
  -- The project document this logical source currently reads from. Null after that document is
  -- deleted; the source and its versions stay as history.
  document_id uuid references documents (id) on delete set null,
  -- Overlapping roles: one document can be a report AND its methodology without becoming two
  -- sources. Roles are module data and never change documents.kind.
  roles text[] not null check (
    cardinality(roles) between 1 and 7
    and roles <@ array['brief', 'proposal', 'questionnaire', 'discussion_guide', 'methodology', 'report', 'fieldwork']::text[]
  ),
  current_version_id uuid,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index if not exists research_quality_sources_document_uq
  on research_quality_sources (run_id, document_id) where document_id is not null;

create table if not exists research_quality_source_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  run_id uuid not null references runs (id) on delete cascade,
  source_id uuid not null,
  ordinal integer not null check (ordinal >= 1),
  original_document_id uuid,
  filename text not null,
  content_sha256 text not null,
  canonical_sha256 text not null,
  -- How the text was read: pdf_pages (real PDF pages), office_pdf_pages (converted Word/PowerPoint
  -- pages), docx_text (direct Word text, no pages), plain_text (UTF-8 .txt).
  extractor text not null check (extractor in ('pdf_pages', 'office_pdf_pages', 'docx_text', 'plain_text')),
  extractor_version text not null,
  canonical_text text not null,
  -- [{ "id": "p3" | "s12", "kind": "page" | "paragraph", "page": 3 | null, "start": n, "end": n }]
  segments jsonb not null,
  char_count integer not null,
  -- Set when a researcher permanently purged this snapshot's text (canonical_text is then empty).
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (source_id, ordinal),
  foreign key (tenant_id, source_id) references research_quality_sources (tenant_id, id) on delete cascade
);

alter table research_quality_sources
  drop constraint if exists research_quality_sources_current_version_fk;
alter table research_quality_sources
  add constraint research_quality_sources_current_version_fk
  foreign key (tenant_id, current_version_id) references research_quality_source_versions (tenant_id, id) deferrable initially deferred;

create table if not exists research_quality_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  run_id uuid not null references runs (id) on delete cascade,
  parent_review_id uuid,
  sequence integer not null check (sequence >= 1),
  -- One explicit start creates one review: a repeated submission with the same key returns it.
  request_key text not null,
  mode text not null check (mode in ('improve_planned', 'review_documented')),
  study_type text not null check (study_type in ('quantitative', 'qualitative', 'mixed', 'unclear')),
  purpose text not null,
  -- Frozen inputs: source versions and roles, extracted-fact coverage, selected/excluded/unresolved
  -- criteria with reasons, reference passages, decisions, objectives and clarification ids.
  manifest jsonb not null,
  input_digest text not null,
  criteria_release text not null,
  criteria_hash text not null,
  references_release text not null,
  references_hash text not null,
  prompt_version text not null,
  model text not null,
  state text not null default 'pending' check (state in ('pending', 'running', 'complete', 'partial', 'failed')),
  coverage jsonb not null default '{}'::jsonb,
  estimated_cost_usd numeric(10, 4),
  actual_cost_usd numeric(10, 4) not null default 0,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, id),
  unique (run_id, sequence),
  unique (run_id, request_key),
  foreign key (tenant_id, parent_review_id) references research_quality_reviews (tenant_id, id) on delete set null (parent_review_id)
);

create table if not exists research_quality_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  run_id uuid not null references runs (id) on delete cascade,
  review_id uuid not null,
  task_key text not null,
  stage text not null check (stage in ('extract', 'assess')),
  depends_on text[] not null default '{}',
  input_hash text,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  attempts integer not null default 0,
  max_attempts integer not null check (max_attempts between 1 and 5),
  lease_token uuid,
  lease_expires_at timestamptz,
  result jsonb,
  validation jsonb,
  error text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(10, 4) not null default 0,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (review_id, task_key),
  foreign key (tenant_id, review_id) references research_quality_reviews (tenant_id, id) on delete cascade
);

create table if not exists research_quality_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  run_id uuid not null references runs (id) on delete cascade,
  -- Server-derived from the criterion, the decision/objective target and the cited logical sources
  -- (researchQualityRules.observationKey), never from generated wording or order.
  logical_key text not null,
  criterion_id text not null,
  anchor jsonb not null,
  -- Bumped by every status or wording decision; a save naming an older revision is a conflict.
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (run_id, logical_key)
);

create table if not exists research_quality_observation_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  run_id uuid not null references runs (id) on delete cascade,
  observation_id uuid not null,
  review_id uuid not null,
  task_id uuid not null,
  payload jsonb not null,
  payload_hash text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (review_id, observation_id),
  foreign key (tenant_id, observation_id) references research_quality_observations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, review_id) references research_quality_reviews (tenant_id, id) on delete cascade,
  foreign key (tenant_id, task_id) references research_quality_tasks (tenant_id, id) on delete cascade
);

create table if not exists research_quality_researcher_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  run_id uuid not null references runs (id) on delete cascade,
  observation_id uuid,
  observation_version_id uuid,
  kind text not null check (kind in ('accept', 'dismiss', 'reopen', 'comment', 'wording', 'clarification')),
  body text check (body is null or char_length(body) <= 8000),
  -- The signed-in researcher (G6). Null only for entries recorded before sign-in existed.
  actor_user_id uuid,
  actor_email text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (run_id, idempotency_key),
  foreign key (tenant_id, observation_id) references research_quality_observations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, observation_version_id) references research_quality_observation_versions (tenant_id, id) on delete cascade,
  check (kind = 'clarification' or observation_id is not null),
  check (kind not in ('accept', 'dismiss', 'reopen', 'wording') or observation_version_id is not null)
);

create index if not exists research_quality_tasks_review_idx on research_quality_tasks (review_id, status);
create index if not exists research_quality_versions_observation_idx on research_quality_observation_versions (observation_id, created_at);
create index if not exists research_quality_entries_observation_idx on research_quality_researcher_entries (observation_id, created_at);
create index if not exists research_quality_reviews_run_idx on research_quality_reviews (run_id, sequence);
create index if not exists research_quality_sources_run_idx on research_quality_sources (run_id);
create index if not exists research_quality_source_versions_source_idx on research_quality_source_versions (source_id, ordinal);

do $$
declare t text;
begin
  foreach t in array array['research_quality_sources', 'research_quality_source_versions', 'research_quality_reviews',
                           'research_quality_tasks', 'research_quality_observations', 'research_quality_observation_versions',
                           'research_quality_researcher_entries'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'tenant_isolation') then
      execute format('create policy tenant_isolation on %I using (tenant_id = current_setting(''app.current_tenant_id'')::uuid)', t);
    end if;
  end loop;
end $$;
