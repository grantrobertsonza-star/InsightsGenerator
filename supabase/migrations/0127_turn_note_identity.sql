-- Batch 60, Codex COD5K-F02 (28 October 2026): a researcher's note on a turn is bound to the turn it
-- was written for, not only to its position.
--
-- Before this, coding_turn_notes was keyed by (document_id, segment_index) alone. Reading a transcript
-- again (replaceSegments) deletes every turn and inserts the new ones under indexes 0, 1, 2, ..., so
-- a note written on turn 5 was shown against whatever the new turn 5 said, and a note could be saved
-- for a turn index that did not exist and later attach to unrelated speech.
--
--   coding_turn_notes.segment_text_hash  md5 of coding_segments.text of the turn the note was written
--                                        on. A note counts as the current note of a turn only while
--                                        its turn at that index still has this exact text (a re-read
--                                        that produces the same turn keeps its note).
--   coding_turn_note_orphans             a note whose turn is gone or changed. The researcher's wording
--                                        is kept here verbatim with the former turn number and why it
--                                        was set aside, and is shown as such; it is never shown as the
--                                        note of a current turn until the researcher explicitly
--                                        attaches it to one, and it is removed only when they clear it.
--     turn_text         the exact words of the turn the note was written on, captured by the re-read
--                       that set it aside (read before the old turns are deleted, kept only when their
--                       md5 equals the note's fingerprint); null when not available, which includes
--                       every note this back-fill moves (its turn no longer exists)
--     reason 'turn_missing'     no turn has this index any more
--            'turn_changed'     a turn has this index but different text
--            'turn_unverified'  the note carries no hash (written by code older than this migration
--                               after the back-fill), so the turn it was written for is unknown
--
-- Back-fill: an existing note whose index still exists is bound to that turn's current text (the
-- best available evidence of what it was written for; a note already shown against the wrong turn by
-- an earlier re-read cannot be told apart and stays where it is shown today). A note whose index does
-- not exist is moved to coding_turn_note_orphans as 'turn_missing', wording and time kept. No note is
-- deleted.
--
-- The app works before this is applied (codingMeta.ts checks for the column): notes are then read by
-- index as before, and a save is refused for a turn that does not exist, but a re-read cannot set a
-- changed turn's note aside. Additive and idempotent. Written for this batch; not applied to any
-- database as part of it. Run `npm run backup -- --local` before applying.

alter table coding_turn_notes add column if not exists segment_text_hash text;

create table if not exists coding_turn_note_orphans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  document_id uuid not null references documents(id) on delete cascade,
  segment_index integer not null,
  note text not null,
  segment_text_hash text,
  turn_text text,
  written_at timestamptz not null,
  orphaned_at timestamptz not null default now(),
  reason text not null check (reason in ('turn_missing', 'turn_changed', 'turn_unverified'))
);
create index if not exists coding_turn_note_orphans_document_idx on coding_turn_note_orphans (document_id);

alter table coding_turn_note_orphans enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'coding_turn_note_orphans' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on coding_turn_note_orphans
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;

update coding_turn_notes n
   set segment_text_hash = md5(s.text)
  from coding_segments s
 where s.document_id = n.document_id
   and s.segment_index = n.segment_index
   and n.segment_text_hash is null;

with moved as (
  delete from coding_turn_notes n
   where n.segment_text_hash is null
     and not exists (
       select 1 from coding_segments s
        where s.document_id = n.document_id and s.segment_index = n.segment_index
     )
  returning n.tenant_id, n.document_id, n.segment_index, n.note, n.updated_at
)
-- No turn exists at these indexes, so there is no text to keep (turn_text null).
insert into coding_turn_note_orphans (tenant_id, document_id, segment_index, note, segment_text_hash, turn_text, written_at, reason)
select tenant_id, document_id, segment_index, note, null, null, updated_at, 'turn_missing' from moved;
