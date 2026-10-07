-- A transcript can now arrive already coded by the researcher (ATLAS.ti,
-- NVivo, a spreadsheet). Its codebook is stored like any other, with source
-- 'imported', so the counts, quotes and findings are built the same way and
-- the origin stays visible.
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'coding_codebooks'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%source%'
  loop
    execute format('alter table coding_codebooks drop constraint %I', c);
  end loop;
end $$;

alter table coding_codebooks
  add constraint coding_codebooks_source_check
  check (source in ('induced', 'edited', 'imported'));
