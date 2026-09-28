-- Classifies a 'stated' claim by what kind of statement it actually is,
-- since a report mixes its own analytical findings with facts it simply
-- cites from other sources for context. These need different treatment
-- downstream: an external citation needs its source checked, an own
-- finding needs full statistical scrutiny, and an insight needs checking
-- against the findings that are supposed to support it.
alter table claims
  add column claim_kind text check (claim_kind in ('own_finding', 'external_citation', 'insight'));
