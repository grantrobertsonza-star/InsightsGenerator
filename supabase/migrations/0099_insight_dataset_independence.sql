-- INS-001 (correction after Codex review, 2026-10-16): one dataset is one independent source.
--
-- The defect: 0097's finding_evidence_key() keyed a computed finding by its TABLE
-- ('table:<document_tables.id>'). Several tables cut from one data file share the same
-- respondents, yet counted as several independent sources, so three findings from three tables of
-- one survey could reach "strong" confidence.
--
-- The rule now (conservative): a finding's evidence key is the DOCUMENT its evidence comes from.
--   a finding computed from a table   -> 'doc:<document_tables.document_id>'  (the data file)
--   a claim stated in a document      -> 'doc:<source_document_id>'
--   neither recorded                  -> 'finding:<id>' (counts only as itself)
-- A finding grounded by another finding still takes the grounding finding's key. A table and a
-- claim taken from the same document are therefore one source as well.
-- Genuinely different data files and different reports remain different sources.
-- Limitation (documented): two files that are copies or exports of the same survey cannot be
-- recognised as one dataset and still count twice; nothing here can establish that they are the
-- same respondents.
--
-- The key is coarser than 0097's (it only merges, never splits), so recomputed counts can only
-- fall. Back-fill: every insight with links is recounted with the new key. When the count falls,
-- independent_source_count is lowered and confidence_tier is recomputed with the recorded
-- source_theme_count, lower-only, and each tier change is traced
-- ('ins001_dataset_confidence_corrected'). Rows whose count does not change are untouched, so a
-- rerun changes nothing. Only computed fields change; no human wording or review decision is
-- touched.
--
-- Requires 0097 (insight_confidence_tier, independent_source_count). SECURITY INVOKER, so
-- row-level security on findings and document_tables still applies to application callers.

create or replace function finding_evidence_key(p_finding_id uuid)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    'doc:' || coalesce(dt.document_id, e.source_document_id)::text,
    'finding:' || e.id::text
  )
  from findings f
  left join findings g on g.id = f.grounded_by_finding_id
  -- The grounding finding's identity when there is one, otherwise the finding's own.
  cross join lateral (
    select case when g.id is not null then g.id else f.id end as id,
           case when g.id is not null then g.source_table_id else f.source_table_id end as source_table_id,
           case when g.id is not null then g.source_document_id else f.source_document_id end as source_document_id
  ) e
  left join document_tables dt on dt.id = e.source_table_id
  where f.id = p_finding_id
$$;

comment on function finding_evidence_key(uuid) is
  'INS-001: which independent piece of evidence a finding rests on: the document (data file or '
  'report) its evidence comes from, or the finding itself when none is recorded. A grounded claim '
  'shares its grounding finding''s key. Tables from one data file are one source (0099).';

-- Back-fill (lower-only, traced). See header.
with counted as (
  select si.id,
         si.tenant_id,
         si.run_id,
         si.confidence_tier as previous_tier,
         si.independent_source_count as previous_count,
         count(distinct finding_evidence_key(pi.finding_id)) as independent,
         si.source_theme_count as themes
  from synthesized_insights si
  join synthesized_insight_sources s on s.synthesized_insight_id = si.id
  join insights pi on pi.id = s.pre_insight_id
  group by si.id
),
decided as (
  select c.*,
         insight_confidence_tier(c.independent::integer, c.themes::integer) as recomputed,
         case c.previous_tier when 'strong' then 3 when 'moderate' then 2 when 'exploratory' then 1 else 0 end as previous_rank,
         case insight_confidence_tier(c.independent::integer, c.themes::integer)
           when 'strong' then 3 when 'moderate' then 2 when 'exploratory' then 1 else 0 end as recomputed_rank
  from counted c
  where c.previous_count is null or c.independent < c.previous_count
),
updated as (
  update synthesized_insights si
     set independent_source_count = d.independent,
         confidence_tier = case
           when d.previous_tier is not null and d.recomputed_rank < d.previous_rank then d.recomputed
           else si.confidence_tier
         end
    from decided d
   where si.id = d.id
  returning si.id
)
insert into trace (tenant_id, run_id, event, detail)
select d.tenant_id,
       d.run_id,
       'ins001_dataset_confidence_corrected',
       jsonb_build_object(
         'synthesized_insight_id', d.id,
         'previous_tier', d.previous_tier,
         'corrected_tier', d.recomputed,
         'previous_independent_source_count', d.previous_count,
         'independent_source_count', d.independent,
         'source_theme_count', d.themes
       )
from decided d
join updated u on u.id = d.id
where d.previous_tier is not null and d.recomputed_rank < d.previous_rank;
