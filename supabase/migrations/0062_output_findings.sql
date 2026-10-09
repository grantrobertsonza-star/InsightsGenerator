-- Findings built from statistical output sets (model results, odds ratios,
-- cluster profiles, proportions with intervals), and the set-level checks
-- stored on the set so they show again without recomputing.
-- Run npm run backup before applying. Needs 0061 first.

alter table findings drop constraint if exists claims_pattern_type_check;
alter table findings
  add constraint claims_pattern_type_check
  check (pattern_type is null or pattern_type in
    ('segment_difference', 'trend', 'outlier', 'relationship', 'segment_split', 'banner_comparison',
     'model_association', 'cluster_profile', 'segment_proportions'));

alter table output_sets add column if not exists checks jsonb;
