-- Marks validation rows for objectives the app inferred from the project's own
-- evidence. Their coverage is circular (the evidence they were derived from is
-- the evidence they are checked against), so reports flag them and give no
-- independent verdict.
alter table objective_validations
  add column if not exists inferred boolean not null default false;



