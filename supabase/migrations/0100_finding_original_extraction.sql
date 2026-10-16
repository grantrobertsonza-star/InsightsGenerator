-- FND-001 probe B: researcher wording edits on report findings keep the original reading.
--
-- findings.original_extraction holds what extraction produced, captured ONCE at a finding's first
-- wording edit and never overwritten by later edits:
--   { "finding_text": <the extracted wording>,
--     "grounded_by_finding_id": <the computed finding extraction tied it to, or null>,
--     "duplicate_group_id": <its near-duplicate group, or null> }
-- Null means the wording has never been edited. Grounding and the duplicate group are kept
-- because an edit clears them (they were established for the extracted wording, not the edited
-- one); "revert to original" restores all three exactly and clears this column again.
--
-- The edit itself is recorded in the existing 0094 provenance: 'finding_text' is added to
-- human_edited_fields (which already protects the finding from replacement on a re-read).
-- finding_history mirrors the column so an archived finding keeps both texts.
--
-- Additive and idempotent. No existing row changes: null on every current finding.

alter table findings add column if not exists original_extraction jsonb;
alter table finding_history add column if not exists original_extraction jsonb;

comment on column findings.original_extraction is
  'FND-001 probe B: extraction-time wording, grounding and duplicate group, captured once at the first '
  'researcher wording edit (null = never edited). Revert restores these and clears the column.';
