-- Qualitative coding, hardened. A transcript used to get one model pass that
-- named a handful of themes and picked one quote for each. Three problems
-- with that: a single run cannot show how stable its own themes are, the
-- themes were never written down as something a researcher could read and
-- edit, and the only control on the quotes was "does the text appear
-- somewhere in the document".
--
-- Now (see src/lib/qualCoding.ts and src/lib/extractThemes.ts):
--   1. the open coding pass runs several times and the themes are merged, so
--      each theme carries how many of those runs found it;
--   2. the merged themes are frozen into a versioned codebook (definition,
--      inclusion and exclusion criteria) that a researcher can edit, and the
--      codebook is applied to every participant segment of the transcript;
--   3. a quote is only stored once it has been matched to a participant
--      segment, and every run records what it was given and what it used.
--
-- Everything here is additive. Existing coded findings keep working; they
-- simply have no codebook behind them until the transcript is coded again.

-- One row per version of a transcript's codebook. The highest version for a
-- document is the one in force.
create table if not exists coding_codebooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  version integer not null,
  source text not null check (source in ('induced', 'edited')),
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

create table if not exists coding_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  codebook_id uuid not null references coding_codebooks(id) on delete cascade,
  position integer not null,
  name text not null,
  definition text not null,
  inclusion_criteria text not null default '',
  exclusion_criteria text not null default '',
  -- How many of the open coding runs surfaced this theme, out of how many
  -- were run. Null on an edited version that has not been re-induced.
  reproduced_runs smallint,
  total_runs smallint,
  created_at timestamptz not null default now()
);
create index if not exists coding_codes_codebook_idx on coding_codes (codebook_id, position);

-- The transcript split into turns, so a quote can be traced to who said it.
-- role marks moderator or interviewer turns, which are read as context but
-- never coded as participant content.
create table if not exists coding_segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  segment_index integer not null,
  speaker text,
  role text not null check (role in ('participant', 'moderator', 'unknown')),
  page integer,
  text text not null,
  unique (document_id, segment_index)
);

-- Which codes of which codebook version were applied to which segment.
create table if not exists coding_assignments (
  segment_id uuid not null references coding_segments(id) on delete cascade,
  code_id uuid not null references coding_codes(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  primary key (segment_id, code_id)
);
create index if not exists coding_assignments_code_idx on coding_assignments (code_id);

-- What each coding call was given and with what. prompt_hash and input_hash
-- are SHA-256 of the instructions and of the text sent; detail carries the
-- stage's own numbers (themes returned, quote match counts, truncation).
create table if not exists coding_run_manifest (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  codebook_id uuid references coding_codebooks(id) on delete set null,
  stage text not null check (stage in ('open_coding', 'consolidation', 'apply', 'summary')),
  run_index integer not null default 0,
  model text not null,
  prompt_hash text not null,
  input_hash text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists coding_run_manifest_doc_idx on coding_run_manifest (document_id, created_at);

do $$
declare
  t text;
begin
  foreach t in array array[
    'coding_codebooks', 'coding_codes', 'coding_segments', 'coding_assignments', 'coding_run_manifest'
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

-- What a coded finding carries about where it came from.
--   coding_code_id       the codebook entry it was built from
--   supporting_segments  participant segments the code was applied to
--   supporting_speakers  distinct speakers among them (null when the
--                        transcript has no speaker labels)
--   reproduced_runs / total_runs  how many open coding runs found the theme
--   quote_match          exact, near (a close but not verbatim match) or none
alter table findings
  add column if not exists coding_code_id uuid references coding_codes(id) on delete set null,
  add column if not exists supporting_segments integer,
  add column if not exists supporting_speakers integer,
  add column if not exists reproduced_runs smallint,
  add column if not exists total_runs smallint,
  add column if not exists quote_match text check (quote_match in ('exact', 'near', 'none'));
