-- Tier-two reproducibility check (Simoudis 2015's "stable" and
-- "reproducible" insight properties): does a synthesized insight reappear
-- if synthesis is re-run on a resampled slice of the same underlying
-- pre-insight pool? See checkRunStability in src/lib/insightSynthesizer.ts.
--
-- Run explicitly, on demand, via a "Check stability" action -- never
-- automatically as part of regenerate or synthesis -- so these three
-- columns start, and stay, null until a researcher asks for a check, same
-- "lock in, recompute only when asked" shape the narrative report already
-- uses. stability_testable_count is the number of resamples where this
-- insight had enough surviving evidence to be tested at all (a resample
-- that drops too much of a thin insight's own membership can't test it,
-- and isn't counted as a failure); stability_reappeared_count is how many
-- of those testable resamples still clustered this insight's surviving
-- evidence together.
alter table synthesized_insights add column if not exists stability_testable_count smallint;
alter table synthesized_insights add column if not exists stability_reappeared_count smallint;
alter table synthesized_insights add column if not exists stability_checked_at timestamptz;
