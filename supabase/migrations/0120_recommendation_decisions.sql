-- CE-2 (evidence chain, 26 October 2026): which decision each recommendation serves.
--
-- The recommendation prompt has always asked the model to "tie each recommendation to whichever
-- [decision] it actually serves", but the answer was never stored: a recommendation kept only a copy of
-- the whole decision statement (decision_context), so with several decisions nothing said which one an
-- action was for. One row per decision a recommendation serves.
--
-- decision_candidate_id: the accepted decision, when the project's decisions are candidates; set null if
-- that candidate is later deleted, and the wording stays in decision_text. A project whose decisions are
-- only free text stores the numbered line's wording with a null id.
-- origin: 'model' (proposed when the recommendation was written) or 'researcher' (chosen by hand).
-- Run npm run backup before applying.

create table if not exists recommendation_decisions (
  recommendation_id uuid not null references recommendations(id) on delete cascade,
  decision_candidate_id uuid references decision_candidates(id) on delete set null,
  decision_text text not null,
  position int not null,
  origin text not null check (origin in ('model', 'researcher')),
  tenant_id uuid not null references tenants(id),
  created_at timestamptz not null default now(),
  primary key (recommendation_id, position)
);
create index if not exists recommendation_decisions_decision_idx on recommendation_decisions (decision_candidate_id);

alter table recommendation_decisions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'recommendation_decisions' and policyname = 'tenant_isolation') then
    create policy tenant_isolation on recommendation_decisions using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
