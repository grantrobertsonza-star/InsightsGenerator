-- CE-3 (evidence chain, 26 October 2026): what the report narrative was written against.
--
-- The saved narrative (deck_narratives) frames the report around the business problem, the objectives,
-- the decisions and the accepted insights. Editing any of them changed nothing on the saved narrative:
-- the report kept its old framing with no sign it was written for something since changed. inputs holds
-- the fingerprints of those inputs at generation (narrativeFreshness.ts); readers compare them with the
-- current ones and qualify the narrative when they differ. Null on narratives written before this.
-- Run npm run backup before applying.
alter table deck_narratives add column if not exists inputs jsonb;
