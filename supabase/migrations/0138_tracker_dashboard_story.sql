-- R5story (Grant, 30 October 2026): the brand tracking dashboard as a self-contained story. AI insights for a
-- dashboard page, and the executive summary and conclusions drafted from accepted insights, are kept here with the
-- figures they were drafted from, so they show as stale when the page's figures change, and so the researcher's
-- decisions (accept, edit, discard) and wording survive a reload and a regeneration.
--
--   tracker_dashboard_ai           one AI draft: an insight of a page (kind 'insight'), or the module's executive
--                                  summary or conclusions (kind 'summary' / 'conclusions', page '_module').
--                                  `figures` is the structured input the model was given and `figures_hash` its
--                                  hash; `model_text` is what was drafted (after the code's own qualification),
--                                  `text` the current wording; `human_edited` records a researcher's edit apart
--                                  from `status` (draft, accepted, discarded, refused: refused drafts failed the
--                                  figure or claim check and are kept with `check_note` so the refusal is visible).
--                                  `finding_id` is the finding an accepted insight was posted as.
--   tracker_dashboard_ai_requests  the latest generation asked for one page and kind: a model answer is written
--                                  only while its request is still the latest, so a late answer never replaces a
--                                  newer one.
-- Additive and idempotent. Written for this batch; not applied to any database as part of it. Run
-- `npm run backup -- --local` before applying.
create table if not exists tracker_dashboard_ai (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  page text not null,
  kind text not null check (kind in ('insight', 'summary', 'conclusions')),
  request_id uuid not null,
  position integer not null default 0,
  figures_hash text not null,
  figures jsonb not null,
  model_text text not null,
  text text not null,
  human_edited boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'accepted', 'discarded', 'refused')),
  figure_check jsonb,
  check_note text,
  finding_id uuid references findings(id) on delete set null,
  -- Compare-and-swap for every decision and edit: the screen sends the revision it read.
  revision integer not null default 1 check (revision >= 1),
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists tracker_dashboard_ai_page_idx on tracker_dashboard_ai (tenant_id, document_id, page, kind);

create table if not exists tracker_dashboard_ai_requests (
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  page text not null,
  kind text not null,
  latest_request uuid not null,
  requested_at timestamptz not null default now(),
  primary key (tenant_id, document_id, page, kind)
);

alter table tracker_dashboard_ai enable row level security;
alter table tracker_dashboard_ai_requests enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'tracker_dashboard_ai' and policyname = 'tenant_isolation') then
    create policy tenant_isolation on tracker_dashboard_ai using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'tracker_dashboard_ai_requests' and policyname = 'tenant_isolation') then
    create policy tenant_isolation on tracker_dashboard_ai_requests using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
