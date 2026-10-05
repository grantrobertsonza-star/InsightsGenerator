-- Lets a document be uploaded as a raw transcript (interview, focus group)
-- rather than only a "report" (prose with claims already stated) or a
-- "table" (structured data).
alter table documents
  drop constraint if exists documents_kind_check;

alter table documents
  add constraint documents_kind_check
  check (kind in ('report', 'table', 'evidence', 'transcript'));

-- A claim derived by coding a raw transcript into themes isn't "stated"
-- (nothing was asserted as a claim) or "generated" (no statistical pattern
-- was computed), so it gets its own origin.
alter table claims
  drop constraint if exists claims_origin_check;

alter table claims
  add constraint claims_origin_check
  check (origin in ('stated', 'generated', 'coded'));

-- Whether a claim's evidence is qualitative or quantitative is independent
-- of both its claim_kind (fact/own_finding/etc) and its origin (a report can
-- state a qualitative verbatim as easily as a statistic). This is what
-- drives the qual/quant/all toggle in the review UI.
alter table claims
  add column data_type text check (data_type in ('qualitative', 'quantitative'));

-- Every claim produced by table-driven pattern detection is quantitative by
-- construction, so this can be backfilled with certainty. Existing "stated"
-- claims aren't backfilled since we can't safely infer which is which after
-- the fact; they'll pick up a data_type going forward as documents are
-- reprocessed with the updated extraction prompt.
update claims set data_type = 'quantitative' where origin = 'generated';
