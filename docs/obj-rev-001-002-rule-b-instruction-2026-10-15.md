# OBJ-REV-001/002 Rule B — confirmed implementation contract

Rule B is confirmed with the details below. User authorizes writing0095 and the bounded associated
application changes, **not applying0095 to any database**. This document supersedes the no-migration
restriction and blanket treatment of all null-link rows in the earlier boundary, only where0095
provides explicit origin evidence. No implementation or test execution occurred in this review.
Keep the existing issue IDs and frozen identity acceptance; no general Objectives redesign.

## Instruction to Claude

Implement only0095_objective_evidence_origin.sql, the four previously permitted application files
(objectiveEvidence.ts, objectiveEvidenceActions.ts, objectiveValidator.ts, ObjectiveEvidence.tsx),
and focused identity/publication/snapshot tests and necessary scoped test helpers. Keep db.ts,
candidate mutation workflows, page.tsx, other migrations and REP-IN-002 source snapshots/evidence
unchanged. Do not add a manual-entry feature or an identity-rebinding workflow.

### 1. Durable origin and conservative association

- Add origin_candidate_id without a foreign key so candidate deletion cannot erase origin.
  Add origin_recorded with a **fail-closed false default**. Every application creation explicitly
  writes true and the applicable candidate ID, or explicit null for a known free-text origin.
  A default alone must never turn an omitted/unknown origin into known free text.
- Existing currently linked rows may be backfilled from their applicable candidate reference,
  with origin_recorded=true. Existing null-link rows remain unknown. Infer nothing from text,
  position, generation_id or objective_candidates_seeded. Migration rerun must not reset unknown
  rows to known free text or overwrite an already recorded origin. Use the repository's additive,
  idempotent migration pattern; do not apply the migration during implementation.
- A current valid candidate link associates only with that candidate. A recorded candidate origin
  whose link is now null is orphaned: **never use its wording/position to match free text**.
  An unknown-origin null-link row is visibly unknown and never matches a current item. A linked
  candidate no longer accepted is visibly orphaned. Contradictory link/origin data must fail closed,
  not silently choose a new identity.
- Only explicitly recorded free-text-origin rows may use kind + position + normalized wording
  to associate with a current free-text item. Normalize whitespace/case only. This is the bounded
  free-text matching policy, not a claim of immutable identity across arbitrary identical-text
  free-text deletion/recreation. Candidate-origin and unknown-origin rows cannot enter this branch.
- Share the rule across rollup, digest, validator lookup, generation kept matching and load
  classification. Unknown/orphan display keys must be distinct and stable, e.g. evidence-row IDs
  when no common origin is proved. Same text and position must not merge unrelated historical rows.

### 2. Authorship and regeneration

Researcher edits preserve origin_candidate_id and origin_recorded exactly. In particular, changing
source to edited and clearing generation_id under OBJ-REV-009 does **not** change origin. Editing an
unknown row does not make it known free-text origin. Exclusion-only and unchanged edits preserve
their existing behavior.

Manual, edited and excluded evidence survives regeneration, including source=auto/excluded=true
and all orphan/unknown states. Only protected rows reliably associated with a current item suppress
drafting for that item. Keep the existing explicit replacement sweep for source=auto/excluded=false,
including automatic orphans. Listing/classification itself never deletes or reassigns evidence.
Correct the earlier contradictory statement that all orphans are never deleted.

Inventory every actual writer. Current repository search finds one objective_evidence creation
INSERT in publishGeneratedQuestions; objective_evidence_results and generation INSERTs are other
tables. The preparation's manual-add INSERT has not been located. If an existing additional writer
is found, identify it and bring its explicit origin parameters into this same boundary; otherwise
report no current manual-add path rather than inventing one. Test preservation of stored manual rows.

### 3. Snapshot and missing-migration recovery

Use option(a). Current-item/run-text reads and evidence/coverage reads use the SAME supplied
PoolClient inside the existing REPEATABLE READ transaction. Do not call loadItems unchanged if it
opens another withTenant transaction; a small client-bound reader within objectiveEvidence.ts is
permitted. Action-side grouping must be pure over returned snapshot data.

An arbitrary failed current-item/evidence read fails the load visibly; it must not become [] or
an all-orphan successful response. Preserve coverage's existing savepoint-guarded null versus false
semantics. For specifically missing0095 columns, a narrowly recognized savepoint-safe fallback may
load the old columns, classify null-link origin as unknown and return a visible0095 notice. Linked
rows can remain usable where their current identity is established. Permission/connection failures
are not missing migrations and must not be swallowed as compatibility fallback.

Before0095, origin-dependent creation must fail actionably without publishing unrecorded-origin
questions. Check before publication writes where practical; a race/failure during the INSERT must
still roll back the whole publication. No silent legacy INSERT fallback. Preserve human rows and
the prior current generation on failure; do not leave the PostgreSQL transaction aborted after a
caught missing-column query. Missing-migration notice must reach the actual caller/UI, not just logs.

### 4. Preserve OBJ-REV-009 and run affected tests

Publication INSERT and loader read-set changes are authorized. Keep the same run ownership check,
same-client run lock before publication writes, transaction boundary, generation creation/coverage,
current-generation demotion/promotion, question replacement and rollback behavior. Exactly one
current generation after successful publication remains application behavior;0092 enforces at most
one. Origin metadata is independent of generation identity and question revision.

Required finite tests:

1. Existing A1–A8/A10 and linked P1/P3; P2 now uses explicitly recorded free-text origin.
   Deleted candidate and unknown origin with identical current wording AND position remain
   nonmatching, for objectives and decisions. Rejected candidates stay orphaned. Same-position/
   same-text unknown rows keep distinct stable display keys.
2. Actual publication writes explicit true plus candidate/free-text origin values. Omitted-origin
   fixtures remain unknown. Changed/unchanged/exclusion edits preserve origin even when generation_id
   is cleared. Actual regeneration retains manual/edited/excluded orphans and replaces only eligible
   automatic rows; orphan/unknown protected rows never suppress unrelated current drafting.
3. Missing0095 creation and read recovery through actual actions, plus permission/connection failures.
   Publication failure leaves prior questions/generation/human work intact. No false successful empty
   or entirely orphaned load on a failed read.
4. Added-read snapshot interleaving through the actual load action/wrapper: candidate deletion or
   acceptance and run-text change between reads cannot mix snapshot versions. Assert one client,
   isolation established first, rollback/release on error, and coverage null/false preservation.
5. UI consumer/render check: separate visible orphan/unknown state, no selected-objective text-fallback
   attachment, stable keys and actionable migration notice. Use existing tooling; identify source-only
   inspection separately from executed rendering/browser checks.
6. Run the retained11 objectiveEvidencePublish tests plus new origin INSERT/failure cases; focused
   identity tests and affected validator/strict calculation-caller regressions; full typecheck.
   Adapt driver fixtures to the added columns/read without weakening existing assertions.

No PostgreSQL execution is authorized by this instruction. Prepare the targeted integration cases
for later authorization: actual0095 backfill/default/rerun, deletion retaining origin, new INSERT
failure rollback, and the new membership-read two-session snapshot case. Repeat older lock/current-
generation cases only if changes affect those guarantees; the full historical matrix is not
automatically reopened by a hash or INSERT column-list change.

Provide stable before/after hashes, exact executed counts, per-criterion evidence and separately
unexecuted migration/PostgreSQL/browser checks. Preserve OBJ-REV-009, OBJ-REV-011, DEC-001, Brief38
and REP-IN-002 closures. The REP original checkout is released; its retained snapshot is unchanged.
