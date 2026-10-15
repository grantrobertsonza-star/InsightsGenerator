-- OBJ-REV-009 (third pass): gives each replacement of a run's automatic evidence questions a
-- real, explicit identity ("generation"), instead of matching the current question set to its
-- coverage/truncation verdict by "whichever trace row happens to be most recent." The prior
-- shape (one write to objective_evidence, a SEPARATE best-effort write to the trace table,
-- matched at read time only by timestamp ordering) could not guarantee the two described the
-- same generation: a failure in the second write left the first write's new questions in
-- effect under a stale warning, and two overlapping generateEvidenceQuestions() calls could
-- commit their trace rows in a different relative order from their question-replacement
-- commits, so "most recent trace row" did not reliably mean "the warning for the question set
-- actually in effect."
--
-- A generation's coverage verdict (variables_truncated/pooled_count/used_count) now lives on
-- its own row here. objective_evidence.generation_id (added below) ties each
-- automatically-generated question back to the exact generation that wrote it - null for a
-- row the researcher has edited or added manually (a generation's identity describes an
-- automatic replacement pass, not a researcher's own decision) or for a row written before
-- this migration. is_current marks the one generation per run whose questions are presently
-- in objective_evidence; the partial unique index below makes "more than one current
-- generation for a run" a constraint violation rather than just an application convention -
-- generateEvidenceQuestions demotes the prior current generation and promotes the new one in
-- the SAME transaction that replaces the questions, serialized by a `for update` lock taken on
-- the run row itself before any of this runs (see objectiveEvidence.ts), so the two can never
-- drift apart even under overlapping calls.
-- Run npm run backup before applying. Needs 0066 first.

create table if not exists objective_evidence_generations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  variables_truncated boolean not null,
  pooled_count int not null,
  used_count int not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists objective_evidence_generations_run_idx on objective_evidence_generations (run_id);

-- At most one current generation per run. A backstop invariant, not the only thing preventing
-- two: generateEvidenceQuestions already serializes publication with a `for update` lock on
-- the run row before it ever demotes or promotes a generation - this index is what turns a
-- bug that somehow bypassed that lock into a loud constraint violation instead of two rows
-- silently both reading as "current."
create unique index if not exists objective_evidence_generations_one_current_idx
  on objective_evidence_generations (run_id) where is_current;

alter table objective_evidence_generations enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'objective_evidence_generations' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on objective_evidence_generations
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;

alter table objective_evidence add column if not exists generation_id uuid references objective_evidence_generations(id) on delete set null;
create index if not exists objective_evidence_generation_idx on objective_evidence (generation_id) where generation_id is not null;
