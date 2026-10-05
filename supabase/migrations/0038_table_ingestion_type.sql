-- Raw (case-level, one row per respondent) and aggregated (already-tabulated
-- cross-tab) tables need genuinely different statistical treatment: an
-- aggregated table's own reported cross-tab is the evidence, so the
-- existing exploratory scan in tableComputation.ts (segment_difference,
-- relationship) is an acceptable, industry-standard pass over a handful of
-- supplied columns, caveated with uncorrected_multiple_comparisons. A raw
-- upload can have dozens of columns and thousands of rows, so the same scan
-- over it is a much larger uncorrected multiple-comparisons problem, the
-- same shape as the decision-stump search already disabled in
-- tableComputation.ts. Per the 2026-10-04 decision, raw data is never run
-- through that scan: it is rerouted to a dedicated statistical path (a
-- future banner-plan-driven service), no exception.
--
-- This can only be set by the person uploading, never inferred: a file's
-- own shape doesn't reliably say which kind of table it is, and guessing
-- wrong here is exactly the failure mode this migration exists to prevent.
--
-- ingestion_type lives on documents (the thing actually uploaded, where the
-- choice is made) and is copied down onto document_tables (where
-- tableComputation.ts's caller actually needs to read it) at extraction
-- time, so that caller never has to join back to documents.
--
-- Named ingestion_type, not data_type, to avoid colliding in meaning with
-- findings.data_type ('quantitative'/'qualitative'), an unrelated concept
-- on a different table.
alter table documents
  add column if not exists ingestion_type text check (ingestion_type in ('raw', 'aggregated'));

alter table documents
  add constraint documents_table_requires_ingestion_type
  check (kind != 'table' or ingestion_type is not null) not valid;

-- Existing 'table' documents predate this column and have no way to know
-- which kind they were. Backfilling them all as 'aggregated' is a
-- deliberate, disclosed assumption, not a guess dressed up as data: every
-- table document so far has in fact gone through the aggregated-table
-- scan (tableComputation.ts), since the raw/aggregated distinction didn't
-- exist before now, so this backfill keeps their behavior unchanged rather
-- than silently reclassifying and parking them.
update documents
set ingestion_type = 'aggregated'
where kind = 'table' and ingestion_type is null;

alter table documents
  validate constraint documents_table_requires_ingestion_type;

alter table document_tables
  add column if not exists ingestion_type text not null default 'aggregated'
    check (ingestion_type in ('raw', 'aggregated'));

alter table document_tables
  alter column ingestion_type drop default;

update document_tables dt
set ingestion_type = d.ingestion_type
from documents d
where dt.document_id = d.id and d.ingestion_type is not null;
