-- Adds the "segment_split" pattern type (the new code-computed decision
-- stump in tableComputation.ts) and a self-referencing column that lets a
-- report or transcript's prose finding (origin='stated') be marked as
-- independently corroborated by a real, code-computed table finding
-- (origin='generated') from the same run. This is the cross-document
-- grounding link: extractFindings.ts resolves it deterministically from a
-- server-supplied list of candidate computed facts, never from a raw id the
-- model invents, and the UI's confidence tiering can eventually use it to
-- tell a grounded prose claim apart from one resting on text alone.

alter table findings
  drop constraint if exists claims_pattern_type_check;

alter table findings
  add constraint claims_pattern_type_check
    check (pattern_type is null or pattern_type in ('segment_difference', 'trend', 'outlier', 'relationship', 'segment_split'));

alter table findings
  add column if not exists grounded_by_finding_id uuid references findings(id) on delete set null;

comment on column findings.grounded_by_finding_id is
  'For a stated-origin finding only: the generated-origin finding (real, code-computed table statistics from the same run) that independently corroborates this prose claim. Null means no such corroboration was found or applicable. Resolved deterministically in code from a server-supplied candidate list; never trusted directly from a model.';
