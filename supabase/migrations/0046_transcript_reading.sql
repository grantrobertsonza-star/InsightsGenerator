-- How a transcript was split into respondents and turns, and what the
-- researcher chose when the automatic reading was wrong.
--   * segmentation_mode: what the researcher asked for (auto by default);
--   * segmentation_resolved: what was actually used;
--   * segmentation_notes: why a requested mode fell back, if it did;
--   * moderator_labels: speaker labels the researcher marked as moderator;
--   * coding_respondent_attributes: profile lines (sex, age group, income and
--     so on) lifted out of the text, one row per respondent and attribute.
-- All additive. Requires 0044.

alter table coding_document_settings
  add column if not exists segmentation_mode text not null default 'auto'
    check (segmentation_mode in ('auto', 'labels', 'headings', 'paragraphs', 'none')),
  add column if not exists segmentation_resolved text,
  add column if not exists segmentation_notes text[] not null default '{}',
  add column if not exists moderator_labels text[] not null default '{}';

create table if not exists coding_respondent_attributes (
  document_id uuid not null references documents(id) on delete cascade,
  speaker_key text not null default '',
  attribute text not null,
  tenant_id uuid not null references tenants(id),
  run_id uuid not null references runs(id) on delete cascade,
  value text not null,
  primary key (document_id, speaker_key, attribute)
);

alter table coding_respondent_attributes enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'coding_respondent_attributes' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on coding_respondent_attributes
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
