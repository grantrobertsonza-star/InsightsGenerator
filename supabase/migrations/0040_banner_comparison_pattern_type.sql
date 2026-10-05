-- Adds 'banner_comparison' as a valid findings.pattern_type: the pattern
-- produced by computeBannerPlanPatterns (bannerPlanComputation.ts) for a
-- raw table whose banner/stub columns have been named (see
-- 0039_table_banner_plan.sql). Distinct from segment_difference (which
-- tableComputation.ts produces by an open, exploratory search over an
-- aggregated table's columns): a banner_comparison only ever tests a
-- column pair the person themselves named, never one the code searched
-- for, so it carries the same uncorrected_multiple_comparisons caveat but
-- for a different, disclosed reason -- a bounded, human-chosen set of
-- comparisons, not an open search.
alter table findings drop constraint if exists claims_pattern_type_check;
alter table findings
  add constraint claims_pattern_type_check
  check (pattern_type is null or pattern_type in
    ('segment_difference', 'trend', 'outlier', 'relationship', 'segment_split', 'banner_comparison'));
