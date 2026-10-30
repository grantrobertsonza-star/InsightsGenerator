-- Indicator data (batch 54; Grant, 28 October 2026): published statistics such as World Bank Data360,
-- WDI or Findex downloads, one row per area, indicator, breakdown and period, never one row per
-- respondent. Contract: claude/indicator-data.md.
--
--   documents.kind 'indicator'   a file added as Indicator data. Not mined for findings; read by the
--                                engine's "indicators" action into the three tables below.
--   indicator_reads              one row per indicator file: the published read (read_id), its layout
--                                and provenance, and the last failed attempt. A failed reread records
--                                its failure here and leaves the published version in place.
--   indicator_series             one row per series (an indicator with its breakdown codes) of a read.
--   indicator_observations       one row per series, area and period with a value. A period or area the
--                                file does not state is null (unknown), never a default; an absent
--                                observation has no row (never zero).
--   indicator_notes              OECD reference information (a file added as Indicator data whose layout is
--                                oecd_notes): one English note per row and field, keyed by dimension codes
--                                ("~", any, is left out of the key), with the dataflow (STRUCTURE_ID) it
--                                belongs to. Shown with the matching series of a data file of the same
--                                dataflow in the same project; notes never change values.
--
-- Project membership is the document's: these tables carry no run_id, so removing the file to the bin
-- (which moves documents.run_id) hides them with it, restoring brings them back, and erasing the
-- document deletes them through the foreign keys (claude/document-deletion-contract.md).
--
-- Additive and idempotent. Before it, adding a file as Indicator data is refused naming this migration
-- and nothing is stored; the rest of the app is unchanged. Written for this batch; not applied to any
-- database as part of it. Run `npm run backup -- --local` before applying.

do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'documents'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%'
      and pg_get_constraintdef(oid) like '%transcript%'
  loop
    execute format('alter table documents drop constraint %I', c);
  end loop;
end $$;

alter table documents
  add constraint documents_kind_check
  check (kind in ('report', 'table', 'evidence', 'transcript', 'instrument', 'output', 'technical', 'indicator'));

create table if not exists indicator_reads (
  document_id uuid primary key references documents(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  -- The published version: series and observations with this read_id are the current read. Null until
  -- a read has succeeded.
  read_id uuid,
  reader text,
  layout text check (layout in ('sdmx_long', 'data360_wide', 'wdi_wide', 'imf_wide', 'oecd_sdmx', 'oecd_notes', 'label_value')),
  provenance jsonb not null default '{}'::jsonb,
  -- [{code, label}], label null when the file gives none; code null when the file states no area.
  areas jsonb not null default '[]'::jsonb,
  series_count int not null default 0,
  observation_count int not null default 0,
  published_at timestamptz,
  -- The last attempt that failed (kept beside the previous published version, if any); cleared by a
  -- read that succeeds.
  failure text,
  failed_at timestamptz,
  check ((read_id is null) = (published_at is null))
);

create table if not exists indicator_series (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  document_id uuid not null references documents(id) on delete cascade,
  read_id uuid not null,
  -- Identity: the indicator code and breakdown codes (or the label, for a label and value file).
  series_key text not null,
  indicator_code text,
  indicator_label text,
  -- [{dimension, code, label}] in the file's column order.
  breakdowns jsonb not null default '[]'::jsonb,
  unit_code text,
  unit_label text,
  -- Power of ten the published values are expressed in (SDMX UNIT_MULT); null when not stated.
  -- Applied for display only.
  unit_mult int,
  -- 'proportion': percent values stored as 0 to 1 (shown times 100); 'percent': stored as percentages.
  value_scale text check (value_scale in ('proportion', 'percent')),
  base_description text,
  groups jsonb,
  observation_count int not null default 0,
  unique (document_id, read_id, series_key)
);
create index if not exists indicator_series_read_idx on indicator_series (document_id, read_id);

create table if not exists indicator_observations (
  tenant_id uuid not null references tenants(id),
  document_id uuid not null references documents(id) on delete cascade,
  series_id uuid not null references indicator_series(id) on delete cascade,
  area_code text,
  period text,
  -- The value as written in the file, and the same number for sorting and charts.
  value_text text not null,
  value numeric not null,
  status text,
  note text,
  unique nulls not distinct (series_id, area_code, period)
);
create index if not exists indicator_observations_document_idx on indicator_observations (document_id);

create table if not exists indicator_notes (
  tenant_id uuid not null references tenants(id),
  document_id uuid not null references documents(id) on delete cascade,
  read_id uuid not null,
  dataflow text not null,
  -- {dimension: code} for every key dimension the note names; a dimension left out applies to any value.
  note_key jsonb not null,
  key_labels jsonb not null default '{}'::jsonb,
  -- The period the note names (TIME_PERIOD), null for any.
  period text,
  field text not null,
  field_label text,
  note_text text not null,
  line int not null,
  unique (document_id, read_id, line, field)
);
create index if not exists indicator_notes_dataflow_idx on indicator_notes (dataflow, document_id, read_id);

alter table indicator_reads enable row level security;
alter table indicator_series enable row level security;
alter table indicator_observations enable row level security;
alter table indicator_notes enable row level security;
do $$
declare t text;
begin
  foreach t in array array['indicator_reads', 'indicator_series', 'indicator_observations', 'indicator_notes'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'tenant_isolation') then
      execute format('create policy tenant_isolation on %I using (tenant_id = current_setting(''app.current_tenant_id'')::uuid)', t);
    end if;
  end loop;
end $$;
