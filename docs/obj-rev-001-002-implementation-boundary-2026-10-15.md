# OBJ-REV-001/002 preparation review and implementation boundary

Decision: proceed with option (a), with the identity correction below. This is a preparation review,
not implementation or closure. Application code was read only; no tests or database writes ran.
Claude's preparation test results remain Claude-reported. [Current hashes](obj-rev-001-002-boundary-hashes-2026-10-15.json).

## Required correction: matching is not identity

Migration0081 uses ON DELETE SET NULL and records no former candidate identity. A deleted-candidate
row and a genuine old free-text row can have identical kind, order, text and null candidate IDs.
A new free-text item can also repeat that wording at that position. Normalizing text and adding it
to a positional key reduces accidental matches but cannot distinguish these histories. The proposed
claim that it can never reconnect deleted/recreated items is therefore unsupported by the schema.

Within this no-migration package, treat every unlinked row lacking reliable identity as **unknown**,
including an exact wording/position match. Do not count it as evidence for a current item, suppress
drafting for that item, or mark it current. Distinguish it visibly from a known linked candidate
that is no longer current, which is an orphan. Neither state implies the evidence itself is false.
Do not merge ambiguous rows into one asserted objective merely because text/position agree; a
per-evidence-row grouping key is sufficient where no common identity can be proved.

Candidate-backed rows keep their ID across wording/reorder. Deleted/rejected candidates cannot
reattach by text. Shared helpers must represent non-matchability explicitly rather than handing
every unknown row the same usable null/empty identity key.

This corrects a material omission in the frozen safety criterion, not an expanded feature. Add
the exact-wording/exact-position delete/recreate test for objectives AND decisions. Preparation P2
(unchanged historical free text) cannot remain a claim of verified continuity when its stored data
is indistinguishable from that case. Keep it as historical characterization, then transparently
assert conservative unknown handling after repair. Preserve P1/P3 and all reliable linked cases.
Document the limitation and recovery through existing candidate-backed objectives/decisions and
regeneration. Do not silently label fresh unlinked rows as proven identity either. If trusted
free-text continuity is required, report the need for durable identity as a separate scoped
decision; do not add a migration, auto-seeding, rebinding UI or lineage redesign in this repair.

## Preservation contract

- Listing, classification, validation and selection never delete, rewrite or reassign evidence.
- Regeneration retains edited, manual and excluded rows, including source=auto/excluded=true,
  whether current, orphaned or unknown. Preserve wording, identity fields and exclusion decisions.
- Existing explicit regeneration may replace/delete ONLY untouched source=auto/excluded=false
  rows, including their orphans. This is the agreed automatic replacement behavior, not an
  absolute promise that every orphan survives regeneration. Correct the contradictory plan prose.
- Only reliably associated protected rows suppress drafting for their own current item. An
  orphan/unknown row must not suppress an unrelated current item.

## Option (a): one client and snapshot

Read current accepted candidates and run text inside loadObjectiveEvidenceAndCoverage using its
supplied PoolClient and existing REPEATABLE READ wrapper. loadItems currently opens withTenant;
calling it unchanged would open another transaction and violate option (a). A small client-bound
reader shared with its existing wrapper is permitted within objectiveEvidence.ts.

Return classification inputs or classified groups from that snapshot; action-side grouping may be
pure, but must not perform an independent current-item query. Preserve coverage null versus false,
savepoint recovery, isolation-before-read, rollback/release and missing/foreign-run behavior.
If current-item lookup fails, fail visibly or explicitly classify identity as unknown; never turn
a failed lookup into a positively verified current group or an apparently successful empty lookup.

## Permitted and excluded files

Permitted application changes only:

- src/lib/objectiveEvidence.ts: shared association rule, client-bound current-item reader,
  snapshot classification, rollup/digest/kept matching and necessary return types.
- src/lib/objectiveEvidenceActions.ts: consume snapshot result; no second lookup.
- src/lib/objectiveValidator.ts: consume shared association rule; no positional recovery.
- src/app/runs/[id]/ObjectiveEvidence.tsx: visible orphan/unknown section, safe selection filtering,
  stable group keys and concise recovery wording.

Permitted tests: objectiveEvidenceIdentity.test.ts, objectiveEvidencePublish.test.ts and a new
isolated scoped snapshot/UI-consumer test if needed. Test helper changes only where necessary to
model the added read; do not weaken the publication assertions.

Read-only dependencies: db.ts, ObjectiveSelection.tsx, objectiveLines.ts, text.ts, crosstabs.ts,
dataSetup.ts and framework/model boundaries. No change to publishGeneratedQuestions transaction,
storeResult/revision protocol, candidate mutations, schema/migrations, page.tsx, exports, other
Objectives packages, Import or REP-IN-002 code/harness/evidence. No optional cleanup/refactor.
REP-IN-002's original checkout freeze is released; its completed results attach to its archive.

## Hash reconciliation and preserved closures

Current objectiveEvidence.ts f7968646... exactly matches the independently verified Brief38
18-file manifest and the retained REP final archive. Recorded intervening Brief36/37 repairs
introduced strict saved-design and dictionary/layout status handling in evaluateEvidenceQuestion;
Brief38 actual caller/builder regressions cover that boundary. Actions e3981aa0... and db42882fa4...
still match E3. The older E3 evidence hash6e7c1785... is a different verified snapshot, not proof
of a regression. No complete byte-for-byte E3 source diff is claimed from a hash alone.

Preserve OBJ-REV-009 code/agreed PostgreSQL/replay closure, Brief38, OBJ-REV-011, DEC-001 and REP
closures. Adding an identity read requires affected read-path verification, not reopening the
unchanged publication lock/generation/rollback contract or repeating the entire historical matrix.

## Frozen verification instruction to Claude

1. Execute actual-function A1–A9, plus the identical-wording/position ambiguity cases above for
   both kinds. Cover rejected/still-linked candidates; ambiguous rows at identical positions must
   not merge into asserted identity. Preserve linked reorder/wording identity and human fields.
2. Exercise the real generation kept decision (prefer actual generation entry point with external
   data/model fixtures) and actual regeneration/publication preservation. A standalone exported-key
   test alone does not prove callers use the rule. Check edited/manual/excluded orphans and unknowns
   survive; untouched automatic replacement retains its existing behavior.
3. Run the retained11 Objectives publication tests, and affected objective-validator/evidence and
   strict calculation-caller regressions. Existing expected-failure reproductions become ordinary
   passing acceptance tests; report executed counts and failed assertions accurately.
4. Add a snapshot interleaving test through the ACTUAL load action/wrapper: change accepted
   candidates/run text between coverage/questions/current-item reads. One same-client transaction
   returns a coherent old or new version, never mixed classifications. Check isolation established
   first, lookup failure and rollback/release. A fake's snapshot proves wiring only.
5. Exercise actual UI filtering/rendering via existing callback/JSX/browser techniques: unknowns
   and orphans remain visible separately, cannot appear under a selected same-text current item,
   and same-position groups do not collide. No new RTL/jsdom dependency required. Label source-only
   inspection as such; it is not a browser pass.
6. Prepare only an affected two-session PostgreSQL read test for the new snapshot membership read:
   reader establishes snapshot; other client changes candidate acceptance/deletes candidate and
   adjusts run text; old reader remains coherent, fresh reader reflects new orphan/unknown status.
   Repeat missing-read/rollback case only if that path changes. Reuse existing infrastructure under
   applicable explicit disposable authorization; no new DB writes in this preparation review.
   Repeat publication-lock/generation tests only if an actual change touches their guarantees.

Freeze these scoped files after implementation and provide before/after hashes, exact commands,
per-case evidence, limitations and any deferred PostgreSQL/browser checks. No closure inferred
from compilation or a changed hash. No new issue ID; REV-002's distinct original definition remains
unavailable, with only the recovered identity overlap in scope. Baseline status remains unchanged.
