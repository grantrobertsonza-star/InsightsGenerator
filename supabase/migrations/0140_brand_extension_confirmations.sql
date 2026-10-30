-- r6brandext (Grant, 30 October 2026): the researcher's confirmations for the brand dashboard extension (needs fit,
-- differentiation, price justification, the same-episode ideal and actual choice, and its reasons), kept once per
-- programme (or per project in no programme), like tracker_dashboards (0132). Detection runs on every read; only
-- what the researcher decided is stored: for a construct in review, which candidate questions it is (by their
-- variable names) or that the file does not measure it; and confirmed aliases of Other brand names (a normalised
-- name to a tracked brand's code, or to another Other name). Each entry carries who confirmed it, when, and from
-- which data file (provenance). Every save is a compare-and-swap on `revision`; the replaced set is kept in
-- `previous_confirmations`. Additive and idempotent. Written for this batch; not applied to any database as part of
-- it. Run `npm run backup -- --local` before applying.
create table if not exists brand_extension_confirmations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  program_id uuid references programs(id) on delete cascade,
  run_id uuid references runs(id) on delete cascade,
  revision integer not null default 1 check (revision >= 1),
  confirmations jsonb not null default '{}'::jsonb check (jsonb_typeof(confirmations) = 'object'),
  previous_confirmations jsonb,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One scope: a programme, or a project in no programme.
  constraint brand_extension_confirmations_one_scope check ((program_id is null) <> (run_id is null))
);

create unique index if not exists brand_extension_confirmations_program_idx on brand_extension_confirmations (tenant_id, program_id) where program_id is not null;
create unique index if not exists brand_extension_confirmations_run_idx on brand_extension_confirmations (tenant_id, run_id) where run_id is not null;

alter table brand_extension_confirmations enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'brand_extension_confirmations' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on brand_extension_confirmations
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
