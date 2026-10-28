-- Batch 49 (Grant, 27 October 2026): a questionnaire question worded identically to a codebook entry the
-- researcher has confirmed for a data file's variable is linked to that variable through the codebook.
-- Before this, each document was matched to the data file on its own: the questionnaire's "1A" was
-- compared with the data file's short label for Q1 (63%) and never with the codebook's confirmed
-- wording, which is word for word the same, so the researcher confirmed the same thing twice.
--
--   instrument_links.method 'codebook'   linked because its wording is identical (case, spacing,
--                                        punctuation and a leading question number ignored) to the
--                                        wording of a codebook entry confirmed for the same variable.
--   instrument_links.basis_item_id       that codebook entry. A 'codebook' link counts as confirmed only
--                                        while the codebook entry is still confirmed for the same
--                                        variable of the same data file (getConfirmedItemsForData), so
--                                        rejecting or re-linking the codebook entry withdraws it rather
--                                        than leaving a confirmation with nothing under it. Null for
--                                        every other method; set null if the codebook entry is deleted,
--                                        which also withdraws the link.
--
-- Additive and idempotent. No back-fill: existing links keep their method. Written for this batch; not
-- applied to any database as part of it. Run `npm run backup -- --local` before applying.

do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'instrument_links'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%method%'
  loop
    execute format('alter table instrument_links drop constraint %I', c);
  end loop;
end $$;

alter table instrument_links
  add constraint instrument_links_method_check
  check (method in ('code', 'stem', 'wording', 'manual', 'codebook'));

alter table instrument_links
  add column if not exists basis_item_id uuid references instrument_items(id) on delete set null;

-- A 'codebook' link always names its basis when written; a missing basis (deleted entry) is read as
-- withdrawn, never as confirmed.
create index if not exists instrument_links_basis_idx on instrument_links (basis_item_id) where basis_item_id is not null;
