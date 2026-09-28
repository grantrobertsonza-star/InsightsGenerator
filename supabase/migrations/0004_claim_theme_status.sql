-- theme: a short grouping label, suggested by Claude at extraction time and
-- editable by the reviewer (renamed, reassigned, or a new one typed in).
-- status: the human review gate at the claim level, before anything is
-- passed on to the red-teamer.
alter table claims
  add column theme text,
  add column status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected'));
