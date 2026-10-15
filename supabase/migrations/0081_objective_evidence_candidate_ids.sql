-- Evidence (and its roll-up) has been keyed only by (item_kind, item_order) since 0066: the
-- position an objective or decision candidate happened to occupy in its accepted-candidates
-- list at generation time, not a stable reference to the candidate itself. That position
-- shifts whenever the accepted list changes shape (a candidate rejected, added, or deleted),
-- so an evidence row saved for "objective at position 0" silently reattaches to whichever
-- objective now sits there, which can be a different candidate's text entirely (OBJ-REV-001,
-- OBJ-REV-002). Adding a nullable reference to the actual candidate row is what lets evidence
-- follow the candidate itself rather than its current position; nullable and `on delete set
-- null` (not cascade) because a deleted candidate's evidence is still real, answered evidence
-- worth keeping, not something that should vanish along with the row it was asked about.
-- Existing rows get no backfill here: their original candidate cannot be reconstructed from
-- (kind, order) alone with any confidence (that is the very ambiguity this migration exists to
-- stop happening again), so they keep working exactly as before, matched the old way, until
-- naturally replaced by a later generate/edit that writes the new column.
-- Run npm run backup before applying. Needs 0066 first.

alter table objective_evidence
  add column if not exists objective_candidate_id uuid references objective_candidates(id) on delete set null,
  add column if not exists decision_candidate_id uuid references decision_candidates(id) on delete set null;

create index if not exists objective_evidence_objective_candidate_idx
  on objective_evidence (objective_candidate_id) where objective_candidate_id is not null;
create index if not exists objective_evidence_decision_candidate_idx
  on objective_evidence (decision_candidate_id) where decision_candidate_id is not null;
