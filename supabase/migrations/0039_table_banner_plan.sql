-- Schema only: the dedicated raw-data statistical path (Python/samplics)
-- this feeds doesn't exist yet. These columns give the eventual banner-plan
-- UI somewhere to write to, and let a raw table sit "awaiting_statistical_path"
-- (see generateFindingsFromTable.ts and 0038_table_ingestion_type.sql) with
-- its plan already captured, if one was given, rather than losing it.
--
-- banner_columns: the segmenting/breaking variables (e.g. Gender, Age band,
-- Region) a person names from the table's own headers. Per the 2026-10-04
-- decision, every category within a named banner column is compared
-- against every other by default (standard market-research tab-plan
-- behavior: naming Gender as a banner automatically compares Male vs
-- Female), not a search across all columns in the table the way the
-- disabled decision-stump search once did -- the discipline is in which
-- columns get named as banners at all, not in limiting comparisons within
-- one once it's named.
--
-- stub_columns: the outcome measures to test each banner column against.
--
-- sampling_design: null for quota/simple-random-assumed sampling (the
-- common case per the 2026-10-04 statistical methodology discussion).
-- Populated only when the data comes from a genuine stratified design (the
-- MBA-thesis case), naming the strata and weight columns the design needs
-- to recreate, e.g. {"strataColumn": "region", "weightColumn": "design_weight"}.
alter table document_tables
  add column if not exists banner_columns jsonb,
  add column if not exists stub_columns jsonb,
  add column if not exists sampling_design jsonb;
