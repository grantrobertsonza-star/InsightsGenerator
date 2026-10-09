-- Wide survey files (SPSS/Stata/SAS) are not loaded as one big table. The
-- document keeps a small dictionary of its variables, and each crosstab a
-- researcher builds from the file is saved as an aggregated table whose full
-- result (percentages, bases, significance flags) is kept in `crosstab`.
alter table documents add column if not exists variable_dictionary jsonb;
alter table document_tables add column if not exists crosstab jsonb;
