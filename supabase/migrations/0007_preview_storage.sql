-- A browser can render a PDF directly but not a .docx or .pptx. Since those
-- formats are already converted to PDF for extraction, this keeps that
-- converted copy around as a viewable "preview", separate from the
-- original file kept in storage_path.
alter table documents
  add column preview_storage_path text;
