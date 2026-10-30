-- CE-6 (evidence chain, 26 October 2026): the analysis plan.
--
-- The objective evidence lane (0066) already breaks each objective and decision into evidence questions
-- answered by tables. Those questions are the analysis plan's lines. This adds what a plan needs:
--
-- objective_evidence.approved_revision / approved_at: the researcher approved this line, at this wording
--   (question_revision, 0082). An edit bumps question_revision, so a line whose revision differs from
--   approved_revision is "changed since approval" and has to be approved again. Null: not approved.
--   Approval is acceptance only; who wrote the wording stays in `source` (auto, edited, manual).
--
-- objective_evidence_generations.methodology_state / methodology_sha: the project's stated methodology
--   (runs.methodology, read from the brief, proposal or report) the plan was written with: 'stated'
--   (with the sha of its text), 'none_stated' (it was read and none was found) or 'not_read' (never read,
--   or its reading failed). A plan whose sha differs from the current text is shown as written before
--   the methodology changed. Null state: written before this migration, so not recorded.
--
-- document_tables.plan_line: on a table moved from the plan into Cross tabs, the plan line it answers,
--   as it was when moved ({evidenceId, revision, approvedRevision, question, itemKind, itemText,
--   objectiveCandidateId, decisionCandidateId}). Findings committed from the table are "planned" and
--   carry their objective through it. A snapshot, so the route survives the line being edited or
--   removed later; plan_evidence_id points at the live line while it exists.
-- Run npm run backup before applying.

alter table objective_evidence
  add column if not exists approved_revision int,
  add column if not exists approved_at timestamptz;

alter table objective_evidence
  drop constraint if exists objective_evidence_approval_check;
alter table objective_evidence
  add constraint objective_evidence_approval_check
  check ((approved_revision is null) = (approved_at is null));

alter table objective_evidence_generations
  add column if not exists methodology_state text check (methodology_state in ('stated', 'none_stated', 'not_read')),
  add column if not exists methodology_sha text;

alter table document_tables
  add column if not exists plan_evidence_id uuid references objective_evidence(id) on delete set null,
  add column if not exists plan_line jsonb;

create index if not exists document_tables_plan_evidence_idx on document_tables (plan_evidence_id) where plan_evidence_id is not null;
