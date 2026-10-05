-- Closes the gap that made archiving silently fail (see findingArchive.ts):
-- the live `insights` table has never had a uniqueness constraint on
-- finding_id, so two insight-generation passes racing on the same run
-- (which happened at least once this project, from a background self-heal
-- re-triggering on every page reload before that was fixed) could both
-- pass generateInsights' own "not exists" check and each insert an insight
-- for the same finding. insight_history.original_finding_id is unique by
-- design (0021), so archiving one of those findings threw a unique
-- violation and rolled back the whole archive-and-replace transaction,
-- including the delete and the fresh extraction, for that document, with
-- nothing surfaced to the researcher beyond "nothing changed".
--
-- This migration cleans up any duplicates already sitting in the
-- database, then adds the constraint that should have been there from the
-- start, so this specific failure mode can't happen again. For any
-- finding_id with more than one insight row, every insight but the oldest
-- (and everything built on it: recommendations, via cascade) is deleted.
-- This is a genuine, small loss of data for a run that hit the race: a
-- duplicate recommendation or two, generated from the same finding twice
-- and never reviewed any differently from its twin. Nothing a researcher
-- explicitly reviewed is at risk, since duplicates only ever occur on the
-- "ai_suggested" / freshly generated side, before a human has looked at
-- either copy.
delete from insights
where id in (
  select id from (
    select id, row_number() over (
      partition by finding_id order by created_at asc, id asc
    ) as rn
    from insights
  ) ranked
  where rn > 1
);

alter table insights add constraint insights_finding_id_unique unique (finding_id);
