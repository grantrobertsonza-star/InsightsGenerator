-- Adds the "sessions" reading (several interviews or focus groups in one
-- file) to the allowed values of segmentation_mode. Requires 0046.
alter table coding_document_settings
  drop constraint if exists coding_document_settings_segmentation_mode_check;
alter table coding_document_settings
  add constraint coding_document_settings_segmentation_mode_check
  check (segmentation_mode in ('auto', 'labels', 'headings', 'sessions', 'paragraphs', 'none'));
