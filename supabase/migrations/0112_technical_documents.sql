-- Technical documents (Grant, 2026-10-24): a project's methodology, fieldwork, sampling, weighting
-- and analysis documentation (a survey's technical report, for example), stored as documents of
-- kind 'technical'. They are context for the Research assistant to read and quote; they are never
-- mined for findings and are not briefs or proposals. Additive: the kind check gains 'technical';
-- existing rows are unchanged. Without it, uploading a technical document is refused with a message
-- naming this migration, and nothing is stored.
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
  check (kind in ('report', 'table', 'evidence', 'transcript', 'instrument', 'output', 'technical'));
