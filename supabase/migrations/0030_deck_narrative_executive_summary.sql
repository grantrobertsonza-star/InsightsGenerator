-- Adds an executive-summary field to deck_narratives: a short, standalone
-- opening paragraph for the "Insights Report" deck so a senior stakeholder
-- who only reads the first slide still gets the governing thought and the
-- single highest-priority action, consulting-deck style. Backfilled empty
-- for any narrative generated before this column existed; the deck export
-- route treats an empty string as "no executive summary slide" rather than
-- rendering a blank one.
alter table deck_narratives
  add column if not exists executive_summary text not null default '';
