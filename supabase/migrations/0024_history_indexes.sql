-- document_tables, finding_history and insight_history are all queried by
-- run_id (the "Preview extracted table" view, the "History" audit trail,
-- and its insight join) but only ever got a primary key and whatever
-- uniqueness constraints their own migrations needed. Fine at today's data
-- volumes, since a single run's row count is still small, but a sequential
-- scan of the whole table on every run-page load stops being free once
-- this project accumulates many runs and many reprocessed documents. These
-- indexes are the ones those exact queries filter or join on.
create index if not exists document_tables_run_id_idx on document_tables (run_id);
create index if not exists finding_history_run_id_idx on finding_history (run_id);
create index if not exists insight_history_run_id_idx on insight_history (run_id);
