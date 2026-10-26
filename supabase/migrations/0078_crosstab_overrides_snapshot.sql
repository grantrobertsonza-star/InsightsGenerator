-- Captures the variable corrections (documents.variable_overrides) in effect when a crosstab
-- table was built, so a later correction - a data type or question type fix made after the
-- table was already saved - can be told apart from one the table already reflects. Null means
-- the table predates this column (nothing to compare against, so it is never flagged stale).
-- See IMP-005 and listCrosstabs() in src/lib/crosstabs.ts for how this is used.
alter table document_tables add column if not exists overrides_snapshot jsonb;
