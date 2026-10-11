-- An archived finding used to lose how it was established: its pattern type,
-- its statistics (test, p, correction, bases, caveats), whether its quote was
-- verified, and its extraction caveats. Keep them, so a replaced or regenerated
-- finding can still be read the way it was made.
-- Run npm run backup before applying. Apply BEFORE using the updated app:
-- the archive step now writes these columns.
alter table finding_history add column if not exists pattern_type text;
alter table finding_history add column if not exists stated_stats jsonb;
alter table finding_history add column if not exists quote_verified boolean;
alter table finding_history add column if not exists extraction_caveats jsonb;
