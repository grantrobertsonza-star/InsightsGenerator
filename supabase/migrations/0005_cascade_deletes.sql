-- Lets deleting a run clean up everything that belongs to it (documents,
-- claims, verdicts, insights, recommendations, review log, trace), instead
-- of failing on foreign key constraints or leaving orphaned rows behind.
-- Uploaded files in Storage are not covered by this (Postgres doesn't know
-- about them); the application deletes those separately before removing
-- the run.

alter table documents drop constraint documents_run_id_fkey,
  add constraint documents_run_id_fkey foreign key (run_id) references runs(id) on delete cascade;

alter table evidence_chunks drop constraint evidence_chunks_document_id_fkey,
  add constraint evidence_chunks_document_id_fkey foreign key (document_id) references documents(id) on delete cascade;

alter table claims drop constraint claims_run_id_fkey,
  add constraint claims_run_id_fkey foreign key (run_id) references runs(id) on delete cascade;

alter table verdicts drop constraint verdicts_claim_id_fkey,
  add constraint verdicts_claim_id_fkey foreign key (claim_id) references claims(id) on delete cascade;

alter table insights drop constraint insights_run_id_fkey,
  add constraint insights_run_id_fkey foreign key (run_id) references runs(id) on delete cascade;

alter table insights drop constraint insights_claim_id_fkey,
  add constraint insights_claim_id_fkey foreign key (claim_id) references claims(id) on delete cascade;

alter table recommendations drop constraint recommendations_insight_id_fkey,
  add constraint recommendations_insight_id_fkey foreign key (insight_id) references insights(id) on delete cascade;

alter table review_log drop constraint review_log_run_id_fkey,
  add constraint review_log_run_id_fkey foreign key (run_id) references runs(id) on delete cascade;

alter table trace drop constraint trace_run_id_fkey,
  add constraint trace_run_id_fkey foreign key (run_id) references runs(id) on delete cascade;
