-- ANA-QUAL-002: extractThemes.ts's applyCodebook already computes, per turn, which specific unit
-- (sentence-level span within that turn) each assigned code actually came from - this is the
-- unitCodes map built while parsing the model's own per-unit decisions. It was never persisted:
-- only the turn-level (segment_id, code_id) pair reached the database, in coding_assignments. So
-- once a transcript has a code applied to a long turn, there was no way afterward to say which
-- sentence of that turn actually justified it, or to tell apart two different codes that both
-- came from different sentences of the same turn versus the same one.
--
-- This is purely additive: coding_assignments keeps its existing shape and every query against it
-- unchanged. unit is the 1-based index into splitIntoUnits(text) of the turn's (footer-stripped)
-- text (src/lib/qualCoding.ts) - deterministic given the same transcript, so the exact passage is
-- always re-derivable from coding_segments.text without duplicating the quote text here. A turn
-- with no sub-unit split (a short turn, coded as a single whole-turn "unit") gets exactly one row,
-- unit = 1, same as unitsOf's own fallback to [item.text] in extractThemes.ts.
--
-- Run npm run backup before applying.
create table if not exists coding_unit_assignments (
  tenant_id uuid not null references tenants(id),
  segment_id uuid not null references coding_segments(id) on delete cascade,
  code_id uuid not null references coding_codes(id) on delete cascade,
  unit smallint not null check (unit >= 1),
  created_at timestamptz not null default now(),
  primary key (segment_id, code_id, unit)
);
create index if not exists coding_unit_assignments_code_idx on coding_unit_assignments (code_id);
