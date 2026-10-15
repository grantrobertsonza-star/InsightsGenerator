# REP-IN-002 support-union independent closure ? 2026-10-15

## Closure decision and version

**Agreed REP-IN-002 application-code criteria CLOSED.** No remaining code defect reproduced in this
bounded support-union pass. Preserve verified provenance, legacy-confirmation, distinct-claim,
status and controlled rollback subcases. This is not migration, PostgreSQL or browser closure.

HEAD955a4eccef132956520b3e3c4ba78378d6748885 plus working tree. Both supplied SHA-256 values match
before/after execution; other14 prior handover files remain unchanged:
- extractFindings.ts:824d82913103e69457bcf78c7c42f89237acac5b596ff815b5a5154e1acdff88
- reportImportCompletion.test.ts:f94a32a6b30ef203c3283bc05422aa502d78600ca1aa7fcde57d0ffaf15d9d40

[Retained result manifest](../scripts/verification-repin002/support-union-results.json).

## Executed checks

    node node_modules/vitest/vitest.mjs run src/lib/__tests__/reportImportCompletion.test.ts src/lib/__tests__/findingArchive.test.ts src/lib/__tests__/sheetSelectionConsistency.test.ts src/lib/__tests__/buildCrosstabStrictSetup.test.ts src/lib/__tests__/callerToBuilderStrictSetup.test.ts --no-cache --pool=threads --poolOptions.threads.singleThread

Exit0: **69 passed /1 skipped /0 failed**, five files: report32+skip1, archive9, parser20,
strict-builder2, caller-builder6. Includes actual extraction/publication/archive/provenance/actions/
transaction wrapper against controlled driver. New retained test verifies new A/B support insertion,
repeated duplicate insight within/across chunks, self-reference exclusion, one live insight and
byte-equivalent authoritative state on republication. No independent whole-library491 run claimed.

    node scripts/verification-repin002/support-union.cjs

Exit0: **8 independent controlled checks passed**:
1. Original Old plus A/B remains in the retained insight across/within chunks.
2. Repeated/self/invalid raw references do not create duplicate or invalid links.
3. Exactly one retained insight ID remains.
4. Exactly one final retained-insight union UPDATE uses the supplied active transaction client.
5. Actual withTenant commits then releases.
6. Republication leaves all authoritative state unchanged and performs no needless union UPDATE.
7. Injected final-union failure reaches actual withTenant rollback/release and restores controlled state.
8. Both hashes stay unchanged.

Actual function bodies are extracted in memory; no publication algorithm is reimplemented. Real
archive/provenance and retained fake driver execute. Source inspection independently confirms
extractFindingsFromDocument invokes publishReplacement inside its withTenant callback, awaits the
complete publication, and only then returns from that callback. The final support union loop remains
inside publishReplacement and uses that same client; no external connection or later task writes it.
Controlled rollback proves application sequencing only, not PostgreSQL guarantees.

## Repair assessment

One retainedSupport map spans the publication. Each retained ID starts from its original support
membership; chunk-local raw indices resolve to IDs, then join the shared union. Repeated additions
are ignored and self-links excluded. The union is written once after all chunks, only on added
membership. New findings retain their chunk-local support update. Old+A then Old+B no longer
overwrites A. Preserved human/protected state remains untouched in the passing republication fixture.

The earlier callers.cjs failure and E15 report are historical reproductions of pre-repair source,
not current failures. Their retained artifacts stay intact; this independent scoped verifier and
new retained regression supersede that defect evidence.

## Unchanged named integration checks

Not executed or authorized by this pass:
- Apply0094 in a separately named disposable environment: existing unknown/new tracked-unreviewed
  defaults, repeat migration, check constraint, provenance history.
- Real application-equivalent role action/theme-guard SQL, provenance/change atomicity and final-union
  rollback/cascades/retry.
- Barrier-controlled replacement and researcher-action/publication races with observed lock waiting.
- Browser/reload of incomplete/error state, legacy confirmation and pre-migration recovery.

Existing OBJ-REV-009 write authorization does NOT cover these. No migration applied, no database/
storage writes, no application edits/install/config changes. Do not reopen preserved code subcases
merely because these named integration checks remain open.

## Release baseline

REP-IN-002 code closure is recorded inside the existing IMP-006/REP-IN-001 dependency row.
That broad row moves Confirmed defect -> Implemented awaiting verification, because its frozen
live persistence/browser acceptance remains unexecuted. Do not count it as a second row or a full
Import-module closure.

Current43-row partition: Closed7 / Implemented22 / Confirmed2 / Untested6 / Blocked6.
Priority unchanged34/9/0. Remaining confirmed rows are OBJ-REV-001/002 identity overlap and
FND-001/REP-OUT-001 necessary handover. Existing DEC-001, OBJ-REV-009, OBJ-REV-011, Brief38,
IMP-004 and M02 code subcases are preserved. No broader review or next package executed here.
