-- Moves the five-dimension quality score off pre-insights and onto
-- synthesized insights (see src/lib/insightQualityScorer.ts for the
-- original, now being retired from the automatic pipeline). The
-- researcher's own reasoning: a pre-insight is one finding's worth of
-- claim, scoring it on novelty/synthesis/etc. mostly measured how
-- well-written a single restatement was; a synthesized insight is the
-- thing that actually claims to be a genuine, cross-source insight, so
-- that is where "is this a real insight or just a restated observation"
-- should be judged.
--
-- Same five columns, same 1/3/5 scoring, same tierFor(total) bucketing as
-- the retired insights.* columns, so synthesizedInsightQualityScorer.ts can
-- reuse the existing rubric almost unchanged. The insights.* quality
-- columns (0017 era) are left in place: they're read by insight_history and
-- by any already-scored run's historical data, and this migration never
-- drops columns, only adds them elsewhere.

alter table synthesized_insights
  add column if not exists why_score smallint,
  add column if not exists actionability_score smallint,
  add column if not exists novelty_score smallint,
  add column if not exists synthesis_score smallint,
  add column if not exists evidentiary_score smallint,
  add column if not exists quality_score smallint,
  add column if not exists quality_tier text
    check (quality_tier in ('finding', 'partial', 'qualified')),
  add column if not exists quality_rationale text;
