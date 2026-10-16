-- Numerical traceability (numberTrace.ts): the result of checking every figure in an AI-written
-- output against the evidence that output cites, stored with the output.
--
-- figure_check jsonb: { status: 'traced' | 'needs_review' | 'unsupported', checked: <figures>,
--                       figures: [{ field, text, status, reason }], checked_at }
--   traced        every figure matched its cited evidence in context
--   needs_review  a figure's value is in the evidence but its context could not be established;
--                 shown on screen and carried into exports as a qualification
--   unsupported   generators refuse to save such output; a stored 'unsupported' can only come
--                 from a later re-check (not written by this change)
-- Null means not checked: rows written before this migration, and text a researcher wrote or
-- edited (a researcher's own wording is not AI output, and no claim is made about it).
--
-- On: insights (pre-insights), synthesized_insights, recommendations, deck_narratives.
-- Additive and idempotent; no existing row changes.

alter table insights add column if not exists figure_check jsonb;
alter table synthesized_insights add column if not exists figure_check jsonb;
alter table recommendations add column if not exists figure_check jsonb;
alter table deck_narratives add column if not exists figure_check jsonb;
