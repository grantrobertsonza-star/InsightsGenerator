-- Wide findings: a committed table now gives a direct reading of its results
-- (a share, top-two box, NPS, average) and a "no difference" result where groups
-- were compared and nothing reached significance, so a table with nothing
-- significant in it still produces findings. Adds the two pattern types.
alter table findings drop constraint if exists claims_pattern_type_check;
alter table findings
  add constraint claims_pattern_type_check
  check (pattern_type is null or pattern_type in
    ('segment_difference', 'trend', 'outlier', 'relationship', 'segment_split', 'banner_comparison',
     'model_association', 'cluster_profile', 'segment_proportions', 'level', 'no_difference'));

