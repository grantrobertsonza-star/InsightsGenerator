-- The tables 0052 skipped because they were renamed (claims became findings)
-- or use different column names (trace uses occurred_at).
create index if not exists idx_findings_run_id on findings (run_id);
create index if not exists idx_findings_source_document_id on findings (source_document_id);
create index if not exists idx_findings_source_table_id on findings (source_table_id);
create index if not exists idx_verdicts_finding_id on verdicts (finding_id);
create index if not exists idx_trace_run_event_time on trace (run_id, event, occurred_at desc);
