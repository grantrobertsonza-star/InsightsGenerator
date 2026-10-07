-- Checks that sit on top of a coded transcript (see src/lib/qualAnalysis.ts
-- and src/lib/codingAnalysis.ts):
--   * calibration: a researcher codes a sample of turns blind and the
--     model's coding is compared with theirs, code by code (Cohen's kappa);
--   * session type and respondent keys: whether a transcript is an
--     individual interview or a focus group, and which survey row each
--     speaker corresponds to;
--   * variable links: which closed survey question a theme should move with,
--     proposed by the model and accepted or rejected by the researcher, so a
--     respondent who says one thing and answers another can be flagged;
--   * negative cases: turns that contradict or qualify a theme.
-- All additive. Requires 0043.

create table if not exists coding_document_settings (
  document_id uuid primary key references documents(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  session_type text not null default 'individual'
    check (session_type in ('individual', 'focus_group')),
  -- The survey table this transcript's respondents are matched to, and the
  -- column that holds the respondent id there.
  case_table_id uuid references document_tables(id) on delete set null,
  case_column text,
  updated_at timestamptz not null default now()
);

-- speaker_key is the speaker label, or '' for a transcript with no labels.
create table if not exists coding_respondent_keys (
  document_id uuid not null references documents(id) on delete cascade,
  speaker_key text not null default '',
  tenant_id uuid not null references tenants(id),
  case_key text not null,
  primary key (document_id, speaker_key)
);

create table if not exists coding_calibration_samples (
  codebook_id uuid not null references coding_codebooks(id) on delete cascade,
  segment_id uuid not null references coding_segments(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  reviewed_at timestamptz,
  primary key (codebook_id, segment_id)
);

-- One row per (turn, code) the researcher judged. applies = false is a
-- judgement too: the researcher saw the code and said it does not fit.
create table if not exists coding_calibration_labels (
  segment_id uuid not null references coding_segments(id) on delete cascade,
  code_id uuid not null references coding_codes(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  applies boolean not null,
  primary key (segment_id, code_id)
);
create index if not exists coding_calibration_labels_code_idx on coding_calibration_labels (code_id);

-- Keyed by code name, not code id, so a link survives a new codebook version.
create table if not exists coding_variable_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  code_name text not null,
  variable text not null,
  direction text not null check (direction in ('higher', 'lower')),
  rationale text not null default '',
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected')),
  source text not null default 'model' check (source in ('model', 'researcher')),
  created_at timestamptz not null default now(),
  unique (document_id, code_name, variable)
);

create table if not exists coding_negative_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  code_id uuid not null references coding_codes(id) on delete cascade,
  segment_id uuid not null references coding_segments(id) on delete cascade,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (code_id, segment_id)
);

-- The manifest also records the two model calls these checks make.
alter table coding_run_manifest drop constraint if exists coding_run_manifest_stage_check;
alter table coding_run_manifest add constraint coding_run_manifest_stage_check
  check (stage in ('open_coding', 'consolidation', 'apply', 'summary', 'link_proposal', 'negative_case_search'));

do $$
declare
  t text;
begin
  foreach t in array array[
    'coding_document_settings', 'coding_respondent_keys', 'coding_calibration_samples',
    'coding_calibration_labels', 'coding_variable_links', 'coding_negative_cases'
  ] loop
    execute format('alter table %I enable row level security', t);
    if not exists (
      select 1 from pg_policies where tablename = t and policyname = 'tenant_isolation'
    ) then
      execute format(
        'create policy tenant_isolation on %I using (tenant_id = current_setting(''app.current_tenant_id'')::uuid)',
        t
      );
    end if;
  end loop;
end $$;
