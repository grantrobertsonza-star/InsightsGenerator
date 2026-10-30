-- CE-4 (evidence chain, 26 October 2026): the brief or proposal passage behind each objective.
--
-- An objective filled in from a brief or proposal recorded only which document(s) were read
-- (objective_candidates.source_document_ids, migration 0115); the passage it came from was not kept, and
-- brief and proposal were read as one text, so which of them stated an objective was lost. The reading
-- now names, for each objective and for the business problem, the document and the passage; the app
-- checks the passage against that document's text (quoteMatch.ts) and stores whether it was found.
--
-- field: 'objective' (objective_candidate_id set) or 'business_problem' (no candidate).
-- document_id: set null if the document is later removed; document_role and the quote remain.
-- verified: the quote appears in that document's text as read when the objective was filled.
-- Run npm run backup before applying.
create table if not exists brief_passages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  field text not null check (field in ('objective', 'business_problem')),
  objective_candidate_id uuid references objective_candidates(id) on delete cascade,
  document_id uuid references documents(id) on delete set null,
  document_role text not null check (document_role in ('brief', 'proposal')),
  quote text not null,
  verified boolean not null,
  created_at timestamptz not null default now(),
  check ((field = 'objective') = (objective_candidate_id is not null))
);
create index if not exists brief_passages_candidate_idx on brief_passages (objective_candidate_id);
create index if not exists brief_passages_run_idx on brief_passages (run_id, field);

alter table brief_passages enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'brief_passages' and policyname = 'tenant_isolation') then
    create policy tenant_isolation on brief_passages using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
