-- Replaces the three-way claim_kind split with a fuller taxonomy that
-- separates a report's raw facts, its own analytical findings, external
-- citations, tentative hypotheses, methodology notes, explicit
-- recommendations, and the insights it states about itself.
--
-- stated_insight is isolated on purpose, not because the system trusts a
-- report's own stated insight as real, but so the (future) verification
-- step can find and test exactly those statements against the findings
-- that are supposed to support them, rather than trusting them by default.
-- Insights the system itself builds, once that synthesis step exists,
-- belong to 'generated' claims and are a separate concept entirely.
alter table claims
  drop constraint if exists claims_claim_kind_check;

-- Remap existing data to the new category names BEFORE the new constraint
-- goes on, since Postgres validates every existing row against a check
-- constraint the moment it's added, not just rows written after.
update claims set claim_kind = 'stated_insight' where claim_kind = 'insight';

alter table claims
  add constraint claims_claim_kind_check
  check (claim_kind in (
    'fact',
    'own_finding',
    'external_citation',
    'hypothesis',
    'methodology',
    'recommendation',
    'stated_insight'
  ));
