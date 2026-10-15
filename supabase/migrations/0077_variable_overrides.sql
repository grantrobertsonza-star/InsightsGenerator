-- Lets a researcher correct what import inferred for a variable: its data
-- type (categorical/discrete/continuous) and its question type (single,
-- multiple response, grid, battery). Keyed by variable name, applied on top
-- of the inferred values wherever they are shown; nothing is deleted or
-- recomputed, so clearing an override just falls back to the inference.
alter table documents add column if not exists variable_overrides jsonb not null default '{}'::jsonb;
