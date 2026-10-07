-- Sub-themes, researcher notes and keywords for coded transcripts.
--
-- coding_code_meta holds, per transcript and per code NAME (not id), the
-- theme the code sits under (so Theme > Sub-theme / code), the researcher's
-- own note on the code and a list of keywords or phrases to count. It is keyed
-- by name so it carries over to every new codebook version without touching
-- the way codes are copied.
--
-- coding_turn_notes holds a researcher's note on one turn of a transcript
-- (the "analytical note" next to a quote). Keyed by turn number.
--
-- Additive. Requires 0043.

create table if not exists coding_code_meta (
  tenant_id uuid not null references tenants(id),
  document_id uuid not null references documents(id) on delete cascade,
  code_key text not null,
  theme text not null default '',
  note text not null default '',
  keywords text not null default '',
  updated_at timestamptz not null default now(),
  primary key (document_id, code_key)
);

create table if not exists coding_turn_notes (
  tenant_id uuid not null references tenants(id),
  document_id uuid not null references documents(id) on delete cascade,
  segment_index integer not null,
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (document_id, segment_index)
);

do $$
declare
  t text;
begin
  foreach t in array array['coding_code_meta', 'coding_turn_notes'] loop
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
