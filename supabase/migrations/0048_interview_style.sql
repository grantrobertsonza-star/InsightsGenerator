-- How the interview was run, chosen by the researcher before coding.
-- Requires 0044.
alter table coding_document_settings
  add column if not exists interview_style text
    check (interview_style in ('unstructured', 'semi_structured', 'structured'));
