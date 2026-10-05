-- Same pattern as decision_candidates (0013), one step upstream: a
-- candidate research objective or hypothesis this project's evidence
-- appears organized to address, rather than a candidate decision a
-- stakeholder is facing. Kept as its own table rather than folded into
-- decision_candidates because the two are reviewed on separate screens and
-- accepting one has a different effect (it syncs runs.research_objective,
-- not runs.decision_statement).
create table objective_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  candidate_text text not null,
  rationale text not null,
  source text not null check (source in ('researcher_authored', 'ai_suggested')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected')),
  edited boolean not null default false,
  created_at timestamptz not null default now()
);

alter table objective_candidates enable row level security;
create policy tenant_isolation on objective_candidates
  using (tenant_id = current_setting('app.current_tenant_id')::uuid);
