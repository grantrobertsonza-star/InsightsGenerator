-- Adds candidate decision statements as their own table, so the decision
-- framer's suggestions and the researcher's own upfront text sit in one
-- reviewable list rather than the researcher having to reconcile a
-- separate free-text field against a set of AI proposals by hand.

create table decision_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  candidate_text text not null,
  rationale text not null,
  source text not null check (source in ('researcher_authored', 'ai_suggested')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected')),
  -- true when an ai_suggested candidate's text was changed before being
  -- accepted, shown on the review screen the same way an origin tag
  -- distinguishes a stated claim from a generated one.
  edited boolean not null default false,
  created_at timestamptz not null default now()
);

alter table decision_candidates enable row level security;
create policy tenant_isolation on decision_candidates
  using (tenant_id = current_setting('app.current_tenant_id')::uuid);
