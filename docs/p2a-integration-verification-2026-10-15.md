# P2a parser/provenance disposable integration — 2026-10-15

## Decision

**5 gates passed /4 failed /0 blocked /0 not run. Further bounded repair is required.**
No application code was changed. Retain every passing parser fixture and integration subcase.
Do not reopen REP-IN-002, OBJ-REV-009, DEC-001, Brief38 or other closed packages.

[Machine-readable summary](../scripts/p2a-integration/execution-summary.json) ·
[Frozen scope](p2a-integration-execution-scope-2026-10-15.md) ·
[Source comparison](../scripts/p2a-integration/final-preparation/sources.json).

The three confirmed behaviors below are within the existing sheet/provenance and correction
acceptance criteria. They introduce no issue IDs or new capability. These are not conclusions
drawn merely from missing tests.

## Three demonstrated failures and smallest closing work

| Existing identity | Concrete evidence and consequence | Bounded repair / closing test |
|---|---|---|
| IMP-002 / IMP-SHIP-001: raw preview authority | Real getDocumentPreviewUrl reads a null committed selection while another PostgreSQL client holds a valid Sparse publication. Preview returns Dense/40; after the holder commits, the actual dictionary returns Sparse/1. A researcher can see a different dataset from the analytical reader. Captured in core-state-h.json.preview-race.json and the failing actual-function test. | The raw preview path must confirm the authoritative selection before returning and reparse a losing proposal. Propagate persistence failure; do not return an unconfirmed table. Close with the same two-client fixture: preview/dictionary use the winner and agree on rows; faulted confirmation yields recovery, no misleading preview. |
| IMP-002 / IMP-SHIP-001: cached Import preview | Native browser reload with selected_sheet=Removed and cached Dense preview/dictionary still shows Table1:40 rows, including001, without the missing-sheet recovery notice. DB and rendered panel captured together in G6-cached-preview-disagreement.json/.png. The uncached preview and calculation correctly refuse Removed. | Validate the cached preview's source identity, or visibly qualify/block that preview when current selection cannot be verified. Do not replace it silently with another dataset. Close the cached-path test while preserving passing uncached/workspace refusal and re-upload recovery. |
| IMP-005 correction reload; preserve IMP-003 targeting passes | Actual browser saves Q1 (2) as continuous; documents.variable_overrides contains that exact key/value. Reload/reselect displays discrete for that variable. Actual saved calculation correctly treats it as numeric, average1.5, while Q1/Q1 (3) remain50%. Researcher-visible classification disagrees with effective saved calculation state. Captured in G8-visible-reload-disagreement.json/.png and browser-native-calculation.json. | Hydrate the picker from saved, document-scoped overrides when its data arrives/changes, preserving current edits. Close with native save -> reload/reselect -> continuous visible, siblings unchanged; actual clear/save calculation behavior remains correct. Do not rebuild already-passing canonicalization or engines. |

Source inspection supporting these reproductions: the raw-document preview branch parses without
resolveAuthoritativeSheet; the saved-table preview branch returns stored rows without checking
current sheet identity. ImportVariablesPanel initializes override state once, so later document/
table props do not necessarily hydrate that state. These are repair directions, not an application
patch or a claim that one implementation technique is mandatory.

## Nine-gate matrix

| Gate | Result | Passing evidence and exact remaining failure |
|---|---|---|
| G1 CSV pipeline | Passed | Actual extraction/preview, Python dictionary/calculation, canonical values, leading-zero001,40 cases and20/40=50% distributions; saved calculation/reload agree. |
| G2 Sparse/Dense workbook | Passed | Both actual readers use Dense/40 for ordinary publication; all canonical columns retain independent values; saved selected-sheet provenance/reload agree. |
| G3 competing publication/caller adoption | Failed | Actual dictionary caller observed waiting on a known blocker, reparsed Sparse/1, cached it, and subsequent preview used Sparse. Engine correctly refused one-category Sparse rather than using Dense. Separate actual raw-preview race returns Dense/40 against the Sparse/1 authoritative winner. |
| G4 selection SQL failure | Passed | Real PostgreSQL read-only UPDATE fails; no selection is falsely confirmed. Actual caller fault tests additionally preserve cache/table state. |
| G5 unsupported IDs | Passed | Actual TypeScript extraction blanks AccountID and traces recovery; actual Python dictionary flags it and calculation refuses its unusable values. Native preview shows blank AccountID with0007/0008 retained. Named source-format/re-upload warning persists after reload. |
| G6 missing selected sheet | Failed | Uncached preview refuses Removed. Native calculation workspace displays the missing-sheet error. Existing saved tables are not replaced, and supported re-upload yields a new Dense/40 document. Cached Import preview nevertheless keeps showing40 rows with no missing-sheet recovery notice. |
| G7 native upload boundary | Passed | Browser raw-data picker uploads CSV/XLSX to real storage. Actual preview/metadata and native calculations persist/reload. Workspace shows40 cases and Dense for XLSX; CSV's persisted synthetic Sheet1 provenance agrees with saved state. No direct fixture INSERT is counted as browser upload. |
| G8 canonical correction | Failed | Actual save/clear actions persist only Q1 (2), and saved override snapshot/provenance plus numeric average1.5 are correct; siblings remain20/40=50%. Browser save persists continuous, but reloaded picker displays discrete. |
| G9 caller failure/cache/pre0093 | Failed | Faulted dictionary/workspace selection publication fails visibly, saves no new analytical table and leaves the old unconfirmed cache unchanged; restoration/retry confirms Dense. Actual pre0093 dictionary caller fails without cache/table writes. Raw preview still displays40 rows while selected_sheet is null and publication is faulted: the same preview-authority root as G3, not another issue. |

Five gates pass; four fail because of the three behaviors above. Failed gates retain their passing
subcases. The same preview root is not counted as separate defects merely because G3/G9 both expose it.

## Exact execution and test counts

The original6 prepared cases plus3 previously missing adapters were wired into isolated test files.
Four additional focused tests cover existing gate details: actual losing caller, pre0093, raw-preview
race and real Python unsupported/cache behavior. No acceptance capability was added.

Across the latest outcome for each of13 distinct actual-function tests: **12 passed /1 failed**.
This is not a claim that all13 ran green together. Exact attempt reports/commands are retained:

| Attempt | Executed pass | Executed fail | Filtered skip | Disposition |
|---|---:|---:|---:|---|
| a |8|1|0|Initial9 cases; upload reached Next revalidatePath without framework context. |
| b |0|0|9|Unsuccessful runner/suite attempt with no executed assertion; JSON retained, no pass inferred. |
| c |0|1|8|Upload fixture lacked a MIME type; real storage rejected Invalid Content-Type. |
| d |0|1|8|Fixture incorrectly demanded null CSV selected-sheet provenance; actual persisted value is Sheet1. |
| e |1|0|8|Only affected upload case rerun: actual CSV/XLSX upload/read/calculate/reload passes. |
| f |1|1|9|Pre0093 passes; losing caller adopted Sparse, but test incorrectly expected a valid crosstab from its single answer category. |
| g |1|0|10|Only affected race case rerun: correct Sparse preview/cache and explicit engine refusal pass. |
| h |1|1|11|Python unsupported/cache case passes; actual raw-preview Dense/Sparse disagreement fails. |

Filtered skips mean intentionally un-repeated tests, not passing checks or unexecuted gates.
Cumulative test-body executions:17, comprising12 passes and5 failures (including the retained
fixture/framework failures). Browser probes are reported by gate and artifacts, not added to a
Vitest total. None of the earlier20 parser tests or completed REP tests was repeated.

Commands, from repository root with native Docker/process access where required:

    node scripts/p2a-integration/final-preparation/setup.cjs
    node scripts/p2a-integration/final-preparation/storage.cjs
    node scripts/p2a-integration/final-preparation/storage-grants.cjs
    node scripts/p2a-integration/final-preparation/proxy.cjs
    node scripts/p2a-integration/final-preparation/run-tests.cjs a
    node scripts/p2a-integration/final-preparation/run-tests.cjs b 'native upload action'
    node scripts/p2a-integration/final-preparation/run-tests.cjs c 'native upload action'
    node scripts/p2a-integration/final-preparation/run-tests.cjs d 'native upload action'
    node scripts/p2a-integration/final-preparation/run-tests.cjs e 'native upload action'
    node scripts/p2a-integration/final-preparation/run-tests.cjs f 'actual losing dictionary|pre0093 actual'
    node scripts/p2a-integration/final-preparation/run-tests.cjs g 'actual losing dictionary'
    node scripts/p2a-integration/final-preparation/run-tests.cjs h 'actual raw preview must|unsupported actual Python'
    node scripts/p2a-integration/final-preparation/browser-seed.mjs
    node scripts/p2a-integration/final-preparation/app.cjs build
    node scripts/p2a-integration/final-preparation/app.cjs start
    node scripts/p2a-integration/final-preparation/browser.cjs
    node scripts/p2a-integration/final-preparation/browser-upload.cjs
    node scripts/p2a-integration/final-preparation/browser-correction.cjs
    node scripts/p2a-integration/final-preparation/browser-calculate.cjs
    node scripts/p2a-integration/final-preparation/browser-recovery.cjs
    node scripts/p2a-integration/final-preparation/browser-tail.cjs
    node scripts/p2a-integration/final-preparation/browser-failure.cjs
    node scripts/p2a-integration/final-preparation/retain-cleanup.cjs

These are recorded phases, not a command to reuse a cleaned environment. Native UI navigation/
preview opening and final CSV reload were also executed through retained CDP tooling via node
stdin; screenshots/text and database captures are retained. Initial short timing assertions were
checked against eventual persisted/rendered state: save completed, but the picker discrepancy
remained. Browser summary-vs-button selector and offline optional-isBase handling were test-helper
corrections; no application assertion was weakened.

## Frozen environment and limits

Environment p2a-20261015-parser was NEW: PostgreSQL17.11 on127.0.0.1:55498; actual92 migrations in
base/pre0093 and actual0093/0094 in main; separate storage database. No0095 or active Rule B changes.
Nonowner application roles were NOSUPERUSER/NOBYPASSRLS, with DML restricted to tenants/runs,
documents/document_tables/trace. Source archive SHA-256 remains
67193e621f47589311483ccd1cd795c7aa5ba0785fd7eac21ca471ab80f2b883; pinned Python companions match.
Only generated next-env.d.ts changed inside the extracted runtime. Production build/typecheck
exited0; its existing unpdf webpack warning is retained.

Local storage1.79.28 used two private new buckets and its own service-role privileges. Core tests
use the disclosed p2a bucket adapter; the native app uses documents through transparent prefix
routing. Chrome ran a separate profile on9228; app3108/storage55008/router55009 were loopback-only.
Real Python dependencies were already installed; version inventory retained. Local persistent
worker executed; one-shot fallback was not independently forced. No external parser/model,
dependency installation, application patch, existing credentials or client data was used.

Separate PostgreSQL clients plus observed waiter PID/blocker PID prove the dictionary race waited;
that is not inferred from final counts. The deliberately competing valid Sparse proposal is a
fixture, not a claim that the now-consistent reader-selection algorithms naturally disagree.
The raw-preview counterexample shows that the actual consumer does not enforce publication.

Deployment-role/gateway/migration-runner equivalence remain separate. This does not certify other
native formats, columns-as-cases, resource limits, full Import, remote transport or broader reporting.
Actual clear-override action passes; a separate native clear-control interaction was not executed.

## Cleanup, baseline and next package

Before cleanup retained full synthetic dumps for4 databases, owners/grants, exact object paths/files,
source/test hashes, native screenshots/text, worker versions, JSON test reports and both PostgreSQL
stdout/stderr. No repetition to conceal earlier log gaps. Verified exact container IDs/labels and
process command lines. Removed only the recorded containers/volume, local keys and extracted
runtime/profile; stopped router/browser launcher. No matching Docker resources or Python workers
remained. No REP or development resources were touched.

Baseline IMP-002 and IMP-005 move Implemented awaiting verification -> Confirmed defect, with
passing subcases preserved. IMP-003 retains verified canonical-target/persistence/calculation
subcases; its correction-UI dependency is tracked under IMP-005, not double-counted as another root.
Totals: **8 Closed /19 Implemented /4 Confirmed /6 Untested /6 Blocked =43**, priorities34/9/0.

Next single P2a repair package: preview publication/reparse, cached-preview identity recovery, and
saved override picker hydration, under those same IDs and acceptance tests. No parser/engine rewrite
or optional refactoring. Claude's active Rule B work remains separate; do not inspect or change it.
No repair implementation or new migration is authorized by this verification report itself.
