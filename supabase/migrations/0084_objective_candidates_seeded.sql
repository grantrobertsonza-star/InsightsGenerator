-- OBJ-SET-001/003: objectiveFramer.ts's "carry the researcher's upfront objective into the
-- candidate list" step used to decide whether that text was "already represented" by
-- matching its individual lines, verbatim, against current researcher_authored candidates.
-- That match breaks the moment one of the split lines is edited (Review's accept-with-edit,
-- or Setup's own edit) - the edited text no longer equals the original line, so the check
-- concluded the upfront text was missing and re-inserted the stale original blob alongside
-- the already-edited candidates it was split into in the first place. It breaks the same way,
-- in the opposite direction the acceptance criteria also cares about, after a deletion: once
-- every split candidate is gone, nothing currently matches any original line either, so the
-- same stale blob would resurrect text the researcher deliberately removed.
--
-- A one-way, persisted marker fixes both: once this run's upfront text has been split into
-- candidate rows at all (on the very first Setup save, or by this framer step itself for a
-- legacy run that predates that split-on-save behaviour), it stays seeded regardless of what
-- happens to those rows afterward - edited, deleted, all of them gone - so neither case can
-- make the stale original reappear.
--
-- Existing runs are backfilled as already-seeded whenever they have upfront text at all:
-- every run created since the split-on-save behaviour shipped was seeded at that moment by
-- construction, and a run old enough to predate it has long since had its own chance to run
-- this framer step and pick up whatever split it was going to get - treating it as unseeded
-- now would just reinsert the same stale blob this migration exists to stop, not recover
-- anything genuinely missing.
-- Run npm run backup before applying.
alter table runs add column if not exists objective_candidates_seeded boolean not null default false;

update runs set objective_candidates_seeded = true
where objective_candidates_seeded = false
  and initial_research_objective is not null
  and trim(initial_research_objective) <> '';
