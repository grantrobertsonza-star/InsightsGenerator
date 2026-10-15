# OBJ-REV-001/002 Rule B independent verification — 2026-10-15

**Agreed application-code criteria closed. No concrete in-scope failure reproduced.**
The broad identity row remains implemented awaiting the targeted migration/PostgreSQL/browser
checks below. This is not full Objectives sign-off. Preserve OBJ-REV-009, OBJ-REV-011, DEC-001,
Brief 38, REP-IN-002 and all other previously passing subcases.

HEAD `955a4eccef132956520b3e3c4ba78378d6748885` plus working tree. All ten supplied full SHA-256
hashes match. Sources and seven recorded shared dependencies stayed unchanged through handover.
[Hash manifest](../scripts/verification-rule-b/sources-before.json) ·
[Executed results and exact commands](../scripts/verification-rule-b/results.json).
The supplied completion handover arrived after the native run; byte comparison then matched,
and the final comparison matched again. No application edits, migration application or database writes.

## Frozen acceptance decisions

| Criterion | Decision and executed evidence |
|---|---|
| Deleted-candidate / unknown origin never reconnects by wording and position | Code-level closed. Actual validator prompt capture and load action cover identical wording/position for objectives and decisions; rejected candidates and contradictory links remain nonmatching. Only recorded free-text origin matches the bounded kind/position/wording policy. |
| Regeneration preserves manual, edited and excluded evidence | Code-level closed. Actual generation/publication keeps manual-unknown, edited-deleted and excluded-auto rows; only eligible untouched automatic rows are swept. Protected orphans do not suppress unrelated drafting. |
| Explicit creation origin; edits preserve origin | Code-level closed. Actual publication INSERT parameters explicitly include true and candidate ID or null. Changed, unchanged and exclusion-only edits preserve origin independently of generation ID. Repository writer search confirms one application creation INSERT; no manual-add feature was invented. |
| Distinct stable unknown keys | Code-level closed. Repeated actual loads keep separate row-ID keys for identical historical text/position; real UI partition/render checks preserve separation. |
| Missing migration and failed reads | Code-level closed. Actual actions refuse generation before model/write, direct publication checks after run lock before writes, and injected INSERT failure rolls back the controlled store. Read fallback rolls back its savepoint before old-column SELECT, returns originAvailable=false and renders actionable 0095 guidance. Permission/connection/missing-run failures return failures, not empty success. |
| Same-client snapshot | Code-level sequencing closed. Actual action → actual REPEATABLE READ wrapper → coverage/current items/evidence uses one client, isolation first, commit/release or rollback/release. Interleaved committed-store mutation yields the earlier version under the fake snapshot. Coverage unknown/null remains distinct from recorded false. Real isolation remains unexecuted. |
| UI consumer | Five executed static-render tests of actual EvidenceGroups and partitioning pass: separate orphan reasons, selected-objective exclusion, absent-current-evidence message, stable keys and migration notice. Component source also forwards originAvailable and returns on load failure. Mounted/browser reload is not claimed. |
| Preserve publication guarantees | Retained eleven publication tests pass. Source inspection confirms same-client ownership/run lock before new catalogue check, then generation demotion/creation, eligible sweep and explicit-origin INSERTs inside the existing transaction. No separate connection or postcommit origin write was introduced. |

## Executed checks and limitations

- Native Vitest: **6 files, 60 passed / 0 failed**, identity18 + origin18 + UI5 + publication11 +
  caller-to-builder6 + strict-builder2. The command also named a nonexistent objectiveValidator.test.ts;
  no seventh file or additional validator tests are counted. Actual validator runs in identity tests.
- `node scripts/verification-rule-b/error-mapping.cjs`: **78 controlled actual-action checks passed**.
  This isolated adaptation of the retained error-mapping harness supplies the new empty-load shape
  and adds both missing-origin-column messages. Seven actions × ten errors plus success, and one
  thrown-string case. Existing 0066/0069/0092, permission and connection behavior remains intact.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false -p .`: **exit 0**.

Models, pg driver, dictionary and framework boundaries are controlled in native tests. The fake
models rollback and snapshots; it records savepoints without enforcing PostgreSQL aborted states.
Assertions check rollback-to-savepoint ordering. This does not establish actual DDL, constraints,
lock waiting, isolation or deployment permissions. Claude's 532-test library run and mutation run
are implementation evidence, not independently rerun here. Completed REP matrices were not repeated.

Migration source inspection confirms no origin FK, default false, own-kind linked-only backfill,
no reset of recorded origins and the recorded-origin constraint. Inspection is not execution.
The pre-Rule-B objectiveEvidence.ts hash change was already reconciled to strict lookup repairs;
the new hash and INSERT columns do not alone reopen OBJ-REV-009.

## Precisely remaining integration checks

1. Execute unchanged 0095 against a separately authorized disposable schema: linked backfill,
   unknown null-linked rows, omitted-origin default, rerun stability and constraint rejection.
2. Delete actual candidate: FK link becomes null while durable origin survives and classifies deleted.
3. Actual origin INSERT fault rolls back prior-generation demotion, sweep and new rows together,
   preserving human work; retry succeeds. This is the changed INSERT boundary, not a full REV-009 rerun.
4. Two real sessions: pause actual load after coverage; commit membership/run-text/publication changes;
   remaining reads stay on the original snapshot. No new lock-protocol defect is asserted.
5. Running application/reload: orphan/unknown section, selected-objective exclusion and 0095 recovery.

No authorization for these writes is inferred from REP-IN-002 or OBJ-REV-009. No additional defect,
issue ID, redesign or optional refactor is proposed. The distinct historical REV-002 definition
remains unavailable; this closes only its recovered overlap with REV-001.

## Nonoverlapping P2a implementation boundary for Claude

Released for the three documented P2a repairs only:

- `src/lib/previewActions.ts`: raw preview authoritative publication, losing-proposal reparse and refusal.
- `src/app/runs/[id]/ImportVariablesPanel.tsx`: document-scoped saved-override hydration preserving edits.
- `src/app/runs/[id]/page.tsx`: only cached Import table identity validation/recovery and the minimal
  props/query wiring needed for those two Import presentations. Its Objectives, findings publication,
  legacy confirmation and native refresh/action bodies remain excluded. This review never imports
  page.tsx; changing its Import loader does not invalidate these executed Objectives tests.
- `src/app/runs/[id]/ImportQualityPanel.tsx` if needed only for the existing visible recovery state;
  new isolated P2a test files and repair handover documentation.

Frozen/excluded: the four Rule B application files, 0095, their four focused test files and
fakeObjectiveDb.ts; db.ts, crosstabs.ts, parseTable.ts, parseStatsFile.ts, documentTables.ts,
dataSetup.ts/dataSetupShared.ts, objectiveLines.ts, variableOverrides.ts, variableOverrideActions.ts,
all other migrations and existing regression tests. Shared helpers may be called unchanged.
Do not change frozen REP source archives or completed result artifacts. No parser/engine rewrite.
If a repair requires an excluded shared-file change, stop that affected part and identify it;
continue independent allowed work. Boundary changes require explicit impact review.

Keep REP-IN-002's archive-based closure independent of the released checkout. P2a remains exactly
the raw preview, cached missing-sheet preview and correction-picker reload failures under existing
IMP-002/IMP-SHIP-001 and IMP-005. The next verification package is those repaired P2a failures and
affected regressions once their implementation is stable; no completed gates need reopening.
