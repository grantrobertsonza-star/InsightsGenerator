-- D2 (Grant, 29 October 2026): a codebook entry keeps the question it belongs to (A1, F1), its question type
-- and its multiple-response set, as the codebook gives them, so automatic tracker dashboards can recognise
-- funnel stages, brand grids and drivers from what was imported. Null for every item read before this and
-- for questionnaire items. Before this migration the reader still reads the fields but they are not stored,
-- and the codebook card says so. Additive and idempotent. Written for this batch; not applied to any
-- database as part of it. Run `npm run backup -- --local` before applying.
alter table instrument_items add column if not exists question_meta jsonb;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conrelid = 'instrument_items'::regclass and conname = 'instrument_items_question_meta_object'
  ) then
    alter table instrument_items
      add constraint instrument_items_question_meta_object
      check (question_meta is null or jsonb_typeof(question_meta) = 'object');
  end if;
end $$;
