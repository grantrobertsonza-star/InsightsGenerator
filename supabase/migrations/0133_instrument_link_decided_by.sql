-- Batch CB1 (Grant, 29 October 2026: "a link of codebook is manual for each wave, i think it should be
-- automatic"). A codebook entry whose name is exactly one variable's name, and whose answer codes include every
-- code that variable holds in the data, is confirmed by matching, without a click. Who decided a link has to be
-- recorded for that to be safe:
--
--   instrument_links.decided_by 'automatic'   confirmed by the codebook rule above. Matching again re-checks it:
--                                             when the name or the codes no longer fit, it goes back to a
--                                             suggestion for the researcher.
--                               'researcher'  the researcher set this link's status (confirmed, rejected or
--                                             returned it to a suggestion). Matching never changes or deletes it.
--                               null          as before this migration: a matcher suggestion, or a link made
--                                             before it. Existing links are not back-filled.
--
-- Before this migration nothing is confirmed automatically (matching only suggests, as before) and the screen
-- says so. Additive and idempotent. Written for this batch; not applied to any database as part of it. Run
-- `npm run backup -- --local` before applying.

alter table instrument_links
  add column if not exists decided_by text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'instrument_links'::regclass and conname = 'instrument_links_decided_by_check') then
    alter table instrument_links
      add constraint instrument_links_decided_by_check check (decided_by is null or decided_by in ('automatic', 'researcher'));
  end if;
end $$;
