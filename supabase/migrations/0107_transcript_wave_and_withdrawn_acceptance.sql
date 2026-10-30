-- Transcripts on the Import screen, 2026-10-19 (Grant: "should the qual tile not have the same
-- structure as the quant, with a wave option", and "they don't all have unaccept buttons").
-- Requires 0044 (coding_document_settings) and 0051 (setup_confirmed_at). Additive and nullable:
-- existing rows keep their meaning, and without this migration the app runs as before, with the
-- wave field and Undo accept saying they need it.
--
-- wave: free text ("Wave 1", "Baseline") naming which round of a repeated qualitative study this
--   transcript belongs to, like a data file's wave. Recorded and shown; themes are not yet compared
--   across waves.
-- setup_withdrawn_at: the researcher undid the transcript's acceptance. Kept apart from
--   setup_confirmed_at being null, because a row can also exist with no confirmation simply
--   because coding created it (codingAnalysis.ts, extractThemes.ts): only a withdrawn transcript
--   must not be accepted again automatically on the next visit. Accepting it again clears this.
alter table coding_document_settings
  add column if not exists wave text,
  add column if not exists setup_withdrawn_at timestamptz;
