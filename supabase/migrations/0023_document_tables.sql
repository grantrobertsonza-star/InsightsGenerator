-- Supports extracting one or more tables out of a Word or PDF document, not
-- just a native CSV/Excel upload. Before this, "Table" documents assumed
-- the uploaded file itself was a spreadsheet, one document equals one
-- table; that broke the moment a researcher uploaded a Word document whose
-- content happened to be tabular, since there is no spreadsheet inside a
-- .docx for a spreadsheet-parsing library to find.
--
-- document_tables is the new unit the statistical pattern-detection pass
-- (generateFindingsFromTable) runs against, instead of re-downloading and
-- re-parsing the source file every time. A CSV/Excel document always gets
-- exactly one row here (table_index 0), matching how it has always worked;
-- a Word or PDF document gets one row per table actually found in it.
-- headers/rows are stored as the parsed data itself (jsonb), not a
-- reference back to the file, so a finding built from a given table stays
-- meaningful even if the source document is later reprocessed differently.
--
-- (document_id, table_index) is unique and is the row's stable identity
-- across re-extraction: upserting by that pair, rather than deleting and
-- reinserting, means a table's id never changes just because the document
-- was reprocessed, which matters because findings.source_table_id below is
-- about to start pointing at this table, not at the document.
create table if not exists document_tables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  table_index integer not null,
  label text,
  source_page integer,
  headers jsonb not null default '[]',
  rows jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (document_id, table_index)
);

alter table document_tables enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'document_tables' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on document_tables
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;

-- Give every existing "table" document a single document_tables row
-- (table_index 0) so findings.source_table_id has somewhere to point once
-- it's repointed below. headers/rows start empty here deliberately:
-- generateFindingsFromTable's own extraction step re-populates them from
-- the live file the next time this document is processed, so nothing is
-- lost by not re-parsing every file as part of this migration.
insert into document_tables (tenant_id, run_id, document_id, table_index)
select tenant_id, run_id, id, 0
from documents
where kind = 'table'
on conflict (document_id, table_index) do nothing;

-- The old FK on source_table_id (see 0015_rename_claims_to_findings.sql:
-- this table was created as "claims", and a table rename does not rename
-- the constraints Postgres auto-named at creation time, so this has always
-- been called claims_source_table_id_fkey, not something findings-prefixed)
-- still points at documents(id). It has to be dropped BEFORE the rewrite
-- below, not after: the moment that update writes a document_tables.id
-- into source_table_id, the old constraint would reject it as a value
-- that isn't present in documents.
alter table findings drop constraint if exists claims_source_table_id_fkey;
alter table findings drop constraint if exists findings_source_table_id_fkey;

-- Existing findings' source_table_id currently holds a documents.id (the
-- whole file, since one document was always exactly one table). Rewrite it
-- to the matching document_tables.id created just above, now that no FK is
-- in the way. Safe to re-run: once a row's source_table_id already matches
-- a document_tables.id rather than a document_tables.document_id, this
-- join simply finds nothing more to update for it.
update findings f
set source_table_id = dt.id
from document_tables dt
where f.source_table_id = dt.document_id and dt.table_index = 0;

alter table findings
  add constraint findings_source_table_id_fkey
  foreign key (source_table_id) references document_tables(id);
