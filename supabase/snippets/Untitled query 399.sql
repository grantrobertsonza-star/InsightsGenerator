-- Questionnaires and interview or focus group guides. An instrument is
-- uploaded beside the data it produced. Its items (question code, wording,
-- answer options, skip instructions) are read out and linked to the data
-- file's variables, so labels, question text and stated routing can be used
-- instead of guessed. A link starts as a suggestion and only counts once the
-- researcher confirms it.
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
  check (kind in ('report', 'table', 'evidence', 'transcript', 'instrument'));

alter table documents add column if not exists instrument_type text
  check (instrument_type is null or instrument_type in ('questionnaire', 'interview_guide', 'focus_group_guide'));
-- The data or transcript document this instrument belongs to, when stated.
alter table documents add column if not exists instrument_for uuid references documents(id) on delete set null;

create table if not exists instrument_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  item_order int not null,
  section text,
  code text,
  item_text text not null,
  -- [{"code":"1","label":"Yes"}, ...]
  response_options jsonb not null default '[]'::jsonb,
  -- The skip instruction as written, and what could be read from it:
  -- {"combine":"all"|"any","clauses":[{"code":"Q5","values":["1","2"],"negate":false}]}
  routing_text text,
  routing jsonb,
  page int,
  created_at timestamptz not null default now()
);
create index if not exists instrument_items_document_idx on instrument_items (document_id, item_order);

create table if not exists instrument_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  item_id uuid not null references instrument_items(id) on delete cascade,
  data_document_id uuid not null references documents(id) on delete cascade,
  variable text not null,
  method text not null check (method in ('code', 'stem', 'wording', 'manual')),
  confidence numeric not null default 0,
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  unique (item_id, data_document_id, variable)
);
create index if not exists instrument_links_data_idx on instrument_links (data_document_id, status);

alter table instrument_items enable row level security;
alter table instrument_links enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'instrument_items' and policyname = 'tenant_isolation') then
    create policy tenant_isolation on instrument_items using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'instrument_links' and policyname = 'tenant_isolation') then
    create policy tenant_isolation on instrument_links using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
