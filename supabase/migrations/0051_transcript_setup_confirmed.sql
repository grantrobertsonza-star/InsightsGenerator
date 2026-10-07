-- The researcher has confirmed how a transcript is set up (who is in each
-- session, how the file is laid out) before it is coded. Requires 0044.
alter table coding_document_settings
  add column if not exists setup_confirmed_at timestamptz;

-- Transcripts coded before this existed keep working: treat them as confirmed.
insert into coding_document_settings (tenant_id, run_id, document_id, setup_confirmed_at)
select b.tenant_id, b.run_id, b.document_id, now()
from coding_codebooks b
group by b.tenant_id, b.run_id, b.document_id
on conflict (document_id) do update
  set setup_confirmed_at = coalesce(coding_document_settings.setup_confirmed_at, now());
