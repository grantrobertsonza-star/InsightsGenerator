-- Audit samples and stability checks for qualitative coding.
--
-- 1. The calibration sample can now be a random audit: turns drawn at random
--    within strata (turns with no code, and turns grouped by their rarest
--    code), so the result can be read as an estimate for the whole transcript.
--    kind = 'targeted' is the existing sample, which over-represents coded
--    turns and is not an estimate of anything beyond the sampled turns.
--    stratum_size is how many participant turns sat in the stratum when the
--    sample was drawn; it is the weight used for the estimate.
-- 2. coding_turn_stability keeps the result of re-applying the codebook to the
--    same turns: how many runs there were (the original counts as one), how
--    many of them gave the same set of codes as the original, the original's
--    codes, the codes other runs added and the ones they left out (1-based
--    codebook numbers), and when the researcher settled the turn.
-- Additive. Requires 0044.

alter table coding_calibration_samples
  add column if not exists kind text not null default 'targeted',
  add column if not exists stratum text,
  add column if not exists stratum_size integer;

alter table coding_calibration_samples drop constraint if exists coding_calibration_samples_kind_check;
alter table coding_calibration_samples add constraint coding_calibration_samples_kind_check
  check (kind in ('targeted', 'audit'));

create table if not exists coding_turn_stability (
  codebook_id uuid not null references coding_codebooks(id) on delete cascade,
  segment_id uuid not null references coding_segments(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  runs integer not null,
  agree integer not null,
  orig_codes integer[] not null default '{}',
  alt_codes integer[] not null default '{}',
  dropped_codes integer[] not null default '{}',
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (codebook_id, segment_id)
);

alter table coding_turn_stability enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'coding_turn_stability' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on coding_turn_stability
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;

alter table coding_run_manifest drop constraint if exists coding_run_manifest_stage_check;
alter table coding_run_manifest add constraint coding_run_manifest_stage_check
  check (stage in ('open_coding', 'consolidation', 'apply', 'summary', 'link_proposal', 'negative_case_search', 'stability_rerun'));
