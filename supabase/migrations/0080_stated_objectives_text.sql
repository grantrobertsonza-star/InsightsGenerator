-- OBJ-SET-M01: initial_research_objective was documented (objectiveFramer.ts)
-- as "a one-time snapshot taken at project creation and never touched
-- again", but runContextActions.ts's setup-save and editStatedObjective both
-- kept mutating it on every add/edit/delete, so that comment was a false
-- guarantee: objectiveFramer.ts's read of it as "the researcher's
-- unprocessed starting text" was never actually safe from reflecting a
-- prior run of the framer's own numbered output fed back as if it were
-- fresh researcher input.
--
-- Per the 2026-10-13 decision: initial_research_objective becomes genuinely
-- write-once (set only the first time a run's objective text is ever
-- saved, from null, via coalesce - see saveRunContext); stated_objectives_text
-- is the new, ordinary mutable field the Setup UI's objective list actually
-- reads and writes going forward, and is what editStatedObjective now edits
-- instead.
--
-- Existing runs have no way to recover a true original: this column has
-- been overwritten by every edit since the run was created, so there is no
-- untouched snapshot left to read for them. Backfilling stated_objectives_text
-- from the current initial_research_objective value is the only honest
-- option: it keeps every existing project's Setup objective list showing
-- exactly what it shows today, and initial_research_objective itself is
-- left as-is rather than reset, since a stale non-null value is a
-- disclosed, inexact proxy for "whatever was typed first", not a
-- fabricated one.
alter table runs add column if not exists stated_objectives_text text;

update runs set stated_objectives_text = initial_research_objective
where stated_objectives_text is null;
