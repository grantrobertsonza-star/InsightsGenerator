-- ANA-QUAL-001: processing_status (migration 0079) could only ever be 'ready' or 'failed',
-- so a transcript whose coding batches came back incomplete - applyCodebook's own
-- incompleteBatches, computed and recorded on the coding_summary trace already, but never
-- read back by anything researcher-facing - was stamped 'ready' exactly like a clean run.
-- The two were not told apart anywhere a researcher would see: not on the document list,
-- not on the finding, not in the processing_status column itself. 'incomplete' gives
-- extractThemesFromTranscript/reapplyCodebook a real status to stamp instead of 'ready'
-- when coverage is genuinely partial (some batches returned a usable tool call but left at
-- least one requested unit with no explicit decision), so the gap is visible rather than
-- silently indistinguishable from a complete run.
--
-- Run npm run backup before applying.
do $$
declare
  c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = 'documents'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%processing_status%';
  if c is not null then
    execute format('alter table documents drop constraint %I', c);
  end if;
end $$;

alter table documents
  add constraint documents_processing_status_check
    check (processing_status in ('ready', 'incomplete', 'failed'));
