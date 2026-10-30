-- Waves of one tracking study count as one source (Grant, 27 October 2026: "a second wave of the same
-- tracker ... should count as the result holding over time, not as independent confirmation").
--
-- 0099 made a finding's evidence key the document its evidence comes from, so two data files are two
-- independent sources. Two waves of one tracker are different respondents but the same questionnaire,
-- method and study design: agreeing across them shows the result holding over time, not triangulation
-- by an independent source. A raw data file labelled as a wave (documents.data_setup->>'wave', set under
-- Import data) now has the project's study as its key:
--   a finding computed from a table of a labelled wave file -> 'study:<run_id>'
--   every other case                                       -> as 0099 ('doc:<document_id>', 'finding:<id>')
-- An unlabelled data file, a report or a transcript keeps its own document key. The key is coarser than
-- 0099's (it only merges), so recounted values can only fall.
--
-- Back-fill, as 0099: every insight with links is recounted; when the count falls, independent_source_count
-- is lowered and confidence_tier recomputed, lower-only, each tier change traced
-- ('waves_one_study_confidence_corrected'). No human wording or review decision is touched. A wave label
-- added or removed later changes the key for the next synthesis; stored counts are recomputed then.
-- Requires 0099. SECURITY INVOKER, as before.
-- Run npm run backup before applying.

create or replace function finding_evidence_key(p_finding_id uuid)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    case
      when d.kind = 'table' and d.ingestion_type = 'raw' and nullif(btrim(d.data_setup->>'wave'), '') is not null
        then 'study:' || d.run_id::text
    end,
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
  left join documents d on d.id = dt.document_id
  where f.id = p_finding_id
$$;

comment on function finding_evidence_key(uuid) is
  'INS-001: which independent piece of evidence a finding rests on: the document (data file or '
  'report) its evidence comes from, or the finding itself when none is recorded. A grounded claim '
  'shares its grounding finding''s key. Tables from one data file are one source (0099); data files '
  'labelled as waves of the project''s tracker are one study (0124).';

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
       'waves_one_study_confidence_corrected',
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
