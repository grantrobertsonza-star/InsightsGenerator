# REP-IN-002 independent provenance/preservation verification ? 2026-10-15

## Decision

**Further repair required only for repeated duplicate-insight support merging in this reviewed batch.**
The previous human-action provenance and quote-only distinct-claim suppression defects are fixed at code
level. Preserve those passing subcases, staging/publication and completion/error closures. Real PostgreSQL
guarantees and browser workflow are unverified, not additional reproduced defects. No new issue ID.

HEAD955a4eccef132956520b3e3c4ba78378d6748885 plus working tree. All16 handover SHA-256 hashes matched,
and all16 matched at completion. [Manifest, results and subsequent M02 hashes](../scripts/verification-repin002/results.json).
No application code, migration, database/storage or credentials changed.0094 was inspected only.

## Six acceptance groups

| Case | Decision | Independent evidence and remaining boundary |
|---|---|---|
| Single/bulk acceptance; theme/kind/note edits survive report reread | Code-level verified | Retained actual findingActions + provenance + extraction/archive tests pass. Cleared note still records edit; acceptance does not imply content edit. Protected IDs, human fields and dependencies remain live. Real locking/role/commit semantics unverified. |
| Dashboard actions record provenance; automatic themes respect human edits | Code-level caller wiring verified; real SQL guard behavior pending | Additional actual extracted add action bodies exercised insert and revive in all8 tools: chart, NPS, brand, CSM, wave NPS/chart/driver, driver. Real recordHumanReview emitted tool_add for returned IDs on the supplied transaction client (16 checks). Brand/CSM existing refresh and coding sync emitted conditional theme guards (3 checks). Description builders/framework and SQL responses controlled; guard SQL was captured, not evaluated by PostgreSQL. |
| Before0094, unknown work cannot be retired by replacement/confirmation | Code-level verified | Retained fake rejects missing0094 columns; real single actions save, reread blocks visibly with migration name and no confirmation; passed confirmation does not permit retirement. Regenerate-rejected keeps its separately agreed explicit rejection-replacement contract. Migration not executed. |
| After0094, confirmation only covers listed/document-scoped/still-unprotected rows | Code-level verified | Retained default/partial/full confirmation tests pass. Additional actual publication reads protect a row reviewed after the prompt; foreign-document IDs remain untouched; an unlisted unknown row withholds the whole publication. Actual page confirmation forwards nonempty string IDs/options, returns without work for empty input; actual runReportExtraction produces incomplete plus retry error. Actual loader captures run/document/ID/provenance filters and maps named prompt entries. Controlled SQL is not real RLS/concurrency/browser proof. |
| Distinct shared-quote claims survive; duplicate support resolves to retained IDs | Partially resolved: one reproduced defect | Retained exact Satisfaction/Loyalty fixture, same-page duplicate resolution and existing support links pass. But repeating the same retained insight across chunks loses support added by an earlier chunk; reproduction below. |
| History provenance; partial/failing publication preserves authoritative work | Code-level verified, DB integration pending | Retained real archive tests cover all five provenance columns and pre-migration SQL; extraction tests cover partial/total failures, retirement/insertion failure, rollback/retry, protected identities/dependents. Driver only models rollback/cascades.0094 defaults, actual history values/constraints, lock waits and cascades not executed. |

## Confirmed defect for Claude (existing REP-IN-002)

Actual private publishReplacement body, real plan/identity/provenance/archive functions and retained
fake driver reproduce this supported multi-part report:

- Protected retained insight I already cites Old.
- Chunk1 contains a genuine duplicate of I, citing protected fact A.
- Chunk2 contains the same genuine duplicate of I, citing protected fact B.
- Expected I support IDs: [Old,A,B].
- Actual persisted update result: **[Old,B]**.

The keptByClaim row is the pre-publication snapshot. Each duplicate sets keepExisting from that same
original row, then the later merge UPDATE overwrites the earlier addition. No model or deduplication
formula is substituted in the reproduction. This is an existing agreed support-preservation criterion,
not a new feature or unrestricted-audit finding. Lost evidence membership materially affects downstream
support; the broad Import dependency row remains confirmed-defect under REP-IN-002.

Smallest correction: accumulate the resolved support union per retained ID throughout the publication,
including repeated appearances within one chunk and across chunks; preserve original links. No general
dependency redesign needed.

Closing test: old+A+B union remains after publication/reload, one live insight ID, no self-links or
duplicate link IDs; repeat publication does not lose earlier links. Retain the already-passing
distinct-claim/page/duplicate and rollback fixtures.

## Executed commands and exact outcomes

    node node_modules/vitest/vitest.mjs run src/lib/__tests__/reportImportCompletion.test.ts src/lib/__tests__/findingArchive.test.ts src/lib/__tests__/sheetSelectionConsistency.test.ts src/lib/__tests__/buildCrosstabStrictSetup.test.ts src/lib/__tests__/callerToBuilderStrictSetup.test.ts --no-cache --pool=threads --poolOptions.threads.singleThread

Exit0: **68 passed /1 skipped /0 failed**, five files. Report31+skip1, archive9, parser20,
strict-builder2, caller-builder6. Not a claim of independent whole-library490 tests.

    node scripts/verification-repin002/callers.cjs

Final exit1: **24 controlled caller/publication checks passed;1 support-link failure reproduced**.
Eight insert+revive tools16, theme-guard SQL3, page confirmation2, recheck/document-scope2, loader1.
Real production function bodies execute via AST extraction. Description helpers/refreshes and driver
boundaries controlled. First fixture attempt had no wave segments and correctly failed the action
precondition; fixture corrected, no application assertion weakened.

Migration source inspection: existing rows receive false, future automatic inserts default true,
review/edit are separate, history mirrors five columns. This is NOT execution of defaults/checks/RLS.

## Minimum separate integration checks (not authorized/executed)

1. Apply0094 in a new explicitly named disposable schema: old rows unknown; new automatic insert
tracked/unreviewed; repeat migration safe; action check constraint; history copies all five values.
2. Actual application-equivalent nonowner-role single/bulk/edit/dashboard action writes commit provenance
with the change; forced provenance failure rolls back both. Theme guards preserve edited theme while
eligible automatic theme still updates.
3. Actual retirement/insertion rollback and retry; history/live membership/cascades and support IDs.
4. Barrier-controlled concurrent replacement and action/publication races; observe actual waiting.
Post-prompt review/edit/insight/citation must be rechecked. No final-count-only locking claim.
5. Browser/reload: incomplete/error state, named legacy prompt and confirmation, pre-migration recovery.
No mounted/browser result is inferred from extracted callbacks.
Existing OBJ-REV-009 authorization does not cover any of these writes.

## Subsequent independent OBJ-SET-M02 package

Only after the REP-IN-002 review completed, confirmed independent objectiveLines/candidate action/
runContextActions/runSync hashes. No report/publication functions loaded for M02; actual named Setup
edit and Review accept bodies and synchronizer execute with controlled SQL.

    node scripts/verification-repin002/normalization.cjs

Exit0: **36 actual-action roundtrip cases +7 parser cases passed**. Six supported marker forms
(number-dot, number-parenthesis, hyphen, asterisk, Unicode bullet and plain) crossed6x6:
Setup edit -> Review wording edit -> Setup edit -> deletion. Same ID, normalized stored list and
accepted objective text preserved; no duplicate insertion. Heading-only lines omitted.
First harness attempt returned mutable row references rather than independent pg result objects;
corrected the fake snapshot with structuredClone and reran. This was a harness failure, not an
application regression or weakened assertion.

M02 normalization/action subcases closed at code level; broad row stays implemented awaiting
verification for real persistence and dual-presentation browser roundtrip. No expansion to whole
Objectives identity audit. OBJ-REV-011 remains closed and its source hash unchanged. DEC-001,
OBJ-REV-009, Brief38 and IMP-004 closed evidence preserved. No optional improvement or new ID added.
