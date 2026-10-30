-- D2 (Grant, 29 October 2026): the researcher's choices for a programme's automatic tracker dashboards (main
-- brand, answers that are not brands, a question's funnel stage, the CSM roles, weighted or not, hidden
-- charts), kept once per programme so they carry to every wave ("Ok, lets start with programme"). A project
-- in no programme keeps its own. What the app suggests is not stored as a choice: it is worked out from each
-- wave's file when the dashboard opens, so a new wave gets its own suggestions and the choices are checked
-- against it variable by variable. `suggested` records what was suggested when the choices were last saved.
-- Every save is a compare-and-swap on `revision`. Reset to suggested clears `choices` and keeps them in
-- `previous_choices`. Deleting a programme deletes its dashboard choices; deleting a wave's file keeps them.
-- Additive and idempotent. Written for this batch; not applied to any database as part of it. Run
-- `npm run backup -- --local` before applying.
create table if not exists tracker_dashboards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  program_id uuid references programs(id) on delete cascade,
  run_id uuid references runs(id) on delete cascade,
  revision integer not null default 1 check (revision >= 1),
  choices jsonb not null default '{}'::jsonb check (jsonb_typeof(choices) = 'object'),
  choices_run_id uuid references runs(id) on delete set null,
  choices_document_id uuid references documents(id) on delete set null,
  choices_by text,
  choices_at timestamptz,
  suggested jsonb,
  previous_choices jsonb,
  reset_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One scope: a programme, or a project in no programme.
  constraint tracker_dashboards_one_scope check ((program_id is null) <> (run_id is null))
);

create unique index if not exists tracker_dashboards_program_idx on tracker_dashboards (tenant_id, program_id) where program_id is not null;
create unique index if not exists tracker_dashboards_run_idx on tracker_dashboards (tenant_id, run_id) where run_id is not null;

alter table tracker_dashboards enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'tracker_dashboards' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on tracker_dashboards
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
