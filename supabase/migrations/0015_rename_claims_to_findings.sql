-- Renames "claims" to "findings" throughout the schema, so the word a
-- researcher sees in the app matches the word anyone inspecting the
-- database directly sees too. Functionally identical table, same rows,
-- same constraints, just the vocabulary the whole build now agrees on:
-- findings are what the evidence shows, distinct from the objective that
-- framed the search for them and the decision they get judged against.
--
-- Constraint and index names (e.g. claims_pkey, claims_origin_check) are
-- left as Postgres generated them and are not renamed here; that is purely
-- cosmetic housekeeping inside the catalog, not something anyone using the
-- app or browsing the table list will run into, and renaming it carries
-- more risk than benefit for what it buys.
alter table claims rename to findings;
alter table findings rename column claim_text to finding_text;
alter table findings rename column claim_kind to finding_kind;
alter table verdicts rename column claim_id to finding_id;
alter table insights rename column claim_id to finding_id;
