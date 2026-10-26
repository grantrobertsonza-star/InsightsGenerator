-- INS-001: a synthesized insight's confidence counts INDEPENDENT evidence sources, not rows.
--
-- The defect: insightSynthesizer.ts set triangulation_count to the number of pre-insights in a
-- cluster and derived confidence_tier from it. Three pre-insights resting on one finding, or on
-- three findings computed from the same table, were rated as three corroborating sources.
--
--   finding_evidence_key(finding_id)   the one definition of which evidence a finding rests on:
--       a finding computed from a table          -> 'table:<source_table_id>'
--       a claim stated in a document             -> 'doc:<source_document_id>'
--       neither recorded                         -> 'finding:<id>' (counts only as itself)
--     A finding grounded by another finding (grounded_by_finding_id: a stated claim checked
--     against a computed result) takes the GROUNDING finding's key: the claim and the computation
--     that confirms it are one piece of evidence, not two.
--     Limitation (deliberate, documented): different tables from the same data file count as
--     different sources even though they share respondents, and every claim in one report counts
--     as one source. Null when the finding does not exist.
--
--   insight_confidence_tier(independent, themes)   the one definition of the tier thresholds:
--       strong       3+ independent sources spanning 2+ themes
--       moderate     3+ independent sources, or 2+ independent sources spanning 2+ themes
--       exploratory  otherwise (including any number of rows from a single source)
--     Never higher than the previous row-count rule, so applying it can only lower a tier.
--
--   synthesized_insights.independent_source_count   distinct evidence keys among the insight's
--     linked findings when it was drafted. Null = not checked. triangulation_count is unchanged:
--     it stays the number of source links written, which FND-001's deleted-source check
--     (supportStatusShared.ts) compares with the live link count.
--
-- Back-fill: existing insights get independent_source_count from their CURRENT links, and their
-- confidence_tier is recomputed with their recorded source_theme_count. A tier is only ever
-- lowered, never raised, and every change is written to trace ('ins001_confidence_corrected',
-- with the previous and corrected tier), so the correction is visible and auditable. An insight
-- with no remaining links is left unchanged (FND-001 already reports it as no longer supported).
-- Only computed fields change; no human wording or review decision is touched.
--
-- Idempotent: functions are create-or-replace, the column is add-if-not-exists, and the back-fill
-- only visits rows whose independent_source_count is still null. SECURITY INVOKER, so row-level
-- security on findings still applies to every application caller.

alter table synthesized_insights
  add column if not exists independent_source_count integer
    check (independent_source_count is null or independent_source_count >= 0);

comment on column synthesized_insights.independent_source_count is
  'INS-001: distinct finding_evidence_key values among the linked findings when drafted (null = not checked). '
  'confidence_tier is derived from this, not from triangulation_count.';

create or replace function finding_evidence_key(p_finding_id uuid)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    'table:' || e.source_table_id::text,
    'doc:' || e.source_document_id::text,
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
  where f.id = p_finding_id
$$;

comment on function finding_evidence_key(uuid) is
  'INS-001: which independent piece of evidence a finding rests on (table, document, or itself; '
  'a grounded claim shares its grounding finding''s key).';

create or replace function insight_confidence_tier(p_independent integer, p_themes integer)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select case
    when p_independent is null then null
    when p_independent >= 3 and coalesce(p_themes, 0) >= 2 then 'strong'
    when p_independent >= 3 or (p_independent >= 2 and coalesce(p_themes, 0) >= 2) then 'moderate'
    else 'exploratory'
  end
$$;

comment on function insight_confidence_tier(integer, integer) is
  'INS-001: confidence tier from independent sources and themes; null when independence is unknown.';

-- Back-fill (lower-only, traced). See header.
with counted as (
  select si.id,
         si.tenant_id,
         si.run_id,
         si.confidence_tier as previous_tier,
         count(distinct finding_evidence_key(pi.finding_id)) as independent,
         si.source_theme_count as themes
  from synthesized_insights si
  join synthesized_insight_sources s on s.synthesized_insight_id = si.id
  join insights pi on pi.id = s.pre_insight_id
  where si.independent_source_count is null
  group by si.id
),
decided as (
  select c.*,
         insight_confidence_tier(c.independent::integer, c.themes) as recomputed,
         case c.previous_tier when 'strong' then 3 when 'moderate' then 2 when 'exploratory' then 1 else 0 end as previous_rank,
         case insight_confidence_tier(c.independent::integer, c.themes)
           when 'strong' then 3 when 'moderate' then 2 when 'exploratory' then 1 else 0 end as recomputed_rank
  from counted c
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
       'ins001_confidence_corrected',
       jsonb_build_object(
         'synthesized_insight_id', d.id,
         'previous_tier', d.previous_tier,
         'corrected_tier', d.recomputed,
         'independent_source_count', d.independent,
         'source_theme_count', d.themes
       )
from decided d
join updated u on u.id = d.id
where d.previous_tier is not null and d.recomputed_rank < d.previous_rank;
