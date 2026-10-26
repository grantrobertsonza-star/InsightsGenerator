-- Findings from a driver analysis (Analytics tab): one for the model as a whole and one per
-- leading driver, marked as modelled results. Adds the 'driver' pattern type.
alter table findings drop constraint if exists claims_pattern_type_check;
alter table findings
  add constraint claims_pattern_type_check
  check (pattern_type is null or pattern_type in
    ('segment_difference', 'trend', 'outlier', 'relationship', 'segment_split', 'banner_comparison',
     'model_association', 'cluster_profile', 'segment_proportions', 'level', 'no_difference', 'driver'));
