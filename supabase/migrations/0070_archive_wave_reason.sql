-- Wave comparison findings are now archived before a comparison of the same
-- pair replaces them, so review status, notes and anything built on them are
-- kept in history. Adds the reason to the allowed list.
alter table finding_history drop constraint if exists finding_history_archived_reason_check;
alter table finding_history
  add constraint finding_history_archived_reason_check
  check (archived_reason in ('regenerate_unreviewed', 'full_reprocess', 'manual_reextract', 'wave_recompare'));
