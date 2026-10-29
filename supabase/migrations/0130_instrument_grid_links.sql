-- Batch 53 (Grant, 28 October 2026): a grid (battery) question's rows are linked to their columns by the
-- stem in the columns' labels (method 'grid'), because the questionnaire's code often differs from the
-- columns' (5A and Q5_1 ... Q5_8). Before this migration the matcher makes no grid links (the method is
-- not allowed), so nothing changes until it is applied. Adds 'grid' to the allowed methods; nothing else.
-- Additive and idempotent. Written for this batch; not applied to any database as part of it. Run
-- `npm run backup -- --local` before applying.
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
  check (method in ('code', 'stem', 'wording', 'manual', 'codebook', 'grid'));
