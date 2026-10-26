# REP-IN-002 PostgreSQL integration and fresh replay ? 2026-10-15

## Decision

**All14 authorized PostgreSQL groups passed, then passed again from a fresh disposable setup.**
Preserve REP-IN-002 application-code closure. No integration failure demonstrated an application
defect. This closes only the agreed14-group disposable PostgreSQL scope, including actual0094
behavior; storage/browser/downstream refresh writes remain excluded.

[Machine-readable run matrix, lock evidence and hashes](../scripts/repin002-integration/execution-summary.json).
[Retained setup/runner](../scripts/repin002-integration/run-disposable.cjs).
Three NEW named disposable environments were used; none reused the live/development DB or prior
OBJ-REV-009 target. Every created environment was removed after its artifacts were retained.

## Execution and reproducibility

Commands from repository root (native execution context required for Docker pipe access):

    node scripts/repin002-integration/run-disposable.cjs a 55494
    node scripts/repin002-integration/run-disposable.cjs a2 55494
    node scripts/repin002-integration/run-disposable.cjs b 55495

Attempt a:6 passed,1 fixture failure,7 not run. The recommendation fixture omitted its required
run_id; actual PostgreSQL rejected the seed before cascade/publication assertions. It is NOT an
application defect. Corrected that fixture only, then rebuilt the full schema in a NEW container/DB.
The invalid trailing literal newline in its result artifact was normalized after preserving original
bytes as results.original-output.txt. The failure record is retained, not overwritten by green runs.

Other pre-execution test-only corrections: match legacy row by ID rather than random UUID ordering;
republication compares all protected work, allowing an untouched unprotected distinct claim to be
legitimately replaced. No acceptance assertion for protected work/support was weakened. Added
per-group status output and observed-wait capture. No application or migration content changed.

Attempt a2:14 passed,0 failed,0 blocked,0 not run, exit0.
Fresh replay b:14 passed,0 failed,0 blocked,0 not run, exit0.
No script edits between those passing runs. Current executed harness snapshots retained under
scripts/repin002-integration/executed-harness; application/migration hashes in each results.json
and summary remained unchanged before/after.

## Every group

| # | Group | Initial attempt a | Corrected fresh a2 | Fresh replay b |
|---|---|---|---|---|
| 1 | pre0094 action saves but confirmation cannot retire unknown | passed | passed | passed |
| 2 | actual0094 defaults, rerun and constraint | passed | passed | passed |
| 3 | single/bulk/edit provenance and reread protection | passed | passed | passed |
| 4 | legacy scoped confirmation rechecks protection and unlisted IDs | passed | passed | passed |
| 5 | history copies all provenance on explicit rejected regeneration | passed | passed | passed |
| 6 | provenance write failure rolls back its researcher mutation | passed | passed | passed |
| 7 | real dependency cascades and archived provenance in one publication | failed (fixture) | passed | passed |
| 8 | support union, same quote distinct claim and republication | not run | passed | passed |
| 9 | partial and archive/insert/final-union faults roll back | not run | passed | passed |
| 10 | observed competing publications: initially empty | not run | passed | passed |
| 11 | observed competing publications: existing, reversed arrival | not run | passed | passed |
| 12 | lock holder rollback releases waiting publication | not run | passed | passed |
| 13 | researcher edit commits first and protects during waiting publication | not run | passed | passed |
| 14 | publication commits first then waiting edit preserves retained ID | not run | passed | passed |

## Exact environments and artifacts

- repin002-20261015131909-c79be7-a:127.0.0.1:55494/repin002_20261015131909_c79be7_a; [setup/grants](../scripts/repin002-integration/runs/repin002-20261015131909-c79be7-a/setup.json); [results/locks](../scripts/repin002-integration/runs/repin002-20261015131909-c79be7-a/results.json). Cleanup: recorded container stopped and tmpfs removed.
- repin002-20261015131952-b1e873-a2:127.0.0.1:55494/repin002_20261015131952_b1e873_a2; [setup/grants](../scripts/repin002-integration/runs/repin002-20261015131952-b1e873-a2/setup.json); [results/locks](../scripts/repin002-integration/runs/repin002-20261015131952-b1e873-a2/results.json). Cleanup: recorded container stopped and tmpfs removed.
- repin002-20261015132014-bada77-b:127.0.0.1:55495/repin002_20261015132014_bada77_b; [setup/grants](../scripts/repin002-integration/runs/repin002-20261015132014-bada77-b/setup.json); [results/locks](../scripts/repin002-integration/runs/repin002-20261015132014-bada77-b/results.json). Cleanup: recorded container stopped and tmpfs removed.


PostgreSQL17.11, cached image public.ecr.aws/supabase/postgres:17.11.0.004; immutable image/container
IDs retained. Host port bindings were127.0.0.1 only. Each setup applied the actual full93 migrations
through0093 unchanged, with per-file SHA-256 log. The actual0094 SQL was applied and repeated by
group2. Full resulting schema dump and PostgreSQL logs are retained per run.

Application role repin002_app: LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOINHERIT, NOBYPASSRLS;
not owner of application tables. Exact table privileges and owners are in each setup.json. Admin
performed setup/DDL, synthetic tenant creation and wait observation; application operations used
the nonowner role with transaction-local tenant context. No real credentials/.env were used.

The raw migration-DDL test does not certify a deployment migration-manager ledger. Exact deployed-role
equivalence is not established. These are retained limits, not new blockers or reasons to reopen code
criteria.

## Actual lock and rollback evidence

Each passing run recorded FIVE observations: pg_stat_activity.wait_event_type='Lock' plus
pg_blocking_pids containing the known holder PID, before releasing each barrier.10 observations
across the two passing runs. They cover empty/existing publication competition, reversed arrival,
holder rollback, edit-first and publication-first-on-retained-row orderings.

This is observed PostgreSQL waiting, not inference from final counts. Barrier cases use actual
publication/action/provenance functions with explicitly controlled real-client transactions.
Ordinary cases execute actual withTenant. Native Next action transport remains outside this scope.

Actual failed constraint/provenance/archive/insert/union statements and rollback/retry passed.
Actual verdict/insight/recommendation cascades and their keyed history snapshots passed after
the fixture correction. Support union Old+A+B, distinct shared-quote claim, one retained insight,
repeat/self-reference filtering and protected-state republication passed against PostgreSQL.

## Remaining checks (not executed, not implicitly authorized)

- Storage uploads and actual browser/reload: incomplete status, error visibility, legacy prompt/
  confirmation and pre-migration recovery.
- Native confirmation's downstream refresh writes, including their fixture-only scope/isolation.
- Companion dashboard action and coding/brand/CSM automatic-theme guards on real SQL fixtures,
  which are outside the prepared14-group core matrix (their code-level wiring remains verified).
- Deployment-role equivalence and deployment migration-runner ledger/process.

No app, shared configuration, dependencies or migration files were modified. No storage uploads,
browser submissions, external model calls or downstream refresh writes occurred. Independent
OBJ-REV-009/DEC-001/OBJ-REV-011/Brief38/IMP004/M02 closures preserved. Existing native tests were
not rerun unnecessarily: pinned application sources did not change.

## Baseline

The broad IMP-006/REP-IN-001/REP-IN-002 row remains implemented awaiting the remaining integration/
browser acceptance, now with both code-level closure and agreed PostgreSQL scope/replay completed.
No full Import/module/public-release sign-off. Counts remain7 Closed /22 Implemented /2 Confirmed /
6 Untested /6 Blocked=43, priority34/9/0 unchanged.
