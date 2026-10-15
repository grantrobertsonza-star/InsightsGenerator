# OBJ-SET-002 and next independent package OBJ-REV-011 ? 2026-10-15

## Boundary and evidence levels

Application read-only. Claude active REP-IN-002 boundary (archive/publication, finding provenance/actions,
dashboard mutations, page.tsx and0094) excluded from inspection/execution. Actual candidate actions and
error-action wrappers import broader modules; these are replaced at external dependency boundaries.
No active implementation is loaded or claimed verified. Real candidate addition, db.withTenant,
runSync.syncResearchObjective and objectiveLines execute. Quality/validation/framer/framework refresh
boundaries are controlled, so downstream freshness is not closed here.

HEAD955a4eccef132956520b3e3c4ba78378d6748885 plus working tree.
[Exact six-file SHA-256 results](../scripts/verification-objective-addition/results.json).
Hashes matched before/after each script and again at handover. IMP-004 four-file snapshot still matches;
its existing calculation closures are preserved without repeat runs. No relevant source change observed.

## Package1: OBJ-SET-002 candidate addition

Command: node scripts/verification-objective-addition/checks.cjs

Exit0; **12/12 controlled actual-function cases passed**:
1. Empty input does not open transaction/refresh.
2. Trimmed repeated addition leaves one candidate and synchronized accepted text.
3. Different wording remains independently addable.
4. Existing accepted/pending researcher candidate produces conflict/no extra write.
5. Rejected and AI same-text candidates do not block deliberate researcher addition.
6. Other-run same wording remains independent.
7. Missing-index error aborts the controlled transaction; actual action rolls back to savepoint
   BEFORE fallback SELECT, then inserts/syncs/commits and releases connection.
8. Missing-index fallback finds existing candidate and commits without duplicate/sync.
9. Permission error is not treated as missing index; whole transaction rolls back/releases.
10. Accepted-summary update failure rolls back insertion; retry succeeds once.
11. Fallback insertion failure rolls back; retry succeeds once.
12. Postcommit refresh failure leaves committed addition; retry does not duplicate.

Risk coverage: double-submit/retry identity, deliberate re-add scope, aborted-transaction recovery,
atomic candidate/accepted-summary update and postcommit ambiguity. Expected one logical candidate
and exact accepted text are state assertions, not only expected SQL calls.

Actual0083 index is scoped to run_id + trim(candidate_text), researcher_authored/non-rejected,
matching actual ON CONFLICT expression. Fake pg models this declared contract; **it does not prove**
real index inference/enforcement, constraint waits, concurrency, RLS, rollback or migration installation.
No Promise.all fixture is misrepresented as PostgreSQL concurrency. No real DB cases ran.

Decision: candidate-addition/sequential conflict/failure-recovery **code subcases verified**.
Broad OBJ-SET-002 remains implemented awaiting verification because repeated/concurrent additions
and missing-index recovery require actual PostgreSQL. Pre-0083 fallback is sequential-only and
explicitly not race-safe;0083 is required for concurrent supported use. This limitation is not a
newly reproduced current-schema defect.

Prepared, not executed: [schema and protocol](../scripts/verification-objective-addition/README.md).
Actual0016/0083 unchanged; minimal dependency shell deviations documented. Separate named local
objset002_disposable environment, nonowner application-equivalent test role and new authorization
required. Existing REV009 write scope does not authorize this matrix.

## Package2: OBJ-REV-011 migration/error explanation

After package1's controlled checks finished, proceeded to the next nonoverlapping finite package.

Command: node scripts/verification-objective-addition/error-mapping.cjs

Exit0; **64/64 controlled actual-action checks passed**: seven actions x eight errors and one success
each =63, plus one thrown-string error =64.
Actual load/generate/evaluate/edit/retry/promote/list actions run; actual shared explain is not
reimplemented. The evidence dependency and DB operations are controlled and never load archive,
publication, provenance, model or live credentials.

Missing objective_evidence ->0066; missing objective_evidence_results ->0069, not the general0066
branch; missing objective_evidence_generations ->0092. All three permission errors and unexpected
connection termination remain original failures. Existing crosstab-status constraint error maps0066.
Success branches remain reachable, and thrown string errors are handled.

Decision: **OBJ-REV-011 closed at code level for its frozen finite error-mapping contract.**
No new PostgreSQL or browser result is claimed. Optional real missing-schema/role-error injection
and visible browser message checks remain unexecuted integration evidence, not a demonstrated defect
or a reason to reopen this code decision. Deployed supported-schema preflight remains relevant.

## Baseline and next work

No defect reproduced. OBJ-SET-002 remains open at broad-row level with stronger closed subcase evidence.
OBJ-REV-011 moves implemented-awaiting -> Closed at code level. Total43 remains:
Closed7 / Implemented21 / Confirmed3 / Untested6 / Blocked6.
Priority unchanged: release34 (including separate security1), deferrable9, optional0.
Of21 implemented-awaiting rows,18 are release-priority and3 deferrable.

Next nonoverlapping candidate: OBJ-SET-M02 normalization subcases through actual objectiveLines and
independent action paths, subject to stable boundary. Cross-module UI roundtrip/page dependency remains
deferred, not inferred passing. Current REP-IN-002 repair, DEC-001, REV009 and Brief38 remain untouched.
P2a live integration still needs its own stable dependency freeze and disposable-write authorization.
No optional refactor, new issue ID, application edit or database/storage write.
