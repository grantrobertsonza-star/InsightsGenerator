-- Insight quality scoring, additive only: every insight this pipeline
-- already produces keeps existing exactly as it does today. These columns
-- add a second, independent axis next to verdict_tier (which judges the
-- underlying finding's evidentiary strength, not the insight built on top
-- of it). Nothing here filters or drops an insight; a low score just sorts
-- it lower and is a signal a researcher can act on, not a gate.
--
-- Five 1/3/5-scored dimensions (why, actionability, novelty, synthesis,
-- evidentiary proportionality), summed into insight_quality_score (5-25),
-- bucketed into insight_quality_tier ('finding' 5-11, 'partial' 12-14,
-- 'qualified' 15-25), with a short rationale per insight for why it landed
-- where it did. All nullable: an insight that hasn't been scored yet (or
-- whose scoring call failed) reads as not-yet-scored rather than as a
-- score of zero, the same "not exists yet" pattern already used for
-- verdicts, objective candidates, etc.
--
-- Written with "if not exists" / a guarded DO block throughout so this file
-- can be re-run safely if an earlier attempt partially applied (as happened
-- once here: a prior run added why_score before failing on a later line).
alter table insights add column if not exists why_score smallint;
alter table insights add column if not exists actionability_score smallint;
alter table insights add column if not exists novelty_score smallint;
alter table insights add column if not exists synthesis_score smallint;
alter table insights add column if not exists evidentiary_score smallint;
alter table insights add column if not exists quality_score smallint;
alter table insights add column if not exists quality_tier text;
alter table insights add column if not exists quality_rationale text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'insights_quality_tier_check'
  ) then
    alter table insights add constraint insights_quality_tier_check
      check (quality_tier is null or quality_tier in ('finding', 'partial', 'qualified'));
  end if;
end $$;
