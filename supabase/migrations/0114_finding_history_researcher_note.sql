-- A retired finding's history copy keeps the researcher's note (Codex DI-F07, 2026-10-24). The
-- shared archive (findingArchive.archiveAndReplaceFindings: rereads, regenerated output findings,
-- wave comparisons) copied the review and the edit marker but not the note itself, so a note saved on
-- a finding was lost when the finding was replaced. Additive: history rows written before this have
-- no note column value (null), and nothing is back-filled, because the notes they lost are not stored
-- anywhere. Without this column, retiring a finding that has a note is refused with a message naming
-- this migration, so no further note is lost.
alter table finding_history add column if not exists researcher_note text;
