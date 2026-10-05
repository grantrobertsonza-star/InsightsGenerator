-- Recommendations close the finding -> verdict -> insight -> decision -> action
-- chain. Up to now the table only had the terminal, "already decided" shape
-- (action_text, owner_role, etc. all not null, nothing to say whether a
-- given row is still just a suggestion). Bringing it up to the same
-- candidate-review shape as decision_candidates and objective_candidates:
-- a source, a status a researcher moves through (pending -> accepted, or
-- rejected), and an edited flag for text changed before accepting. Unlike
-- those two tables, more than one recommendation can be accepted at once
-- for a run, since a set of insights plausibly supports several actions
-- side by side, not a single either/or choice.
alter table recommendations add column created_at timestamptz not null default now();
alter table recommendations add column source text not null default 'ai_suggested'
  check (source in ('ai_suggested', 'researcher_authored'));
alter table recommendations add column status text not null default 'pending'
  check (status in ('pending', 'accepted', 'rejected'));
alter table recommendations add column edited boolean not null default false;

-- run_id is added directly rather than always joining through insight_id,
-- since the regenerate/dedupe flow (mirroring decisionFramer and
-- objectiveFramer) needs "delete this run's pending ai_suggested rows"
-- without a join.
alter table recommendations add column run_id uuid references runs(id) on delete cascade;
update recommendations r set run_id = i.run_id from insights i where i.id = r.insight_id;
alter table recommendations alter column run_id set not null;
