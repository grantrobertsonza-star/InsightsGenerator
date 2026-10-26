-- FND-001 / REP-OUT-001 and ANA-NPS-003 downstream freshness: record what each synthesized
-- insight's supporting evidence was when the insight was drafted, so a later in-place change can
-- be detected.
--
-- Why a count is not enough: the export guard added for FND-001 (Brief 35) compares the live
-- number of non-rejected linked findings with triangulation_count. That catches rejection and
-- cascade deletion, but several writers rewrite a finding IN PLACE, keeping its id
-- (brandHealthActions, csmActions and waveTrackingActions overwrite finding_text/stated_stats on
-- re-run; verifyFindings and regroundFindings replace verdicts; contradictionDetector updates
-- them). The count stays the same while the evidence changes.
--
--   finding_support_parts(finding_id)  the one definition of a finding's support fingerprint:
--                                      md5 of its wording, md5 of its stated figures, its latest
--                                      verdict tier, and (for a finding from a calculated table)
--                                      md5 of that table's recorded design and corrections
--                                      snapshots. Null when the finding does not exist. Used both
--                                      when an insight is drafted and when it is checked, so the
--                                      two can never be computed differently.
--   synthesized_insight_sources.support_snapshot
--                                      the parts as they were when the insight was drafted.
--                                      Nullable: rows written before this migration stay null
--                                      and are reported as "not checked", never as current.
--
-- Nothing is back-filled: there is no way to know what an existing insight was drafted from, so
-- existing sources stay unknown rather than being stamped with today's values. Additive and
-- idempotent (create or replace / add column if not exists). SECURITY INVOKER, so row-level
-- security on findings, verdicts and document_tables still applies to every caller.
-- Written for this repair; not applied to any database as part of it.

alter table synthesized_insight_sources
  add column if not exists support_snapshot jsonb;

create or replace function finding_support_parts(p_finding_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'wording', md5(coalesce(f.finding_text, '')),
    'figures', md5(coalesce(f.stated_stats::text, '')),
    'verdict', (
      select v.verdict_tier
      from verdicts v
      where v.finding_id = f.id
      order by v.created_at desc, v.id desc
      limit 1
    ),
    'calculation', case
      when dt.id is null or dt.crosstab is null then null
      else md5(coalesce(dt.design_snapshot::text, '') || chr(31) || coalesce(dt.overrides_snapshot::text, ''))
    end
  )
  from findings f
  left join document_tables dt on dt.id = f.source_table_id
  where f.id = p_finding_id
$$;

comment on function finding_support_parts(uuid) is
  'FND-001: support fingerprint of one finding (wording, figures, latest verdict tier, calculated-table settings). '
  'Compared with synthesized_insight_sources.support_snapshot to tell whether an insight''s support changed since it was drafted.';
