# Rule B G5 browser/reload closure — 2026-10-15

**G5 passed. All five agreed Rule B integration gates are now closed at their recorded scope.**
G1–G4 retain their earlier PostgreSQL passes; they were not rerun. Preserve the application-code
closure and every earlier closure. No application defect or additional acceptance criterion was
introduced. This is not full Objectives-module or public-release sign-off.

[Combined five-group matrix](../scripts/rule-b-g5/execution-summary.json) ·
[Earlier G1–G4 evidence](rule-b-integration-verification-2026-10-15.md) ·
[Database/native invariants](../scripts/rule-b-g5/runs/authorized/final-invariants.json).

## Executed finite browser checks

| Phase | Result | Native rendered and persisted observations |
|---|---|---|
| Post0095 | Passed | One current linked group and four separate orphan groups: two unknown, one deleted-origin with identical current wording, and one rejected candidate. All are visible; reasons match. Actual objective selector becomes selected; unknown/deleted evidence remains only in the orphan section. Reload/reselect preserves this separation. No migration notice. |
| Pre0095 | Passed | Actual native load uses real savepoint recovery on missing columns. Current candidate-linked evidence stays current; two null-linked groups remain separately unknown; rejected evidence is separate. Rendered actionable0095 notice persists through selection/reload. |
| Recovery | Passed | Stopped the recorded pre process, applied exact frozen0095 only to that clone, restarted and reloaded. Notice clears. Linked rows receive origin; null-linked unknown rows remain false/null, with their original IDs and distinct row-ID keys, never attached to the selected same-wording objective. Reload/reselect passes again. |

Each phase captured loaded, selected, reloaded and reselected DOM/text/screenshots. Actual native
action responses were captured; five retained load responses independently verify one current
group and the same two distinct unknown keys. This is native application execution, not a static
render, copied filter or mocked server action.

Browser checks compare complete evidence/document/generation rows before and after each phase:
no browser mutation. Comparing pre-migration with recovered state preserves every prior evidence
field and all document metadata; only new origin fields/backfill change as expected. No generation,
answer/result, finding, insight, recommendation or trace rows were created. No excluded app/browser
network attempt was recorded.

## Authorized fixture extension and isolation

The earlier G5 blocker is retained as historical evidence. Its no-document fixture could not render
the existing component. This separately authorized run adds exactly **one metadata-only synthetic
table document in each browser clone**, with a current cached empty variable dictionary and ready
status. There is no uploaded file/object, storage service or preview table. Existing evidence keeps
automatic gathering inactive; the cached metadata avoids parser/Python/calculation requests.
No application prerequisite was patched or bypassed.

New environment **ruleb-g5-20261015**, container
`e50886e86f52bdac48af4e397af2279bce874d8c282c2ade3db6467a16277f18`, PostgreSQL17.11 bound only
127.0.0.1:55501. Actual full migration setup through0094; separate base/pre/post databases.
Post starts at0095; pre receives unchanged0095 only for the browser recovery step. No core database
or G1–G4 runner was used. Fresh nonowner NOBYPASSRLS application roles additionally used read-only
sessions and SQL logging. Setup admin alone seeded fixtures and applied DDL.

Frozen439-file archive SHA-256
`64f66e8e92c1e7a9e6c5e170b5ea22701bd17f72d8200245baf5f12ffddea310` matches the earlier Rule B
snapshot. No Claude active application source was read/modified. Production build/typecheck passed
once; the identical build ran sequentially on3111/post and3112/pre with explicit child-only database
targets. Browser/CDP9231 used a new dedicated profile. App network guard allowed only local PG/app
ports; browser allowed only the two local app ports. No model/storage service was configured.

No storage upload, external model, Python/calculation, downstream refresh, dependency install or
application edit. No existing credentials/environment files or development/live data. Frozen
application/migration bytes remained unchanged; generated runtime next-env.d.ts is the sole recorded
Next-generated delta. Deployment-role equivalence and deployment migration-process/ledger remain
separate limitations, not reopened code/integration criteria.

## Commands and retained artifacts

    node scripts/rule-b-g5/setup.cjs
    node scripts/rule-b-g5/browser.cjs
    node scripts/rule-b-g5/app.cjs post build
    node scripts/rule-b-g5/app.cjs post start
    node scripts/rule-b-g5/check-browser.cjs post
    node scripts/rule-b-g5/stop-app.cjs
    node scripts/rule-b-g5/app.cjs pre start
    node scripts/rule-b-g5/check-browser.cjs pre
    node scripts/rule-b-g5/stop-app.cjs
    # Explicit docker/psql apply of unchanged0095 to G5 pre clone; hash/output retained below.
    node scripts/rule-b-g5/app.cjs pre start
    node scripts/rule-b-g5/check-browser.cjs recovered
    node scripts/rule-b-g5/retain-cleanup.cjs

Fixture SQL was fed via explicit recorded-container psql invocations. The document fixture and
cached dictionary are retained in document-fixture.sql; browser-fixtures.sql and post additions
retain the original accepted/rejected/unknown/deleted-origin cases. Migration hash/target/output:
[G5-pre-migration-recovery.json](../scripts/rule-b-g5/runs/authorized/G5-pre-migration-recovery.json).
Commands describe completed phases, not instructions to reuse the cleaned target.

All three browser phase scripts exited0; build/typecheck exited0. The existing unpdf webpack warning
is retained. No failed acceptance assertion or new service requirement occurred in this run.

Three full synthetic DB dumps, schema/grants/owners, SQL logs on both stdout/stderr, package/source
hashes, process records, native action responses, screenshots and full rendered HTML/text were
retained before cleanup. Exact PID command lines and container ID/label/loopback binding were
verified. Owned app/browser processes, container/tmpfs and runtime/profile were removed; installed
dependency junction was unlinked without traversing its target.
[Cleanup confirmation](../scripts/rule-b-g5/runs/authorized/cleanup.json).

## Baseline decision

Existing OBJ-REV-001/002 recovered-overlap row moves **Implemented awaiting verification → Closed**
for its frozen Rule B code, targeted PostgreSQL and browser acceptance contract. Distinct historical
REV-002 definition remains unavailable; no additional requirement is inferred from its ID.
Previous blocked G5 result is superseded, not erased. G1–G4 and older REV009/REP matrices are reused,
not repeated. Results apply to this source snapshot; later changes need an affected-source comparison.

Counts: **9 Closed /19 Implemented /3 Confirmed /6 Untested /6 Blocked =43**. Priority remains
34 release /9 deferrable /0 optional. No whole Objectives, Import or public-release sign-off.
Next agreed package remains verification of Claude's three P2a repairs once handed over stable.
