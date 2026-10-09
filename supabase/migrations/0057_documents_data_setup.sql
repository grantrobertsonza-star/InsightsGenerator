-- Set-up choices for raw (case-level) data files, the counterpart of the
-- transcript set-up: what a case is, how the file is laid out, and how the
-- data was collected. Stored as JSON on the document, for example
-- {"unit":"respondents","layout":"rows_are_cases","method":"survey"}.
-- A null value means the defaults apply (respondents, rows are cases, survey).
alter table documents add column if not exists data_setup jsonb;
