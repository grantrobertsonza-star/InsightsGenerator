-- OBJ-SET-002: addOwnObjectiveCandidate's duplicate guard (a plain SELECT before the
-- INSERT) is a check-then-act race, not real protection - two concurrent identical "add
-- objective" requests (a double-click, a retried submit) both pass the SELECT before
-- either INSERT commits, and both land, producing two rows for the same logical objective
-- with nothing downstream able to tell them apart as duplicates.
--
-- A partial unique index closes the actual race, not just the common-case ordering: it is
-- enforced by Postgres itself at commit time, across concurrent transactions, which an
-- application-level SELECT-then-INSERT can never be. Scoped to exactly the rows the
-- existing guard already intended to dedupe - researcher-authored, not-rejected candidates,
-- keyed on the trimmed text - so a rejected candidate with the same wording still does not
-- block a fresh add (rejecting it was its own decision), and this says nothing about
-- ai_suggested candidates, which have their own distinct lifecycle.
-- Run npm run backup before applying.
create unique index if not exists objective_candidates_researcher_text_uniq
  on objective_candidates (run_id, (trim(candidate_text)))
  where source = 'researcher_authored' and status <> 'rejected';
