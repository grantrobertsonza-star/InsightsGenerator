-- A question's wording can change while a long-running evaluation (a model call plus a
-- crosstab build) for its OLD wording is still in flight. evaluateEvidenceQuestion reads
-- the question row once at the start and writes its answer at the end with no check in
-- between, so that answer - computed against wording that no longer exists - gets written
-- under the edited question once the evaluation finally finishes, silently misattributing
-- a stale result to a question the researcher has since changed (OBJ-REV-007). editEvidenceQuestion
-- already deletes any existing answer row on a wording change, but that only clears what
-- exists at edit time: it cannot stop an evaluation already past that point in its own
-- execution from recreating the row moments later with the old answer.
--
-- question_revision is bumped by editEvidenceQuestion whenever question/request_text/
-- supports_if/against_if actually changes (not on excluded alone, which does not change what
-- is being asked). evaluateEvidenceQuestion captures the revision it read at the start and
-- re-checks it immediately before every write; a mismatch means the question moved on while
-- the evaluation ran, so the stale write is skipped rather than persisted under the new
-- wording, and the pair is picked up again fresh by pendingPairs under the question as it
-- now reads.
-- Run npm run backup before applying. Needs 0066 first.

alter table objective_evidence
  add column if not exists question_revision int not null default 0;
