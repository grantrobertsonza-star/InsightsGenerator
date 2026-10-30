# Trust milestone integration contract

Repair7 is integrated from its released workflow and tenant manifests. Parked hydration bytes are
excluded. This local checkpoint retains earlier application implementation as well as the focused
changes below; passing a gate does not mean every retained source file was independently audited.

An unnamed pair of response rows is not sufficient evidence of intended response meaning. Explicit
Yes/No or True/False pairs may resolve; arbitrary online/store rows require a question-named answer
or visible semantic review. Missing and ambiguous paths remain fail-closed. Numerical traceability
also qualifies sentence-level contrastive subject claims, because matching the number alone cannot
transfer a leaders' statistic to customers. Correct exact/rounded claims retain their earlier scope.

Researcher candidate additions lock the owned run and reuse an existing logical researcher-authored
row. A refresh failure after commit cannot make retry insert another candidate. The objective
missing-index/savepoint fallback uses the same serialization boundary; this does not alter the
separately closed atomic generation/coverage protocol.

Objective evaluation awaits durable persistence inside its catch boundary. A rejected insert remains
pending and does not abort unrelated successful pairs or inflate the success count. Revision checks
continue to refuse an answer calculated for superseded wording. Index coverage is validated against
requested integral indices before replacing a prior saved validation batch.

Instrument reread coverage is recorded transactionally alongside item preservation. Partial rereads
retain confirmed item/link identities, and the native card can disclose incomplete or unrecorded
coverage after reload. This does not expand supported questionnaire interpretation.

See the separate import-resource-boundary and document-storage-cleanup briefs for those contracts.
The role/backup checks use disposable setup-created roles; authentication, real bucket authorization,
deployed-role equivalence and migration-runner certification still require their separate evidence.
Codex's changes and checks are self-validation. Independent review must use the frozen checkpoint.

The evidence panel loads pending-pair count from the same repeatable-read client as questions and
coverage. Continue therefore survives reload after a failed durable write without regenerating
questions or introducing a second snapshot. Imported question definitions are loaded separately
from researcher corrections so clearing a correction restores the declared definition; failure is
visibly unknown. Driver requests refuse unavailable saved layout before dispatch rather than
substituting rows-as-cases.

Objective overview action cells stop click propagation to the selectable row. Otherwise an
Unaccept/Edit click selected the detail view and unmounted the overview controls/editor during
the action. The native OBJ-REV-004 regression covers detail and overview transitions, edited
wording, rejected exclusions and original-brief preservation through reload. Its "regenerate"
step does not establish regeneration: the model replay has no scripted answer for
record_objective_candidates, so the framer refuses with "Nothing was changed" and the harness
does not check the outcome. Regeneration is covered at database level instead.

Regeneration (objectives and decisions) removes only undecided AI suggestions, then inserts the
model's new ones except any whose trimmed wording is already on the run: a rejected suggestion,
an accepted or edited one, or the researcher's own text. Re-inserting rejected wording had undone
the rejection (a pending copy for objectives; an accepted copy that re-entered
runs.decision_statement for decisions). Duplicates within one answer collapse to the first. If no
new wording remains, the transaction rolls back with a visible "Nothing was changed" error so
undecided suggestions are not replaced by nothing. Wording identity is candidateWordingKey
(candidateSuggestionFilter.ts): surrounding whitespace of any kind (spaces, tabs, line breaks,
no-break spaces) is ignored, applied in the app to both stored and new wording. Inner wording, case
and punctuation stay distinct; no semantic matching. An earlier version compared SQL trim() of
stored text (spaces only) with a JavaScript trim of new text, so rejected wording ending in a tab or
line break came back. Concurrent regenerations of one run are not serialised. The 0083 unique
index still uses SQL trim() (spaces only). Manual objective Add now uses objectiveIdentityKey
(GT500-P01, see objective-identity-and-import-lineage.md); the decision own-add guard is unchanged. Covered by
src/lib/__tests__/objectiveDecisionClosure.db.test.ts.
Run `node scripts/e2e/objective-review-acceptance.mjs` against an explicitly disposable manifest
from the local stack; no real model key is used.

Review Objectives coverage (ObjectiveCoverage.tsx) shows the stored evidence_digest_degraded
qualification as a badge and a visible line under the conclusion, the same meaning as the report
section and both story exports; conclusion, status and wording are unchanged, and a working "Check
again" clears it. Covered by src/lib/__tests__/objectiveCoverageDegraded.test.tsx (static render:
true/false/selected) and e2e/ui/objective-coverage-degraded.check.mjs (real permission failure,
reload, restored reassessment). Earlier the component dropped the flag, so coverage read as
unqualified. Native evidence for IMP-005 (calculation under a saved group correction and after
clearing it) and OBJ-REV-013 (refused write pending through reload, then one computed result) is in
e2e/ui/group-correction-calculation.check.mjs and e2e/ui/evaluator-write-recovery.check.mjs; the
latter scripts the crosstab planner through the model fixture's "untargeted" rule, a disclosed
planner boundary, not model-quality evidence.

Save failures on review controls (2026-10-16 overnight). A server action that throws inside a
client transition escaped to the route and replaced the project page (production: the framework's
generic client-exception screen; the app had no error boundary), losing any open draft. Controls that
hold researcher text now report failure in place and keep the text: the Setup objective list (via
saveStatedObjectiveEdit, which returns the actual reason), the shared objective row actions, the
objective table's add/accept-all/delete-suggested, decision cards and list, both recommendation cards
and the objective evidence editor (save, include/leave out, retry). A thrown message withheld in
production shows a generic sentence with the server reference (actionFailure.ts). runs/[id]/error.tsx
catches anything else with Try again. Native: setup-objective-save-failure, review-action-failure,
evidence-edit-failure.

Evaluator continuation (OBJ-REV-M04): the reading loop stops at 60 rounds (GUARD_LIMIT) and then says
"Stopped after a long run with N question(s) still unread" with Continue reading; a round that saved
nothing shows the persistence-stall message; a round whose evaluate action failed shows its error.
In all three cases Continue reading stays offered while the server reports unread questions (it used
to be hidden after a failed round, leaving only Gather again, which regenerates the questions). A
failed panel load shows its error and keeps the previous items. Not natively exercised: the 60-round
cap itself and the failed-round case (code review only).

