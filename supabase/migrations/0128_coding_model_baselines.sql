-- Batch 61 (Codex STAB-F01 to STAB-F03, 28 October 2026): the stability check compares repeat applications
-- of a codebook with the model's own original coding, not with the coding as the researcher has since
-- edited it, and records how complete and comparable each check was.
--
--   coding_model_baselines   one row per model application of a codebook (extract, re-apply, codebook-only
--                            import), written in the same transaction as the coding_assignments it
--                            describes. decisions holds the model's own codes per turn
--                            ({segment_id: [code_id, ...]}) before any researcher change; model and
--                            prompt_hash are the values the apply calls used (prompt_hash includes the
--                            input preparation version); codebook_fingerprint and segmentation_fingerprint
--                            identify the codebook definitions and the turns as applied; the batch counts
--                            are the apply's completeness (complete only when failed and incomplete are 0).
--                            Rows are never updated: a trigger refuses updates. They go only when their
--                            codebook or document is deleted.
--   coding_stability_checks  one row per codebook: the latest saved check, which baseline it compared
--                            with, passes requested and complete, and the passes left out with the reason.
--
-- Existing projects: no baseline is back-filled. Their current coding_assignments may already hold
-- researcher removals or majority settlement, so the original model decisions cannot be recovered; the
-- app shows the baseline as unknown and offers a fresh application. Existing coding_turn_stability rows
-- stay, shown as checked before completeness and method were recorded.
--
-- Additive and idempotent. Written for batch 61; not applied to any database as part of it. Run
-- `npm run backup -- --local` before applying.

create table if not exists coding_model_baselines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  codebook_id uuid not null references coding_codebooks(id) on delete cascade,
  model text not null,
  prompt_hash text not null,
  codebook_fingerprint jsonb not null,
  segmentation_fingerprint text not null,
  total_batches integer not null check (total_batches >= 0),
  failed_batches integer not null check (failed_batches >= 0),
  incomplete_batches integer not null check (incomplete_batches >= 0),
  decisions jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists coding_model_baselines_book_idx on coding_model_baselines (codebook_id, created_at desc);

alter table coding_model_baselines enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'coding_model_baselines' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on coding_model_baselines
      using (tenant_id = current_setting('app.current_tenant_id')::uuid)
      with check (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;

-- The one permitted change is the project a baseline belongs to: removing its transcript to the bin, and
-- restoring it, move the transcript's rows between the project and its bin (documentBin, MOVED_WITH_DOCUMENT).
-- Every recorded decision, and everything else on the row, stays as written.
create or replace function coding_model_baselines_immutable() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'run_id') = (to_jsonb(old) - 'run_id') then
    return new;
  end if;
  raise exception 'coding_model_baselines rows are never changed; write a new baseline instead';
end $$;

drop trigger if exists coding_model_baselines_no_update on coding_model_baselines;
create trigger coding_model_baselines_no_update
  before update on coding_model_baselines
  for each row execute function coding_model_baselines_immutable();

create table if not exists coding_stability_checks (
  codebook_id uuid primary key references coding_codebooks(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  baseline_id uuid not null references coding_model_baselines(id) on delete cascade,
  model text not null,
  prompt_hash text not null,
  passes_requested integer not null check (passes_requested >= 1),
  passes_complete integer not null check (passes_complete >= 1),
  excluded jsonb not null default '[]',
  created_at timestamptz not null default now()
);

alter table coding_stability_checks enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'coding_stability_checks' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on coding_stability_checks
      using (tenant_id = current_setting('app.current_tenant_id')::uuid)
      with check (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
