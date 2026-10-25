-- One reader for CSV, TSV and Excel (Grant, 2026-10-24; Codex TP500-F01/F02, IP1000-F01 to F04).
-- A stored table read by the statistical engine records how it was read: the engine reader, the sheet,
-- the data layout, a CSV's text encoding and the columns holding calendar dates. A table without it
-- (read by the retired TypeScript preview reader, or before this migration) is checked against a fresh
-- read before it is shown (importPreviewIdentity.ts). Additive; existing rows are unaffected.
alter table document_tables add column if not exists read_provenance jsonb;
