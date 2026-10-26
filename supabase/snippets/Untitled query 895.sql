-- Review controls for turns the stability check flagged.
-- blind_codes: what the researcher coded BEFORE seeing the model's themes or
--   the other runs' (locked once saved, so it cannot be edited after seeing).
-- blind_at: when that was saved.
-- changed: whether the final decision altered the model's coding (null until
--   the turn is settled). resolved_at (0064) gives the decision time.
-- Additive. Requires 0064.

alter table coding_turn_stability
  add column if not exists blind_codes uuid[],
  add column if not exists blind_at timestamptz,
  add column if not exists changed boolean;
