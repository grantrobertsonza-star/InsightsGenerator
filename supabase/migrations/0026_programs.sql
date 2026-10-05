-- Tracking/longitudinal support, added as an optional attribute a project
-- (run) can pick up at any time rather than a separate "tracking mode"
-- chosen upfront. A program is one ongoing study a client commissions
-- across multiple waves (e.g. an annual member satisfaction survey); each
-- run that belongs to it is one wave, distinguished by wave_label (free
-- text: "Wave 1", "2026 Q1", "Pre-launch", whatever the client calls it).
--
-- runs.program_id is nullable on purpose: an ad hoc, one-off project never
-- sets it and nothing about its pipeline changes. The trend-insight and
-- theme-reconciliation work that reads across waves (not built yet) only
-- activates once a program actually has two or more runs attached to it,
-- so a freshly created program with a single wave behaves exactly like any
-- other project in the meantime.
create table if not exists programs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  created_at timestamptz not null default now()
);

alter table programs enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'programs' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on programs
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;

alter table runs add column if not exists program_id uuid references programs(id) on delete set null;
alter table runs add column if not exists wave_label text;

create index if not exists runs_program_id_idx on runs (program_id);
