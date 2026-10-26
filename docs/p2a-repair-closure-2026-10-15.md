# P2a combined repair verification — 2026-10-15

**All three documented P2a repair behaviors pass.** No remaining reproduced P2a defect in this
bounded package. Preserve earlier parser/provenance and calculation passes, Rule B, REP-IN-002,
OBJ-REV-009/011, DEC-001 and Brief38 closures. No full Import/module/public-release sign-off.

Contract: [one implementation/validation package](p2a-repair-validation-contract-2026-10-15.md).
Claude implemented raw-preview authority and picker hydration; Codex executed/reviewed those and
implemented/tested cached-preview protection. The latter is self-validation, not a claim of a
separate independent review of Codex's own code.

## Decisions

| Existing issue/subcase | Result | Concrete observed behavior |
|---|---|---|
| IMP-002 / IMP-SHIP-001 raw preview | Closed | Actual preview waits on a competing PostgreSQL publication, adopts Sparse/1 and agrees with actual dictionary. Observed waiter/blocker evidence retained. Scoped selected-sheet trigger fault returns actionable error with no unconfirmed table; removal/retry recovers Dense/40. |
| IMP-002 / IMP-SHIP-001 cached preview | Closed | Existing selected-sheet parser verifies stored preview values/count against current workbook. Missing/unconfirmed/unreadable selection or mismatch withholds rows and correction/quality controls with recovery. Native Removed-sheet reload shows recovery without cached40-row preview or automatic table replacement; restoring Dense recovers. Actual cached finding-source viewer likewise refuses and recovers without replacing stored rows. |
| IMP-005 picker reload | Closed subcase | Native save persists only Q1 (2)=continuous. Hard reload/reselection displays continuous, siblings remain independent; mounted tests retain pending/failed local edits over stale props and keep documents separate. Native calculation/reload retains Dense and override snapshot, numeric average1.5, sibling50%/50%. Broader correction-dependent freshness remains a required check, not a newly demonstrated defect. |
| IMP-003 canonical collision target | Closed | Preserve earlier actual parser/reader/correction persistence/calculation evidence. Native corrected/reloaded Q1 (2), untouched Q1/Q1 (3), their values and saved numerical outputs now complete its existing finite acceptance. No canonicalization rewrite. |

The cache check uses the unchanged parser, once per affected workbook per page load. It does not
infer cached provenance from dictionary metadata or add a schema field. Only stored preview values
and count are compared; this does not certify arbitrary undisplayed evidence or prove an immutable
history of workbook identity. Page passes preview=null on failure, rather than empty tables that
would trigger an automatic reread. Recovery preserves existing evidence and asks for deliberate
reload/source correction/re-upload. CSV and report-table behavior remain unchanged on successful
source lookup. No statistical rule or parser implementation changed.

## Executed checks

- `node scripts/validate.cjs`: Next route type generation and full-project typecheck pass;
  **58 retained files,552 passed /1 existing skipped /0 failed**. Fork workers isolate tests;
  integration runners are excluded from this automated gate.
- Earlier combined focused run:8 files,65 passed before the final mounted recovery assertion.
  Full retained run above includes that assertion (six hydration cases) and seven new cache cases.
- Affected real PostgreSQL/storage run: **3 passed**,11 intentionally filtered, not repeated passes.
  Actual raw preview lock/adoption, actual raw preview persistence-failure/retry, actual cached
  source-viewer missing-sheet/recovery. Assertions use real application functions and real storage.
- Native browser: two synthetic uploads as setup; cached missing-sheet/recovery and no automatic
  reread; correction save/reload/reselect; native calculation and saved reload all pass.
- Frozen production build/typecheck passes. Existing unpdf webpack warning retained.

Local retained results: scripts/p2a-repair-final/runs/authorized, including vitest-affected.json,
core-state-affected.json.raw-preview-lock.json, cached-preview-result.json,
browser-correction-saved.json, native-calculation-invariants.json and screenshots/text.
These generated artifacts stay local, outside the Git checkpoint. Earlier failures are retained
in the original P2a report and artifacts, not overwritten by passing results.

## Isolation/version/cleanup

Fresh synthetic p2a-repair-20261015 environment; PostgreSQL127.0.0.1:55502, local storage55012,
storage-only router55013, app3113, separate browser/CDP9232. New nonowner application roles and
private synthetic buckets. The existing authorized P2a setup/fixtures were reused only for these
affected cases; no full9-gate or completed REP/Rule B matrix was repeated. Schema through0094;
0095 deliberately not applied in this P2a package. No live data, existing credentials, external
model calls, dependency installation or application patches inside the test runtime.

Frozen443-file repair archive SHA-256
`2c8f777979849a1fb123dc0c8ece7464ba92c2889ef6726dbc1855cbe623ee44`, plus unchanged pinned Python
companions. All source/migration bytes stayed unchanged; only runtime-generated next-env.d.ts
changed. Real Python calculation was in the existing supported P2a scope; no new engine change.

Retained source hashes, SQL/storage fixture evidence, dumps/grants/owners and both PG log streams
before verified recorded container/volume/process/runtime cleanup. Local synthetic key removed.
No matching P2a helper/Python workers remained. Deployment-role/gateway/migration-process and the
separate pre-public security gate remain outside these closures.

## Release and validation handover

IMP-002 and IMP-003 close for their frozen scope. IMP-005 returns Confirmed defect -> Implemented
awaiting verification, with picker/canonical/effective-calculation subcases closed; remaining
dependent invalidation/reload criteria are unexecuted requirements. No new defect ID or optional
refactor. The single consolidated baseline separates defects, acceptance checks and limitations.

Local/CI commands: `npm run typecheck`, `npm run test:retained`, `npm run validate`.
`.github/workflows/validate.yml` is prepared for review (pull_request/manual), not executed remotely.
It runs npm ci and the same validate gate on Node24. No database/model/storage credentials required
for the retained unit tests. Risk-specific disposable/browser cases remain explicit milestone work.
