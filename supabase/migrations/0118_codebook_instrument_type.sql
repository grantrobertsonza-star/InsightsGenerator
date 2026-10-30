-- A codebook is a fourth kind of instrument (Grant, 26 October 2026): a data file's variable list with
-- labels and answer codes, linked to the data file by variable name exactly as a questionnaire is. It
-- uses the same items, links and label overlay; only the allowed type value is new.
alter table documents drop constraint if exists documents_instrument_type_check;
alter table documents add constraint documents_instrument_type_check
  check (instrument_type is null or instrument_type in ('questionnaire', 'interview_guide', 'focus_group_guide', 'codebook'));
