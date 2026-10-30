# Batch SEC1 handover: tenant ownership checked by the code, 29 October 2026

Status: implemented, ready for independent review. Code commit f1277c9 on branch `sec1` (base 48b9435). Docs in the
commit that adds this file. Tier A (tenancy, persistence, exports). Nothing pushed, deployed or written to Supabase.

## Why

Isolation rested on row-level security policies keyed on `app.current_tenant_id`. `docs/database-roles.md` records
that the app connects as `postgres`, which bypasses those policies, so wherever code did not name the tenant itself,
a member of organisation A could read or change organisation B's rows by sending B's ids. Each audit claim below was
checked against the code before it was changed; where the audit was wrong, that is said.

## Rule and owner

New registry row "Tenant ownership on every read and write" (`claude/rules-registry.md`). Owner:
`src/lib/runOwnership.ts`:

- `runOwned(client, tenantId, runId, { lock?, excludeBin? })`: true when the run exists and is the tenant's. A
  malformed id is "not found", never a database error. `lock` takes the row `for update`.
- `assertRunOwned(...)`: throws `RunNotFoundError` ("That project is not available.", the wording the existing
  `lockRunForContextChange` already showed).
- `assertProgramOwned(client, tenantId, programId)`: throws `ProgramNotFoundError` ("That program is not available.").

Reused, not duplicated: `runSync.lockRunForContextChange` now calls `assertRunOwned(..., { lock: true })`, and
`requestContext.runBelongsToTenant` (used by route handlers) now calls `runOwned` through `withTenantRead`. Existing
inline copies of the same check with their own lock mode or message were left as they were and are listed as mirrors
in the registry: `drivers.ts lockOwnedRun`, `researchQualityRepository.ts`, `analysisPlan.ts`, `objectiveEvidence.ts`,
`runActions.ts`, `documentUpload.ts` (locked insert).

A run's or program's tenant is never changed by any code path (checked: no statement updates `runs.tenant_id` or
`programs.tenant_id`), so a check made earlier in a request stays true for its later writes.

## Findings and what changed

### S1-1 reads with no tenant filter (confirmed)

- `src/app/page.tsx` project list and its finding counts: moved to `projectReads.loadProjectList`, both statements
  name `tenant_id`. The counts query previously grouped every tenant's findings.
- `src/app/api/runs/route.ts` GET: `where tenant_id = $1`.
- `src/app/programs/page.tsx`: programs and their linked projects moved to `projectReads.loadProgramsWithWaves`,
  both filtered by tenant.
- `src/app/runs/[id]/page.tsx`: `getRun`, `getPrograms` and `getProgramWaves` now call `projectReads.loadRunHeader`,
  `loadProgramOptions`, `loadProgramWaves`, all filtered by tenant. Another tenant's project gives a null header, so the
  page answers not found as for a missing project. `refreshObjectiveValidation`'s run read also names the tenant.
- All 17 route handlers under `src/app/api/runs/[id]/**` that did not check (every export route plus
  `research-quality/export`) now call `runBelongsToTenant` first and answer 404 "Project not found" before reading
  anything; their own `from runs where id = $1` lookups also name `tenant_id`. `coding-progress` and
  `process-progress` already checked.
- The pages were moved into `src/lib/projectReads.ts` (SQL otherwise unchanged) so the database test can call the same
  reads the pages make; page files cannot export extra functions.

### S1-2 writes with no ownership check (confirmed, with corrections)

- `findingActions.ts` `setFindingStatus`, `setManyFindingStatuses`, `editField` (theme, kind, note): `and tenant_id`
  on the update; 0 rows gives the existing "no longer in this project" refusal.
- `updateProgramLinkAction` (confirmed: the form's `programId` was never checked, and unlink/link updated by run id
  alone): moved to `src/lib/programActions.ts`. Run (locked) and program are checked in the one transaction that
  writes, the update names the tenant, and a new program is created in the same transaction as the link, so a refused
  link leaves no orphan program. Another tenant's run or program throws "not available"; nothing is written.
- `waveTrackingActions.ts` (all six add/remove actions), `npsActions.ts`, `chartActions.ts`, `csmActions.ts`,
  `brandHealthActions.ts`, `scatterActions.ts`: `assertRunOwned` first inside the writing transaction; the caught
  error returns `{ ok: false, error: "That project is not available." }`. Scatter's id-only updates also name `run_id`.
- `runContextActions.ts` `saveRunContext` and `editStatedObjective`: the locked run read now names the tenant, so B's
  project is "This project was not found." and nothing is written.
- `recommendationActions.ts` accept, reject, restore, delete and `synthesizedInsightActions.ts` accept, reject: the
  statements name the tenant. These actions return nothing; another tenant's row is now an unchanged no-op, the same
  as a row that no longer exists (they did not report "not found" before either).
- Audit correction: `objectiveCandidateActions.ts` and `decisionCandidateActions.ts` were already protected
  (`lockRunForContextChange` or an owned-run lock first). Two accept updates there addressed the candidate by id alone
  after a run-scoped read; they now also name `run_id`.

### Found while doing this (not in the audit)

- `saveCsmModuleAction` and `saveBrandHealthModuleAction` upsert `on conflict (document_id) do update`. Given another
  tenant's document id, A overwrote B's saved mapping even with A's own project id. The file is now checked as this
  project's and tenant's first, and the upsert only updates a row of the same tenant and project. The load actions'
  reads name the tenant too. Proven by the database test (before: `{ ok: true }` and B's mapping replaced).

### S2-1 inserts referencing another tenant's run or program (confirmed)

- Every insert an entry point makes with a `run_id` now follows a run ownership check in the same function, or is a
  trace insert guarded in the statement: `insert into trace ... select ... where exists (select 1 from runs where
  id = $2 and tenant_id = $1)` (25 trace inserts in action modules and `runs/[id]/page.tsx`). A guarded trace row for
  another tenant's project is simply not written; these are diagnostic records written on error paths.
- `program_id` is only set after `assertProgramOwned` or from a program created in the same transaction.

### S3 (partly done)

- Done: `documentUpload.storeUploadedDocument` checks run ownership before the duplicate-upload probe, and the probe
  names the tenant. Before, uploading B's file bytes to B's project id told A the name of B's existing file.
- Not done: `import "server-only"`. The `server-only` package is not installed (only Next's internal compiled copy),
  there is no Vitest config to alias it, and about 196 test files import these modules directly. Adding it needs a
  dependency change and a Vitest alias; left for a separate change.

## Impact checklist

1. Rule: new row above; owner `runOwnership.ts`, existing helpers reused.
2. Inputs: another tenant's id, a missing id and a malformed id all read as not found. No input became a silent
   default; refusals are the existing "not found" or "not available" wording.
3. Persistence: each check runs inside the transaction that writes (or is the statement's own predicate). Locks:
   unchanged where they existed; `updateProgramLinkAction` now locks the run row. Retries: unchanged.
4. Freshness: none. No research result, wording or decision changes meaning; only cross-tenant access is refused.
5. Screens: a refused program link now throws "That program is not available." (or project) to the form's error
   boundary; before it silently linked. No other screen behaviour changed for the signed-in tenant's own data.
6. Proof: below.

## Proof

Tests added:

- `src/lib/__tests__/tenantOwnershipCoverage.test.ts` (source scan, TypeScript parser). Scans every top-level
  function of a `"use server"` module (actions and their private helpers), every inline `"use server"` function and
  every route handler. An UPDATE or DELETE must name `tenant_id` in its WHERE, or follow a run ownership check in the
  same function and be scoped by `run_id`; an INSERT setting `run_id` must follow a check or be guarded; setting
  `program_id` needs a program check; an INSERT must set `tenant_id`. A second test requires every `/api/runs/[id]`
  route to call a run check. A self-check test pins the rule on example statements. The exemption list is empty: no
  statement needed one. An exemption that no longer matches fails the test.
- `src/lib/__tests__/tenantScopingWithoutRls.db.test.ts` (real disposable PostgreSQL). The app's own `db.ts` connects
  as the test database superuser; the first test asserts the role bypasses RLS. Two tenants A and B. Reads: home list,
  runs API, project header, program lists, three export routes (findings, coding extract, history). Writes:
  `setFindingStatus`, `setManyFindingStatuses`, `setFindingTheme` (editField), `updateProgramLinkAction` (B's
  program on A's run, A's program on B's run, unlink B's run, new program on B's run), `addWaveNpsFindingAction`
  (refresh and new) and `removeWaveNpsFindingAction`, `editStatedObjective` (objective candidate update and delete),
  `saveCsmModuleAction`, `rejectRecommendation`. Each write compares a snapshot of B's rows before and after. Controls:
  A's own calls succeed; a malformed id is "not available".

Failing before (the unchanged code at 48b9435, with the page reads and `updateProgramLinkAction` moved to the same
lib modules but their SQL and logic left as they were, so the tests could call them):
`npx vitest run src/lib/__tests__/tenantScopingWithoutRls.db.test.ts src/lib/__tests__/tenantOwnershipCoverage.test.ts --pool=forks`
gave 11 failed, 2 passed (13):

- home list and runs API: 2 projects listed instead of A's 1;
- project header for B's run: returned B's row instead of null;
- program lists: 2 programs instead of 1;
- export routes for B's run: 200 instead of 404;
- finding status on B's finding: `{ ok: true }`;
- program link with B's program on A's run: resolved instead of refusing;
- wave NPS on B's run: `{ ok: true, added: true }`;
- stated-objective edit on B's run: resolved instead of refusing;
- CSM mapping with B's file: `{ ok: true }` (B's mapping overwritten);
- source scan: 80 unscoped writes, 17 unchecked routes.

The superuser check and the scan's self-check passed both times.

Passing after: the same command, 13 passed.

Why earlier tests missed this: `tenantIsolation.db.test.ts` proves RLS holds for a non-owner role, and
`requestTenantCoverage.test.ts` proves each entry point resolves the signed-in tenant. Neither checked that the code
scopes its own statements when RLS does not apply, which is how the app connects today.

## Gates (run in /home/claude/b100 on the final tree)

- `npx next typegen` then `npx tsc --noEmit`: exit 0, no errors.
- `npx eslint src e2e --quiet`: exit 0, 0 errors.
- `python3 scripts/crosstab_selftest.py`: "All checks passed" (551 PASS lines).
- `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false npx vitest run src/lib/__tests__ --pool=forks`:
  348 files passed, 2 skipped (350); 2621 tests passed, 91 skipped (2712). The two skipped files skip by design
  (`researchQualityModel.real.test.ts` needs a live model, `indicatorLimitMeasure.db.test.ts` is a measurement run).
- The first full run, before adjusting existing tests, had 23 failures in 5 files, all from the tests' own harness,
  not product behaviour: `fakeFindingsDb.ts` matches exact SQL text (now matches the tenant predicate and checks the
  row's tenant); `turnNoteIdentity.db.test.ts` mocked `requestContext` without `runBelongsToTenant` (now the real one
  on its database); `storyExportSupport`, `storyExportDiscovery` and `decisionCandidateProvenance` used the project id
  "run-1", which the ownership check correctly treats as not found (now a real id).
- Playwright was not run (out of scope for this batch).

Mocks versus real: the new database test uses real PostgreSQL, real migrations, the real `db.ts` pool, real actions
and route handlers. Mocked: the signed-in request context (which tenant is signed in), `revalidatePath`, `after`,
Supabase storage (unused) and the objective scoring model call. The source scan reads the real source.

## Files

Code commit f1277c9, 49 files: `src/lib/runOwnership.ts` and `src/lib/projectReads.ts` (new); 17 route handlers under
`src/app/api/runs/[id]`; `src/app/api/runs/route.ts`, `src/app/page.tsx`, `src/app/programs/page.tsx`,
`src/app/runs/[id]/page.tsx`; `brandHealthActions`, `chartActions`, `csmActions`, `decisionCandidateActions`,
`documentUpload`, `documentUploadActions`, `findingActions`, `npsActions`, `objectiveCandidateActions`,
`objectiveCoverageActions`, `programActions`, `recommendationActions`, `requestContext`, `researchAssistantActions`,
`runContextActions`, `runSync`, `scatterActions`, `synthesizedInsightActions`, `waveTrackingActions` (all `src/lib`);
two new tests and five adjusted tests or helpers. Docs: this file, `claude/rules-registry.md`,
`docs/database-roles.md`. No migration.

## Remaining (not done, by scope or by size)

- The database role switch (`docs/database-roles.md`) is still required and is Grant's to do. Until then, anything
  below relies on code alone.
- Delegated library code is not covered by the scan. Of 218 exported server actions that take a `runId`, 169 have no
  ownership check in their own body and pass the id to library functions (dataSetup, crosstabs, drivers, codingAnalysis,
  documentBin and others), some of which check ownership and some of which do not. A rough count finds 144
  UPDATE/DELETE statements in 44 library files without `tenant_id` in the statement; many are scoped by a parent row
  checked earlier in the same transaction, but this has not been reviewed one by one. Suggested next step: an
  ownership check at the entry of every action that takes a `runId` (one call per action), plus extending the scan to
  require it. Read-only actions that load another tenant's data by run id are in the same position.
- Other loaders on the project page still read by run id; they are not rendered for another tenant's project
  because the header returns null and the page answers not found, but they do run.
- Other foreign ids (document, table, insight, crosstab ids) are checked where an action already scoped them to the
  run, and in the CSM and brand health saves; the scan only enforces run and program ids.
- `import "server-only"` (above), security headers and CSP, rate limits, and the research assistant prompt-injection
  item are out of scope.
- Independent review, and the browser suites, have not been run on this branch.
