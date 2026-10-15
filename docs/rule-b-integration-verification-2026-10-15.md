# Rule B authorized disposable integration — 2026-10-15

**4 passed /0 failed /1 blocked /0 not run.** No application defect demonstrated. Preserve the
agreed Rule B code closure and all previous closures, including OBJ-REV-009's completed matrix/replay.
The four targeted PostgreSQL gates close at the recorded disposable evidence level; the visible
browser gate remains open. No full Objectives sign-off or deployment certification is claimed.

[Five-group matrix](../scripts/rule-b-integration/execution-summary.json) ·
[Core SQL/session results](../scripts/rule-b-integration/runs/authorized/core-results.json) ·
[Setup, migration hashes, roles and owners](../scripts/rule-b-integration/runs/authorized/setup.json) ·
[Frozen scope](../scripts/rule-b-integration/README.md).

## Group dispositions

| Group | Result | Executed evidence / precise remaining boundary |
|---|---|---|
| G1 0095 transition | Passed | Actual full schema through0094; actual unchanged0095 backfills each linked kind correctly; null-linked historical and omitted-origin rows remain false/null; second application preserves row values; false/non-null constraint fails under real PostgreSQL and rolls back. |
| G2 candidate deletion / origin | Passed | Actual objective and decision deletes null FK links but retain original origin UUIDs. Actual loader and shared identity/rollup keep these rows orphaned despite identical current free text. Unknown groups retain distinct row-ID keys. |
| G3 changed INSERT / rollback / retry | Passed | Actual withTenant and publishGeneratedQuestions. A fixture-run-scoped INSERT trigger fails after availability check and publication writes begin. Full prior live questions/generation state is restored. Trigger removed; retry publishes one current generation and preserves manual, edited and excluded work. |
| G4 added membership snapshot | Passed | Reader PID956 and writer PID957 are distinct actual PostgreSQL sessions. Paused actual load after coverage; writer committed candidate deletion, run-text changes and actual publication. Resumed load equals the complete earlier result; a fresh load sees new membership/questions/coverage. Recorded query order starts REPEATABLE READ and ends commit. No fake snapshot and no inferred lock-wait claim. |
| G5 native browser/reload | Blocked, partial execution retained | Production build/typecheck succeeds. Actual browser navigation/reload reaches Review objectives. Native load returns one current group and four correctly separated orphan groups with originAvailable=true. However actual component returns null when dataFiles.length===0, so visible orphan/selection/migration-notice assertions cannot execute with authorized no-document fixtures. Pre0095 rendered notice and post-migration UI recovery were not run. |

The preparation incorrectly assumed the evidence panel would render with no datasets. Frozen
ObjectiveEvidence.tsx explicitly returns null for that state. The authorized inventory said no
documents/datasets, so no document row or storage object was added to get a passing UI result.
This is a fixture/scope blocker, not a reproduced product failure. Actual native post0095 response
is retained in [G5-native-load.json](../scripts/rule-b-integration/runs/authorized/G5-native-load.json);
the missing-panel DOM/text and screenshot are retained separately. Native response correctness
does not close visible UI acceptance. No browser pre-recovery pass is inferred.

## Version and exact execution

Frozen439-file archive SHA-256
`64f66e8e92c1e7a9e6c5e170b5ea22701bd17f72d8200245baf5f12ffddea310`.
No mutable Claude source was loaded. Archive/application/migration bytes match. Only Next-generated
runtime next-env.d.ts changed; [before/after hashes](../scripts/rule-b-integration/runs/authorized/source-after.json)
record that exception. Original checkout/application files were not modified.

Commands from repository root, with native Docker/browser access and child-only explicit target
variables from the frozen scope:

    node scripts/rule-b-integration/setup.cjs
    node scripts/rule-b-integration/core.mjs
    node scripts/rule-b-integration/browser.cjs
    node scripts/rule-b-integration/app.cjs post build
    node scripts/rule-b-integration/app.cjs post start
    node scripts/rule-b-integration/retain-cleanup.cjs

Browser SQL seed files were fed via docker exec/psql to the exact pre/post databases. The existing
CDP technique was adapted to9230 and3109/3110 only. Native navigation, setting the objectives section,
reload, response capture and screenshot were executed through Node stdin; no generation/evaluation,
edit, downstream refresh or storage submission was made. No native/unit/full REV009 matrix was rerun.

## Isolation and retained resources

Environment ruleb-20261015-origin; new container
`86034a2fc735da0375046ec02af17bd211125bc62e5d342c87b94691f6ee0bd8`, binding127.0.0.1:55500 only.
Cached Supabase PostgreSQL17.11 image, tmpfs, actual unchanged migration chain through0094 in base;
core applied0095 twice and post applied0095 once. Pre remains through0094 because its visible
recovery check was blocked. No live/development databases or existing credentials were used.

Fresh nonowner app roles are NOSUPERUSER/NOBYPASSRLS with the documented limited DML. Schema,
owners/grants, package versions/hashes and immutable container/image metadata are retained.
Ordinary publication/loads execute actual wrappers with tenant context; snapshot interception
pauses a real client query, without replacing application read/publication algorithms.

Four full synthetic DB dumps, schema SQL, grants, core results, source hashes, native responses,
browser DOM/screenshot and PostgreSQL stdout AND stderr were retained before cleanup. Exact
recorded process command lines and container ID/label/bindings were checked before stopping.
Removed only owned app/browser processes, container/tmpfs and recorded runtime/profile; dependency
junction was unlinked before recursive removal, leaving installed dependencies intact.
[Cleanup confirmation](../scripts/rule-b-integration/runs/authorized/cleanup.json).

No storage service/uploads, Python, model/external calls, downstream writes, application patches,
dependency installs or P2a resources. Build's existing unpdf webpack warning remains in logs.
Deployment-role equivalence and deployment migration-runner/ledger stay separately unverified.

## Remaining action and baseline

Only G5 remains: visible current/orphan/unknown and selection/reload, pre0095 notice, apply0095 to
that browser clone and verify rendered recovery without reattaching unknown rows. Prepare/authorize
the minimum additional synthetic table-document fixture prerequisite before retrying it. Existing
evidence must prevent automatic gathering; any storage/model/engine demand remains a stopping
condition unless separately authorized. Do not patch the component to display a test-only panel.

Do not rerun G1–G4 or the full REV009 matrix merely to finish G5. Fresh browser-only schema setup
may be needed after cleanup; it is setup, not a repeated claim of test coverage.

Broad OBJ-REV-001/002 row remains Implemented awaiting verification with stronger integration
closure. Counts unchanged: **8 Closed /20 Implemented /3 Confirmed /6 Untested /6 Blocked =43**;
priority34/9/0. The blocked G5 subcase does not invent a new defect or change an entire row to Blocked.
REP-IN-002, DEC-001, Brief38, OBJ-REV-011, IMP004/M02 and all other passing subcases stay preserved.
