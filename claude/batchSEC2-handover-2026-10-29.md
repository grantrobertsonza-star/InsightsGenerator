# Batch SEC2 handover: run ownership at every action's entry, and security headers, 29 October 2026

Status: implemented, ready for independent review. Branch `sec2` (base 99bfe4c, on top of SEC1). Code commits
7e0c8fd (entry checks, scan, database test, harness fixes) and 225bd48 (security headers). Docs in the commit that
adds this file. Tier A (tenancy). Nothing pushed, deployed or written to Supabase. No migration.

## Why

SEC1 made every write an action module makes itself name the tenant, but found that of the server actions taking a
`runId`, most had no ownership check in their own body and handed the id to library code (crosstabs, codingMemos,
drivers, objectiveEvidence and others), some of which read or write by run id alone. The app may connect as a role
that bypasses row-level security (`docs/database-roles.md`), so those library statements were not protected. SEC2
checks the run at the entry of every such action, so the library is only reached with a run already proven to be the
signed-in tenant's. It also adds the security headers from audit item S3-1.

## Rule and owner

Registry row "Tenant ownership on every read and write" (updated) and a new row "Security headers on every response"
(`claude/rules-registry.md`).

- Owner of the entry check: `src/lib/runOwnership.ts`, two new functions built on SEC1's `runOwned`:
  - `runAccessible(tenantId, runId)`: true when the run exists, is the tenant's and is not a project's bin. A malformed
    id is false without a database call. Non-locking, in its own read (`withTenantRead`).
  - `assertRunAccessible(tenantId, runId)`: the same, throwing `RunNotFoundError` ("That project is not available.").
- `requestContext.runBelongsToTenant` (route handlers) now delegates to `runAccessible`: one implementation.
- Writes keep their SEC1 in-transaction checks (`assertRunOwned` with the writing client, or `tenant_id` in the
  statement). The entry check does not replace them.
- Owner of the headers: `next.config.ts` `securityHeaders()` and `contentSecurityPolicy()`.

## What changed

### 1. Entry check in every action that takes a run id

204 actions in 36 files now check the run first (before: the scan below flagged exactly these 204). Of the 236
exported or inline server actions that take a run id, the other 32 already checked in their own body from SEC1 and
pass the new rule as they were.

Per file: codingAnalysisActions 31, crosstabActions 16, instrumentActions 13, recommendationActions 10,
`runs/[id]/page.tsx` inline actions 10, trackerDashboardActions 9, objectiveEvidenceActions 9, waveTrackingActions 8,
findingActions 8, brandHealthActions 8, researchQualityActions 7, outputSetActions 7, driverActions 7,
documentActions 5, csmActions 5, synthesizedInsightActions 4, runContextActions 4, dataSetupActions 4,
variableOverrideActions 3, scatterActions 3, researchAssistantActions 3, objectiveCandidateActions 3,
indicatorDataActions 3, decisionCandidateActions 3, claimTableChecksActions 3, runActions 2, qualityActions 2,
objectiveCoverageActions 2, npsActions 2, indicatorAnalyticsActions 2, evidenceTrailActions 2, chartActions 2, and one
each in previewActions, documentUploadActions, documentOpenActions, documentIndicatorActions.

How each action reports the refusal (its existing failure shape, no wrapper):

- 181 actions that return a failure result return it, right after the tenant is resolved:
  `if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };`, with the extra
  fields their result type requires (`conflict: false` for objective edits, `reason: "missing"` for finding wording,
  `added: []` for uploads, `previousVersionKept: false` for an indicator re-read, `{ setup: DEFAULT_DATA_SETUP, ok:
  false, error }` for the data set-up status read, `{ state: "error", message }` for the indicator dashboard, `{ error }`
  for the source preview, and `as ActionResult` in the coding module, as that file already does).
- 23 actions that report failure by throwing (they return nothing or a success-only type: the page's inline actions,
  recommendation and synthesized-insight accept/reject/delete, `deleteDocument`, `addOwnDecisionCandidate`,
  `retryDecisionRefresh`, `saveRunContext`, `saveRunContextFromForm`, `editStatedObjective`, `loadDataSetupAction`)
  call `assertRunAccessible`.

A small wrapper was considered and not used: a "use server" module may only export async functions, Next checks this
at build and run time, and a wrapper would also hide the check from the source scan. One explicit line per action is
the smaller and more reviewable change.

Other details:

- The check is placed before anything else that awaits, including a top-level `try`, because several catch blocks
  write (for example `generateFindingsAction` marks the document failed by document id, and several regenerate
  actions write a trace row). A database outage during the entry check therefore throws, as an outage in
  `requireTenantId` (which also reads the database) already did.
- `saveBrandHealthModuleAction` and `addScatterFindingAction` (SEC1 actions) read the data file before their
  in-transaction check; the new scan flagged them and they now check at entry as well.
- `deleteOutputSetAction` resolves the context inside its `try`; the check is the next statement there.
- `loadDataSetupAction` and `loadDataSetupStatusAction` took `_runId` and ignored it. They now check it, and
  `dataSetup.loadDataSetupWithStatus` names `tenant_id` in its read, so another tenant's document id gives the default
  set-up instead of that tenant's saved one.

Behaviour for the signed-in tenant's own projects is unchanged apart from one extra indexed read per action call.
For another tenant's project, a missing project and a malformed id, every listed action now answers "That project is
not available." in its own failure shape. Some messages for a missing project changed as a result (for example
`deleteRun` said "That project was not found. Nothing was deleted.", `setFindingStatus` said the finding was "no
longer in this project"); these now read the same as another tenant's project, which is the point.

### 2. Source scan (`src/lib/__tests__/tenantOwnershipCoverage.test.ts`)

New test "every server action that takes a run id checks it before any database or library call". The rule, also
written in the file above `RUN_PARAM`:

- Scope: exported functions of a "use server" module and inline "use server" functions (pages).
- Covered parameter names: `RUN_PARAM = /^_?(?:run|project)_?id$/i` (runId, _runId, projectId, run_id, any case).
- The check: a call to `runAccessible`, `assertRunAccessible`, `assertRunOwned`, `runOwned`, `runBelongsToTenant` or
  `lockRunForContextChange` that passes that parameter itself.
- Placement: the body's top-level statements are walked in order (and into a top-level `try` block). The check must be
  one of them, not inside a branch or a callback, except as the first statement of a `withTenant`, `withTenantRead` or
  `withTenantRepeatableRead` callback (so a check that shares the write's transaction counts). A statement before it
  may await only `requireTenantId` or `requireRequestContext`, may not call the database (`withTenant*`, `query`,
  `connect`), and may not return a call's result. Synchronous validation may come first.
- Exemptions: `ENTRY_EXEMPT`, keyed `file#function`, each with a reason. It is empty: no action needed one. An
  exemption that no longer matches fails the test.
- A self-check test pins the rule on examples: an accepted check after validation, inside `try`, inside the
  transaction callback; refused when a library call is awaited first, when `guard(...)` is returned without a check,
  when a different id is checked, when the check is in a branch, when it is only in a nested function; the parameter
  pattern matches the intended names and not `documentId` or `reruns`.

### 3. Security headers (`next.config.ts`)

`async headers()` returns one rule for `/(.*)` (every page, route handler, server action and public file):

- `Content-Security-Policy`: `default-src 'self'; script-src 'self' 'unsafe-inline'` (plus `'unsafe-eval'` only when
  `NODE_ENV` is development); `style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:;
  connect-src 'self' <supabase>; frame-src 'self' <supabase>; object-src 'none'; base-uri 'self'; form-action 'self';
  frame-ancestors 'none'`. `<supabase>` is the origin of `NEXT_PUBLIC_SUPABASE_URL` (the local storage stand-in in the
  browser suites); a missing or malformed value adds nothing. `frame-src` was added beyond the brief because the source
  preview shows a PDF from a Supabase signed link in an iframe (`FindingsTable.tsx`), which `default-src 'self'` would
  block. `upgrade-insecure-requests` was left out: local development and the browser suites run over http.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Strict-Transport-Security: max-age=31536000` (sent always; browsers ignore it over http; no `includeSubDomains`),
  `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()`.
- `poweredByHeader: false`. The experimental settings and the `/home` rewrite are byte-for-byte unchanged.
- Each header has a comment saying why. `script-src` keeps `'unsafe-inline'` because Next inlines boot scripts and
  `public/home.html` has an inline script; removing it needs nonces, which make every page dynamic.

## Impact checklist

1. Rule: tenant ownership row (owner `runOwnership.ts`, `runBelongsToTenant` now uses it); new headers row.
2. Inputs: another tenant's id, a missing id and a malformed id all give the same refusal; a malformed id makes no
   database call. A failed ownership read is an error (thrown), never "owned" and never "not found".
3. Persistence: the entry check is a plain read, outside any transaction; writes keep SEC1's in-transaction checks.
   A run's tenant never changes (no code path updates `runs.tenant_id`), so the earlier check stays true; a run
   deleted in between makes the later write match nothing or fail its foreign key. Retries: unchanged.
4. Freshness: none. No research result, wording or decision changes meaning.
5. Screens: no screen change for the signed-in tenant's projects. The refusal reaches screens through each action's
   existing failure path. The headers apply to every screen; see limits below.
6. Proof: below.

## Proof

### Before (product code at base 99bfe4c, new tests in place)

`TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run src/lib/__tests__/tenantOwnershipCoverage.test.ts src/lib/__tests__/tenantEntryOwnership.db.test.ts --pool=forks`
gave 2 files failed, 10 tests failed, 5 passed (15):

- source scan: 204 actions flagged (for example `page.tsx#extractFindingsAction (awaits runReportExtraction(...)
  before the run check)`); the SEC1 write scan, the route test and both self-checks passed.
- database test, all 9 cross-tenant cases failed. What A could do with B's project id, recorded with a probe on the
  same database:
  - `loadCrosstabAction(runB, tableB)`: `{ ok: true, label: "B secret table", result: {...} }`;
  - `setCrosstabTextAction(runB, tableB, "Hijacked", ...)`: `{ ok: true }`, and B's table was retitled "Hijacked";
  - `chartFindingStatusAction` and `npsFindingStatusAction`: `{ ok: true, committed: true }` (B's findings revealed);
  - `listDriverAnalysesAction`: `{ ok: true, items: [] }` (already scoped in the library; failed only on the result);
  - `addMemoAction(runB, ...)`: `{ ok: true, message: "Memo saved." }`, a memo written under B's project;
  - `loadObjectiveEvidenceAction(runB)`: returned B's evidence question;
  - `deleteSynthesizedInsight(runB, insightB)`: resolved, and B's synthesized insight was deleted;
  - `getDocumentPreviewUrl(runB, { sourceTableId: tableB })`: returned B's table headers and rows;
  - `addOwnRecommendation(runB, ...)`: refused by the library with "That insight is not part of this project any
    more" (not a leak; failed on the wording);
  - `addOwnObjectiveCandidate(runB, ...)`: already refused by its locked run read (threw).
- The superuser check passed (the connection bypasses RLS).

### After

The same command: 2 files passed, 15 tests passed. `tenantEntryOwnership.db.test.ts` (new, real disposable
PostgreSQL, the app's `db.ts` connecting as a superuser that bypasses RLS) asserts for each case the action's own
refusal, nothing of B in the result, and a snapshot of every row under B's project unchanged (tables, findings, memos,
synthesized insights and their history, objective candidates, evidence, driver analyses, recommendations). Controls:
A's own crosstab, chart and NPS status, driver list, memo and evidence read work as before; a random id answers exactly
like B's project; a malformed id is refused, not a database error.

`securityHeaders.test.ts` (new, 5 tests) imports the real `next.config.ts`: the rule's source matches `/`, project
pages, route handlers, `/home` and `/home.html` with Next's own path matcher; the exact policy and every header; eval
only in development (not in production or test); no outside origin when the Supabase URL is missing or malformed, and
the local stand-in's origin when it is local; `poweredByHeader` false, `experimental` and the rewrite unchanged.

### Tests changed (harness, not product checks)

The first full run with the change had 63 failures in 15 files, all from the tests' harness meeting the new entry
check:

- 11 unit test files mock the database (no runs table to answer the check) and used the project id "run-1":
  `callerToBuilderStrictSetup`, `chartMethod`, `designLookupFailureSurfacing`, `driverRequestContract`,
  `headerRowChoice`, `objectiveEvidenceIdentity`, `objectiveEvidenceOrigin`, `previewAuthority`,
  `reportImportCompletion`, `starterBannersAction`, `waveTrackingNpsMetadata`. They now use a real id and the new
  documented seam `helpers/ownedRun.ts` (well-formed id is owned, malformed is not, the rest of `runOwnership` real).
  Two titles in `driverRequestContract` said "before the database is touched"; they now say "before anything of the
  project is read or written (the entry ownership check aside)", which is what is true.
- `decisionRefreshReconciliation.db.test.ts` injected an outage into "the first `withTenantRead`", which is now the
  entry check; it now injects it into the first read after the entry check, the marker lookup the test is about.
- `codingOwnership.db.test.ts`, `releaseAuditRepairs.db.test.ts`, `signedInTenantAccess.db.test.ts` and SEC1's
  `tenantScopingWithoutRls.db.test.ts` expected the older wording for another tenant's project ("transcript not in this
  project", "project was not found", "no longer in this project", "not found"). They now expect "That project is not
  available." for another tenant's project, and where a statement-level check was being tested, they also call it with
  A's own project and B's row id so that check stays covered (coding transcript, finding status and theme,
  recommendation rejection).

Why earlier tests missed this: SEC1's scan only looked at statements in action modules, and its database test only
called actions whose own body wrote. Library reads and writes reached through an action were not exercised for another
tenant; the new scan rule and database test cover that path.

## Gates (run in /home/claude/b105 on the final code)

- `npx next typegen` then `npx tsc --noEmit`: exit 0, no errors.
- `npx eslint src e2e --quiet`: exit 0, 0 errors.
- `python3 scripts/crosstab_selftest.py`: "All checks passed" (555 PASS lines).
- `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false npx vitest run src/lib/__tests__ --pool=forks`:
  361 files passed, 2 skipped (363); 2722 tests passed, 91 skipped (2813). The two skipped files skip by design
  (`researchQualityModel.real.test.ts` needs a live model, `indicatorLimitMeasure.db.test.ts` is a measurement run).
  No database role errors; no file needed a rerun. The first full run, before the harness fixes, had 63 failed tests in
  15 files (2659 passed).
- Playwright was not run (out of scope for this batch). A live check of the headers with `next dev` was attempted and
  could not start in this worktree: Turbopack refuses the symlinked `node_modules` ("Symlink node_modules could not be
  resolved"). The headers are therefore proven by the config test only; the browser suites exercise the app under them
  once run on a normal checkout.

Mocks versus real: the database tests use real PostgreSQL, real migrations, the real `db.ts` pool and the real
actions. Mocked: the signed-in request context, `revalidatePath`, `after`, the storage client. The scan reads the real
source. The headers test reads the real config.

## Files

Code commit 7e0c8fd (58 files): `src/lib/runOwnership.ts`, `src/lib/requestContext.ts`, `src/lib/dataSetup.ts`, the
36 action files listed above (35 under `src/lib`, plus `src/app/runs/[id]/page.tsx`); tests:
`tenantOwnershipCoverage.test.ts` (extended), `tenantEntryOwnership.db.test.ts` and `helpers/ownedRun.ts` (new), and
the 15 adjusted test files listed above. Headers commit 225bd48: `next.config.ts`, `securityHeaders.test.ts` (new).
Docs: this file and `claude/rules-registry.md`.

## Remaining (not done)

- The database role switch (`docs/database-roles.md`) is still required and is Grant's to do. Until then isolation
  rests on the code alone, now checked at every action's entry and in the writes.
- Ids of other kinds (document, table, finding, insight, crosstab ids) are scoped where a library already checks them
  against the run; the entry check guarantees the run, not that each such id belongs to it. Library statements that use
  a row id alone after the run check (for example `crosstabs.setCrosstabText` by table id and run id, which is safe now
  that the run is checked) were not reviewed one by one.
- Other loaders on the project page still read by run id; they run only after the header read confirmed the project.
- Rate limits, the research assistant prompt-injection item, MFA and roles within an organisation, and
  `import "server-only"` (needs the package and a Vitest alias): not in this batch.
- CSP is not strict: `'unsafe-inline'` scripts remain until nonces are adopted. Not checked in a running browser here
  (see gates).
- Independent review and the browser suites have not been run on this branch.
