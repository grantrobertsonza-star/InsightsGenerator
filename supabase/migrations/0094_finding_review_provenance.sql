-- REP-IN-002: explicit provenance for researcher actions on findings.
--
-- Records that a researcher ACTION happened (a status decision through the findings table or a
-- dashboard add/remove, or an edit of theme, kind or note). The app has no authenticated user, so
-- this is action provenance, not person attribution: it says "set by an explicit researcher
-- action", never "set by whom".
--
-- Review and edit are kept separate on purpose: accepting a finding does not mean its content was
-- changed, and changing its theme does not mean it was reviewed.
--
--   human_reviewed_at / human_review_action  last explicit status decision
--   human_edited_at / human_edited_fields     last explicit content edit, and every field a
--                                             researcher has ever changed (theme, finding_kind,
--                                             researcher_note)
--   provenance_tracked                        whether the four columns above can be trusted to be
--                                             complete for this row
--
-- Existing rows: provenance_tracked = false ("provenance unknown"). Nothing is back-filled, so no
-- existing row is marked reviewed or edited, and none is marked untouched either.
-- New rows: provenance_tracked = true through the column default, with human_reviewed_at null, so
-- an automatic insert is tracked without being marked as reviewed.
--
-- finding_history mirrors the columns so retirement keeps both kinds of provenance. Archived rows
-- that predate this migration also read provenance_tracked = false.
--
-- Additive and idempotent; no row rewrite beyond the boolean default. Not applied to the live
-- database as part of REP-IN-002.

alter table findings
  add column if not exists human_reviewed_at timestamptz,
  add column if not exists human_review_action text,
  add column if not exists human_edited_at timestamptz,
  add column if not exists human_edited_fields text[] not null default '{}',
  add column if not exists provenance_tracked boolean not null default false;

-- Set after the add: existing rows took false above, every later insert gets true.
alter table findings alter column provenance_tracked set default true;

alter table findings drop constraint if exists findings_human_review_action_check;
alter table findings add constraint findings_human_review_action_check
  check (human_review_action is null or human_review_action in
    ('accept', 'reject', 'pending', 'bulk_accept', 'bulk_reject', 'tool_add', 'tool_remove'));

alter table finding_history
  add column if not exists human_reviewed_at timestamptz,
  add column if not exists human_review_action text,
  add column if not exists human_edited_at timestamptz,
  add column if not exists human_edited_fields text[] not null default '{}',
  add column if not exists provenance_tracked boolean not null default false;
