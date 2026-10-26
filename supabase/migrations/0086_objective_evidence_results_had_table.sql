-- OBJ-REV-007 (deleted-table sub-issue): a result computed from a built crosstab table
-- stores that table's id in `table_id`. If the researcher later deletes that table (or its
-- document), the existing `table_id` foreign key is `on delete set null` - the result row
-- survives with `table_id` nulled, but its `stance`/`estimate`/`summary` are untouched, so it
-- kept counting as a fully answered, supportive/against piece of evidence indefinitely, with
-- nothing left anyone could open to see what it was actually computed from.
--
-- `table_id is null` alone cannot distinguish that case from a legitimate permanent one: the
-- "no variable in this file matches the request" silent verdict (evaluateEvidenceQuestion's
-- plan.rows.length === 0 branch) also stores basis='computed' with no table_id, because no
-- table was ever built for it - that is not stale, it never had a table to lose.
--
-- had_table records, at write time, whether a table was actually built and referenced for
-- this result. Comparing had_table (true) against the current table_id (null) at read time -
-- done in code, not here - identifies exactly the deleted-table case without a trigger: the
-- WHERE clause's own "on delete set null" ordering relative to any trigger is what the prior
-- brief could not verify without a live database, and this fix does not depend on it.
-- Run npm run backup before applying.
alter table objective_evidence_results add column if not exists had_table boolean not null default false;

update objective_evidence_results set had_table = true where table_id is not null;
