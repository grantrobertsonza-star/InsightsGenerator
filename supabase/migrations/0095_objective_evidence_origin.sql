-- OBJ-REV-001 / OBJ-REV-002 (Rule B): durable origin for objective evidence rows.
--
-- objective_evidence.objective_candidate_id / decision_candidate_id (0081) are
-- `on delete set null`, so once a candidate is deleted its evidence row looks exactly like a row
-- written for a free-text objective, or a row written before 0081. Without a durable record of
-- where a row came from, its identity cannot be established, and matching it by wording or
-- position could attach one objective's evidence to an unrelated one.
--
--   origin_candidate_id  the candidate the row was written for, with NO foreign key, so deleting
--                        the candidate cannot erase it. Null for a known free-text origin.
--   origin_recorded      true only when the writer explicitly recorded the origin. Fail-closed:
--                        the column default is FALSE, so an insert that omits origin stays
--                        "origin unknown" and is never treated as known free text. Every
--                        application insert writes true explicitly (objectiveEvidence.ts,
--                        publishGeneratedQuestions).
--
-- Back-fill: only rows that are linked to a candidate today have a known origin (that link);
-- they get origin_candidate_id = that candidate and origin_recorded = true. Every existing row
-- with a null link stays origin_recorded = false (unknown): nothing is inferred from wording,
-- position, generation_id or objective_candidates_seeded. A rerun only touches rows still
-- recorded false with a current link, so it never resets a recorded origin, never overwrites one,
-- and never turns an unknown row into known free text.
--
-- Additive and idempotent. Written for OBJ-REV-001/002; not applied to any database as part of
-- that repair.

alter table objective_evidence
  add column if not exists origin_candidate_id uuid,
  add column if not exists origin_recorded boolean not null default false;

update objective_evidence
   set origin_candidate_id = case when item_kind = 'objective' then objective_candidate_id else decision_candidate_id end,
       origin_recorded = true
 where origin_recorded = false
   and ((item_kind = 'objective' and objective_candidate_id is not null)
     or (item_kind = 'decision' and decision_candidate_id is not null));

-- An unrecorded origin cannot carry an origin candidate: that combination would be a claim of
-- known origin without the explicit record, so it is rejected rather than interpreted.
alter table objective_evidence drop constraint if exists objective_evidence_origin_recorded_check;
alter table objective_evidence add constraint objective_evidence_origin_recorded_check
  check (origin_recorded or origin_candidate_id is null);
