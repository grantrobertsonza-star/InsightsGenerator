-- IMP-006: a document's processing has never had a lifecycle/status of its
-- own. "Ready" has always been inferred purely from document_tables (or
-- findings) existing for it, which cannot tell "processing failed" apart
-- from "hasn't been processed yet" -- both look like an empty, untouched
-- document. The existing per-click error banner (trace.process_run_errors,
-- read by getLatestProcessErrors in src/app/runs/[id]/page.tsx) is scoped to
-- "the most recent click on this run", so a failed document's state is lost
-- the moment ANY other document on the same run is processed afterward
-- (that later, successful click stamps a newer process_run_batch marker and
-- writes no process_run_errors row, so the staleness filter drops the
-- earlier failure from the banner even though the failed document itself
-- was never retried). This column gives each document a status that
-- persists independently of what anyone else on the run does next.
--
-- Null means "never attempted" (every pre-migration document, and any new
-- upload before its first processing click) -- deliberately not defaulted
-- to 'ready' or 'pending', since neither is true yet and guessing either
-- would misrepresent documents this migration has no way to actually check.
alter table documents
  add column if not exists processing_status text
    check (processing_status in ('ready', 'failed'));
