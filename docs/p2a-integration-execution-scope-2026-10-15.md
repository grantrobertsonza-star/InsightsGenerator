# P2a parser/provenance integration — next bounded package

Prepared only; **no P2a database/storage/browser write authorization or execution is claimed**.
REP-IN-002's12 final groups, two14-group PostgreSQL runs and agreed code closure remain complete.
The baseline already records that row Closed (E19); deployment-role/process and security limits
remain separate. No completed REP check is reopened.

## Contract and frozen source

Existing IMP-SHIP-001/002 and IMP-003 parser cases, cross-referenced to the documented recovered
IMP-002 definition. No new issue IDs, capabilities or reporting/AI package. Preserve the passing20
parser fixtures,5 preview/recovery checks and2 actual Python fixture pipelines. No repeat of them
unless changed relevant bytes or an integration failure warrants it.

Use the existing immutable435-file REP source archive as APPLICATION INPUT only, without changing
that archive or rerunning REP tests. It provides the complete native application through0094,
before Claude's active Rule B changes. Add the separately retained Python local/worker companion
archive: [source manifest](../scripts/p2a-integration/final-preparation/sources.json).
All28 prior P2a files are accounted for:25 match; only extractFindings.ts, findingArchive.ts and
page.tsx differ, attributable to the completed REP repairs. No parser-core drift is demonstrated.
The real native upload/preview consumer integration will exercise relevant changed wiring; it does
not require repeating report extraction/preservation.

Do not inspect/copy Claude's actively changing Rule B implementation, include0095, or load the
mutable checkout during execution. The original checkout stays released. Freeze these archives,
the P2a acceptance contract and final test adapters; record hashes before/after execution. Adapter
changes are isolated test files, never application patches/configuration/dependencies.

## Proposed exact disposable resources

These resources are NOT created. Stop if names/ports exist; never reuse their occupants.

| Resource | Proposed scope |
|---|---|
| Environment marker | p2a-20261015-parser; synthetic_only=true |
| PostgreSQL | NEW p2a-20261015-parser-pg container, cached PostgreSQL17.11 image; host127.0.0.1:55498 only |
| Databases | p2a_20261015_base through0092; p2a_20261015_pre0093 clone for missing-selected-sheet-column callers; p2a_20261015_main clone with actual0093/0094; p2a_20261015_storage for local storage metadata |
| Roles | Fresh nonowner NOSUPERUSER/NOBYPASSRLS application logins per app clone, setup admin only for DDL/fixtures/observer; record grants/owners |
| Storage | NEW p2a-20261015-parser-storage container, cached storage1.79.28;127.0.0.1:55008, own database/volume/keys |
| Buckets | Private p2a-20261015-parser for retained guarded harness; private documents for the unchanged native app, both NEW in this service |
| Prefix routing | Loopback55009 test adapter strips /storage/v1 and forwards to the actual55008 service; no fake object storage |
| App/browser | Snapshot production app127.0.0.1:3108; installed Chrome/Edge with dedicated profile/DevTools127.0.0.1:9228 |
| Python | Existing installed dependencies only; actual local worker and one-shot runner with explicit disposable temp/cache/spool directories; no external parser endpoint |
| Runtime/results | New verified temporary extraction/profile/fixture directories; scripts/p2a-integration/runs/<recorded-id> evidence; no .env copying |

Use actual unchanged migrations; do not replace application tables with a minimal schema, skip
migrations in the main database, or relax constraints for fixtures. The pre0093 clone intentionally
stops at0092 and is used only for the missing-migration case. No0095 application/migration dependency.
Storage may bootstrap its own schema/service roles using its actual migrations and required local
service privileges, separate from the app roles. Named containers may communicate on Docker's
private local network; published ports bind loopback only. No live/development service reuse.

The existing guard expects a p2a-* bucket. Retain that guard and disclose the core SDK bucket
adapter. Native browser uploads use the unchanged documents bucket directly through the local
prefix router; they do not count as guarded-bucket adapter coverage or vice versa.

## Exact write inventory to authorize

1. Create the named NEW containers, databases, roles/grants, marker, local storage volume/buckets/
   keys and isolated runtime/profile directories. Apply actual supported migrations through0094
   to main, through0092 to pre0093. Record exact scripts, hashes, versions and ownership.
2. Synthetic tenant/run and document fixtures only. Application DML allowlist:
   - tenants/runs: setup fixture creation and exact fixture cleanup; no business-context mutation
     or downstream framing/generation actions.
   - documents: actual upload inserts, selected_sheet publication, variable_dictionary cache,
     variable_overrides correction save/clear, data_setup fixture/explicit supported setup save,
     ingestion/status fields used by the upload/read path, exact fixture cleanup.
   - document_tables: persisted extracted preview rows, calculated crosstab/provenance/override/
     design snapshots and captured fixture cleanup, through actual extraction/build functions.
   - trace: actual parser/unsupported-ID/upload/error/cleanup events for those synthetic runs.
   No findings, history, verdict, insight, objective, decision, recommendation or narrative writes.
3. Original synthetic CSV/XLSX objects only, in the two NEW private buckets, using recorded exact
   tenant/run/document/timestamp keys. Captured keys may be deleted for cleanup/re-upload recovery.
   CSV/XLSX previews are DB rows; no report/PDF conversion, remote result object, client upload or
   external signed-download target is required. If actual execution requires another object type,
   stop that affected check and identify it before widening scope.
4. Fixture-only selected_sheet UPDATEs to set Removed or arrange competing valid initial proposals.
   Temporary UUID-scoped p2a_parser_* triggers/functions or a dedicated disposable fault role may
   deny selection publication, exercising actual caller failure before table/cache save. Record
   fault SQL and restore/drop it. Do not alter application functions or a live role/schema.
5. Native browser upload/preview, supported correction save/clear, calculation and reload submissions;
   dedicated browser/session state, generated build/cache and screenshot/network/SQL evidence.
   Use rawTableFiles for these raw-case fixtures. Do not click Process run/AI Generate findings or
   processTableDocument (which calls AI findings); parser extraction is extractAndStoreDocumentTables.
6. Actual Python local transport writes its own input/output/spool/cache files only in captured
   disposable paths. Record/stop only its own worker processes. No package installation, external
   parser, external model or client data. Unexpected model calls fail closed, not simulated success.
7. Retain results, SQL state/dumps, grants, observed blockers, screenshots, stderr/stdout and hashes
   BEFORE deleting only recorded owned container IDs/volume, fixture object keys and validated
   runtime/profile/temp directories. No global prune/truncate or unspecified connection.

Use explicit child environments; clear ambient remote parser and deployment endpoints. No existing
credentials/environment files. Build may use public Google font assets if uncached, with no synthetic
research payload/keys; no other external network target. Stop affected work if another service,
write, dependency install or endpoint becomes necessary. Deployment-role/gateway/process equivalence
is not implied by this package.

## Finite integration matrix

The retained suite has6 prepared executable cases and3 skipped adapters, **none integration-run**.
Wire the3 gaps in isolated test files before claiming their gates pass; do not relabel skips.
Browser assertions below are parts of these same gates, not new release requirements.

| Group | Existing acceptance and observable pass condition |
|---|---|
| G1 CSV pipeline | Actual TypeScript preview/extraction and Python dictionary/calculation agree on canonical headers/values, leading-zero IDs,40 rows, known unweighted20/40=50% distributions; saved calculation/provenance and reload agree. Seeded upload is infrastructure only. |
| G2 Sparse/Dense XLSX pipeline | Actual nonblank-row selection is Dense, with matching rows/headers/values and saved/reloaded selectedSheet. Preserve retained tie/missing-token fixture expectations; do not expand formats. |
| G3 competing publication/caller adoption | Separate PostgreSQL clients propose different valid sheets with synchronization barriers. Observe the specific waiting PID and pg_blocking_pids holder before release. The losing ACTUAL preview/dictionary/calculation caller reparses the persisted winner before returning/caching/saving. A helper race alone cannot close caller behavior. |
| G4 selection SQL failure | Real failed selection UPDATE leaves no falsely confirmed selection. Record actual PostgreSQL failure and rollback/state; this alone does not close G9. |
| G5 unsupported IDs | Actual readers return consistent blanked unsupported AccountID values while supported RespondentID0007/0008 remain; preview/extraction/calculation cannot silently use the unsupported formatted identifier. Named warning/source-format/re-upload recovery persists in the actual UI after reload. No new join feature is required. |
| G6 missing selected sheet | Selected Removed produces actionable preview/calculation recovery and no substituted dataset, including saved-preview/cache paths. Recover with an existing supported re-upload path, without inventing a sheet-picker feature. |
| G7 native upload boundary | Actual file picker/upload action for CSV and XLSX, real storage and later preview/dictionary/calculation/reload. Verify saved authoritative sheet and values; direct document INSERT is never upload coverage. Browser provenance evidence must reflect the existing actual UI; DB provenance alone does not prove a visible display. |
| G8 canonical correction | Actual saveVariableOverrideAction corrects only Q1 (2); reload and actual calculation request/provenance preserve Q1/Q1 (3) identities. Clear through the same real action and reload. Direct JSON fixture updates do not count as correction-action coverage. |
| G9 caller failure/pre0093 | Actual selected-sheet persistence failure stops return/save/cache of unconfirmed analytical data, visibly; restore and retry. Missing0093 through actual caller is actionable, not a silent alternative dataset. Test confirmed dictionary-cache reuse versus unconfirmed cache rejection. |

Retain the synthetic fixture names/expected headers from fixtures.mjs; compare underlying raw
values, not just labels/counts. For G3, a deliberately forced valid competing proposal is a race
fixture, not a claim that the now-consistent readers naturally choose different sheets. Do not
mock reparsing or replace the calculation engine under evaluation. Observe real lock waits;
final row counts or elapsed time alone prove no blocking.

Remote deployment transport remains separately qualified; no external service invocation is in
this local scope. Actual local persistent-worker/cache paths must be captured. Any unexecuted
one-shot fallback branch remains explicitly unexecuted, not silently included as a pass.

## Preparation status and execution order

No group has passed integration yet. Retained no-write safety/collection results remain historical,
not execution of this matrix. The existing harness also controls DB wrappers and uses bucket/model
boundary adapters; disclose those limits. Prefer the actual withTenant wrapper for new real-client
adapters, without modifying shared db.ts. Browser exercises the native wrapper normally.

After separate authorization: validate archives/dependencies/guards; finish isolated skipped adapters;
provision fresh resources; run core real-SQL/reader cases and race/fault cases; run native browser
upload/correction/recovery; retain all evidence; cleanup exact owned resources. Record every group
passed/failed/blocked/not run and exact test counts. Stop only affected checks on unexpected scope,
continue independent authorized checks, and preserve failures before fixture corrections.

The prior cleanup adapter lost standalone PostgreSQL stderr. For P2a capture BOTH stdout and stderr
before resource removal. Reusing setup technique does not mean reusing mutable REP containers,
fixtures, logs, keys or namespaces; those were cleaned up. No REP rerun is needed.

Baseline remains8 Closed /21 Implemented /2 Confirmed /6 Untested /6 Blocked=43, priorities34/9/0.
Only passing P2a gates may later update the existing parser rows, at their actual evidence level.
Do not claim whole Import closure from these parser gates.
