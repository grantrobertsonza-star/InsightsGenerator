-- CE-1 (evidence chain, 26 October 2026): objective coverage keyed by identity, with its inputs recorded.
--
-- objective_validations named the objective or decision it judged only by its text (item_text), and
-- listed the insights that bear on it in a uuid[] with no foreign key, so a deleted or re-synthesised
-- insight left a dangling id. Nothing recorded what the coverage was assessed against, so after an
-- insight was accepted or rejected, or an objective changed and the automatic re-check failed, the old
-- verdicts were still shown as current.
--
-- 1. objective_candidate_id / decision_candidate_id: the accepted candidate a row judges (null for an
--    item parsed from the project's own free text, and set null if that candidate is later deleted, so
--    a row never points at a different item).
-- 2. objective_validation_insights: the insights a row cites, with foreign keys on both sides, in the
--    order the model gave them. The legacy uuid[] column is still written for older readers.
-- 3. inputs: the fingerprints of what the coverage was assessed against (accepted insights, objectives,
--    decisions and the project's own objective and decision text). A reader compares them with the
--    current inputs; any difference means the coverage is out of date, whatever caused it.
-- Run npm run backup before applying.

alter table objective_validations add column if not exists objective_candidate_id uuid references objective_candidates(id) on delete set null;
alter table objective_validations add column if not exists decision_candidate_id uuid references decision_candidates(id) on delete set null;
alter table objective_validations add column if not exists inputs jsonb;

create table if not exists objective_validation_insights (
  validation_id uuid not null references objective_validations(id) on delete cascade,
  synthesized_insight_id uuid not null references synthesized_insights(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  position int not null,
  primary key (validation_id, synthesized_insight_id)
);
create index if not exists objective_validation_insights_insight_idx on objective_validation_insights (synthesized_insight_id);

alter table objective_validation_insights enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'objective_validation_insights' and policyname = 'tenant_isolation') then
    create policy tenant_isolation on objective_validation_insights using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
