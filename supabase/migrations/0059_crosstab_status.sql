-- Crosstabs built from a data file start as drafts in a table set. Committing
-- the set generates the findings. Rows with no status (built before this
-- migration) count as committed.
alter table document_tables add column if not exists crosstab_status text
  check (crosstab_status in ('draft', 'committed'));
