-- ANA-NPS-003 (second counter-review): captures the survey design actually applied when a
-- crosstab table was built (request.design as sent to the engine - null means weights only, not
-- "unknown"), so a later change to the document's persisted design setting (DataSetup.design,
-- dataSetupShared.ts) can be told apart from one the table already reflects. Mirrors
-- overrides_snapshot (migration 0078) exactly: null means the table predates this column
-- (nothing to compare against, so it is never flagged stale). See listCrosstabs() in
-- src/lib/crosstabs.ts for how this is used.
alter table document_tables add column if not exists design_snapshot jsonb;
