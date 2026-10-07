-- Indexes for the lookups the run page makes on every load. Postgres does not
-- index foreign keys on its own, so these were full scans that grew with each
-- run. Each one is created only if its table and columns exist, so this is
-- safe to apply on any state of the schema.
do $$
declare
  spec record;
  cols text[];
  ok boolean;
begin
  for spec in
    select * from (values
      ('documents', 'run_id'),
      ('claims', 'run_id'),
      ('claims', 'source_document_id'),
      ('claims', 'source_table_id'),
      ('verdicts', 'claim_id'),
      ('insights', 'run_id'),
      ('recommendations', 'run_id'),
      ('review_log', 'run_id'),
      ('trace', 'run_id, event, created_at desc'),
      ('decision_candidates', 'run_id'),
      ('objective_candidates', 'run_id'),
      ('evidence_chunks', 'document_id'),
      ('coding_codebooks', 'run_id'),
      ('coding_segments', 'run_id'),
      ('coding_document_settings', 'run_id'),
      ('coding_respondent_attributes', 'run_id'),
      ('coding_variable_links', 'run_id'),
      ('coding_negative_cases', 'code_id'),
      ('coding_assignment_overrides', 'run_id')
    ) as t(tbl, expr)
  loop
    -- column names only (drop "desc" etc.) for the existence check
    select array_agg(trim(split_part(trim(c), ' ', 1)))
      into cols from unnest(string_to_array(spec.expr, ',')) as c;
    select bool_and(exists (
             select 1 from information_schema.columns
             where table_schema = 'public' and table_name = spec.tbl
               and column_name = col))
      into ok from unnest(cols) as col;
    if ok and exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = spec.tbl
           and table_type = 'BASE TABLE') then
      execute format(
        'create index if not exists %I on %I (%s)',
        'idx_' || spec.tbl || '_' || regexp_replace(spec.expr, '[^a-z_]+', '_', 'g'),
        spec.tbl, spec.expr);
    end if;
  end loop;
end $$;
