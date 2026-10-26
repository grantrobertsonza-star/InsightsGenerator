-- Keeps what each re-run gave, so the coding can be settled by majority of runs.
-- run_codes: one array per re-run (the original is orig_codes), each holding 1-based codebook numbers.
-- consensus_at: when the majority of runs was applied as the coding.
-- Additive. Requires 0064.

alter table coding_turn_stability
  add column if not exists run_codes jsonb,
  add column if not exists consensus_at timestamptz;
