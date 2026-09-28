-- Records which entry point a run started from (per the two-block design):
-- 'generate'  = mining raw data/tables for new insights from scratch
-- 'validate'  = validating and elevating insights an existing report already states
-- Either path can still end up running both, since the insight generator triggers
-- automatically whenever tables/data are supplied, regardless of which block
-- the user picked; this column just records their stated intent.
alter table runs
  add column entry_point text check (entry_point in ('generate', 'validate'));
