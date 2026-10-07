-- Splits the findings pool, right before the report is built, into
-- validated insights (anything that traces back to something the original
-- report or transcript already said) and net-new insights (anything that
-- only exists because the Elevator's own analysis surfaced it: mined from
-- raw tables, or synthesized across claims). That label is derived in code
-- (src/lib/discoveryClassification.ts) from columns that already exist
-- (origin, grounded_by_finding_id, synthesized_insight_sources), so it
-- cannot drift out of sync with them and needs no backfill. What does need
-- storing is below.

-- 1. Contradictions. A net-new finding or synthesized insight that
-- conflicts with something the report said is a correction, not an
-- addition, so it gets its own link back to the claim it undercuts. The
-- contradicted original is also downgraded to not_supported in code (see
-- contradictionDetector.ts), whatever else it had going for it; this table
-- is the record of why, and what the UI and report read to flag it.
create table if not exists finding_contradictions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  original_finding_id uuid not null references findings(id) on delete cascade,
  contradicting_finding_id uuid references findings(id) on delete cascade,
  contradicting_synthesized_insight_id uuid references synthesized_insights(id) on delete cascade,
  rationale text not null,
  detected_by text not null check (detected_by in ('chain_trace', 'synthesis_check')),
  created_at timestamptz not null default now(),
  constraint finding_contradictions_has_one_contradictor
    check (num_nonnulls(contradicting_finding_id, contradicting_synthesized_insight_id) = 1)
);

create unique index if not exists finding_contradictions_finding_pair_idx
  on finding_contradictions (original_finding_id, contradicting_finding_id)
  where contradicting_finding_id is not null;
create unique index if not exists finding_contradictions_synth_pair_idx
  on finding_contradictions (original_finding_id, contradicting_synthesized_insight_id)
  where contradicting_synthesized_insight_id is not null;
create index if not exists finding_contradictions_run_id_idx on finding_contradictions (run_id);

alter table finding_contradictions enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'finding_contradictions' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on finding_contradictions
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;

-- Marks a synthesized insight as already compared against the report's own
-- claims, so the contradiction check runs once per insight rather than on
-- every refresh.
alter table synthesized_insights
  add column if not exists contradiction_checked_at timestamptz;

-- 2. Verification basis. verdict_tier only means "checked against data"
-- when there was data to check against. A verdict that rested on the
-- report's own wording alone (a report with no tables behind it, or a
-- claim no computed pattern matches) is not the same thing as one backed by
-- code-computed statistics, and a client must be able to tell "we could not
-- check this" apart from "we checked this and it did not hold up". Default
-- is the conservative value: nothing is claimed to be data-backed unless
-- the code that wrote the verdict could show it was.
alter table verdicts
  add column if not exists verification_basis text not null default 'report_only'
    check (verification_basis in ('data_backed', 'report_only'));

-- Backfill existing verdicts with the same rule the code now applies:
-- computed findings, findings grounded in a computed pattern, and
-- chain-trace verdicts that relied on at least one computed finding are
-- data-backed; everything else stays report_only.
update verdicts v
set verification_basis = 'data_backed'
from findings f
where f.id = v.finding_id
  and (f.origin = 'generated' or f.grounded_by_finding_id is not null);

update verdicts v
set verification_basis = 'data_backed'
where v.verification_method = 'chain_trace'
  and exists (
    select 1
    from jsonb_array_elements_text(coalesce(v.due_care->'relied_finding_ids', '[]'::jsonb)) as rid(id)
    join findings rf on rf.id = rid.id::uuid
    where rf.origin = 'generated'
  );
