# Independent review of four released packages — 2026-10-18

Reviewed in the requested order from release HEAD `3e34100`, using separate immutable copies of each exact commit. Application, engine and migration source remained read-only. Local disposable PostgreSQL 17, restricted application roles, Auth/Storage stand-ins and explicit model replay only. No deployed prerequisite was awaited or used; no paid call, development/live migration, deployment or push.

| Commit | Verdict | Disposition |
|---|---|---|
| `a9cb5de` | **Accept** | Original storage counterexamples and retained failure/recovery controls pass. Local checker closure only; deployed bucket remains unverified. |
| `20977c8` | **Request changes** | Computed-table repair passes, but the retained omitted-effect measurement demonstrably misclassifies present/absent contrasts. Fix before using it to report model quality. |
| `ed3e980` | **Request changes** | Working ordinary tenant isolation does not close the independently reproduced open redirect and refresh-only outage response defect. |
| `d45c0a2` | **Request changes** | Native researcher lifecycle passes, but expired publication, purge versus in-flight publication, and interrupted-task retry fail independent actual-database checks. |

**37 Closed /6 Blocked=43 remains unchanged.** Security stays Blocked; the benchmark and new Research Quality feature do not add canonical rows. Approved exclusions, five archived-definition dispositions and previous finite closures remain preserved. Overall acceptance/public release is incomplete. Claude receives only the concrete findings below for repair; Codex independently verifies the exact returned commits. Successful unrelated checks cannot close them.

Evidence root: `scripts/workflow-tenant-review/four-package-review-20261018/`. `paths.json` names each isolated copy; per-commit manifests and `source-after.json` verify unchanged application/engine/migration bytes. The only changed tracked harness file in the latter three copies is a graceful stop-file poll in `scripts/e2e/local-stack.mjs`. Independent probes are untracked test files. No application patch was made.

## 1. a9cb5de — accepted

No remaining defect demonstrated in the agreed checker repair. Outages/reset yield incomplete rather than enforcement, partial content fails privacy, and skipped signing cannot certify expiry. `process.exitCode` preserves the result instead of the prior Windows immediate-exit abort. No deployed bucket, signed-link policy or two-user authorization certification follows.

Commands actually executed in the `a9cb5de` copy:

```powershell
node C:/Personal/InsighsAI/app/scripts/workflow-tenant-review/formal-4475adc-20261018/storage-counterexamples.mjs
node C:/Personal/InsighsAI/app/scripts/workflow-tenant-review/formal-4475adc-20261018/storage-partial-content.mjs
npx.cmd vitest run src/lib/__tests__/releaseGateStorage.test.ts
```

Both original counterexample servers were run **unchanged**, with their existing `source-path.txt` fixture pointing at the exact repair copy. Five cases now match their original expected exit/status results: public/anon500, expired-link503, expired-link reset, public206, anon206. Copies of both executed original servers and their JSON results are retained. Retained suite: **1 file,18 passed/0 failed/0 skipped, exit0** (`a9-retained.log`). These include true expiry, missing object, unreachable service, rate limit, redirect, skipped signing and outage/recovery. Original failed-run history remains in the earlier formal-review directory.

Engineering standard: explicit uncertainty/failure semantics and focused recovery regressions satisfy the bounded repair contract. No statistical/performance change or measured performance finding.

## 2. 20977c8 — computed preparation verified; measurement changes required

The exact harness runs through six native saved crosstabs before analysis and records18 computed findings. Saved-data checks independently confirm satisfaction mean3.5, Purchase Yes total50% and group40/60, NPS25, and both Convenience Male70/Female50 findings: **5/5 pass**. This repairs the original missing-computed-evidence prerequisite. It does not demonstrate real-model judgment quality.

**S2 benchmark correctness:** `e2e/ui/real-model-quality.check.mjs:188` and `:193` at **20977c8** (the `const omitted` and `foundInInsights` expressions). These retained heuristics are pre-existing, not newly introduced by the table-preparation change, but still invalidate this released benchmark's omitted-effect report:

- The actual saved findings contain Male70 and Female50 in separate, correctly grounded rows. The matcher requires both strings in one sentence, so `foundAsFinding` is empty despite the effect being present.
- Repeated text about **Female only** matches the supposed male/female comparison because `male` also matches inside `Female`. A synthetic female-only repeated sentence returns a false positive. No male comparison or70 value is needed by that predicate.

Evidence: `b22-quality.json`, `b22-saved-evidence.json`, `b22-independent-values.json`, `b22-matcher-probe.cjs`, `b22-omitted-effect-counterexamples.json`. **Two independent intended-correct checks fail.** The replay report itself records the female-only insight under `foundInInsights`; it is not fresh model evidence.

Fix acceptance: identify the same variable/response, exact group identities, direction and reference values across the eligible evidence set, preferably using existing structured statistics. A correct split70/50 control must pass; female-only repeated text, reversed groups, wrong values and unrelated figures must not be reported as the target effect. Retain all six tables, step bounds, actual saved values, truthful unmatched/unverified classifications, and a failed/missing-table refusal. Do not turn these replay results into a paid-model score.

Executed command in the exact copy:

```powershell
$env:GOLDEN_SMOKE_TARGET_MANIFEST = "$E/b22-native/target-manifest.json"
$env:REAL_MODEL_QUALITY_HARNESS_TEST = '1'
$env:REAL_MODEL_QUALITY_SYNTH_TIMEOUT_MS = '20000'
npx.cmd playwright test -c e2e/ui/ui-check.config.mjs real-model-quality
node C:/Personal/InsighsAI/app/scripts/workflow-tenant-review/four-package-review-20261018/b22-values.cjs
node C:/Personal/InsighsAI/app/scripts/workflow-tenant-review/four-package-review-20261018/b22-matcher-probe.cjs
```

The five saved-value assertions were also executed reproducibly from the workspace with `python scripts/workflow-tenant-review/four-package-review-20261018/b22-reference-audit.py` (5 passed/0 failed).

Browser: **1 passed/0 failed/0 skipped, exit0**, harness-only replay,18 computed findings,18 insights/5 syntheses/23 recommendations. All ten report claims are explicitly not extracted on replay, never quality passes. `b22-build-equivalence.json` verifies413 non-test source/engine/migration paths equal the previously independently built production application; no new build is claimed for this test-only commit. The numerical audit initially assumed Purchase raw code1 and stopped before assertions; corrected inspection uses its actual literal codeYes and passes. Both observations are retained, not an engine defect.

## 3. ed3e980 — two application findings

**S2 security: open redirect after sign-in.** `src/lib/authActions.ts:24`–`:26`, consumed at`:68`. `next` equal to slash, tab, slash, `evil.example/` passes `safeNextPath`'s prefix checks. After real native sign-in against the local Auth stand-in, browser URL normalization attempts navigation to `http://evil.example/`. The independent browser route blocked every external request before dispatch; no credentials or traffic were sent there. The normal `/` control stays local.

Evidence: `independent-login-next-continuation.check.mjs`, `b23-redirect-continuation-report.json`, its trace/screenshots and `redirect-observation.json`. Corrected probe: **1 safe-path pass/1 security-case failure, exit1**. The original probe also counted the offline mocked font request; it is retained separately and is not used as an assertion that font loading is an application defect. The external navigation remains after restricting the assertion to navigation requests.

Fix acceptance: reject control characters/backslashes/authority-changing forms or normalize against a trusted application origin and require that origin before returning only a local path. Preserve safe path/query navigation. Re-run the original tab-path login, newline/carriage-return and ordinary external/protocol-relative controls, plus a valid in-app destination. No external navigation after login; no forced error page replacing a safe fallback.

**S2 reliability: refresh-only Auth outage becomes signed out.** `src/proxy.ts:57`–`:61` lets an Auth-unavailable refresh fall through unchanged. When the access cookie has expired/disappeared but the refresh cookie remains, `src/lib/requestContext.ts:81`–`:82` treats the absent access cookie as signed out. Actual native API: baseline200, valid-access outage503, refresh-only outage**401**, restored Auth/retry200. Cookies were preserved, so this is not a claim that the database tenant fell back or a token was deleted; the response incorrectly tells the client the user is signed out during service failure.

Evidence: `independent-refresh-outage.check.mjs`, `b23-browser-report.json`, trace and `independent-refresh-outage.json`. Fix acceptance: an unavailable refresh must give an explicit unavailable response/page, preserving cookies and the intended destination, rather than becoming401 or a login form merely because the access cookie is absent. Verify access-present, access-expired/absent plus refresh, genuine rejected-refresh and restored-service controls; recovery must remain in the original authorized organisation with no fallback tenant.

Exact focused commands in the `ed3e980` copy:

```powershell
$env:TEST_DATABASE_URL = 'postgres://supabase_admin@127.0.0.1:55527/postgres'
$env:PYTHON_EXECUTABLE = 'python'
$env:PYTHONUTF8 = '1'
npx.cmd vitest run src/lib/__tests__/requestTenantCoverage.test.ts src/lib/__tests__/authSession.test.ts src/lib/__tests__/parseRequestSignature.test.ts src/lib/__tests__/safeNextPath.test.ts src/lib/__tests__/signedInTenantAccess.db.test.ts src/lib/__tests__/tenantIsolation.db.test.ts src/lib/__tests__/findingWording.db.test.ts
# After providing an isolated python3.exe alias to the installed interpreter:
npx.cmd vitest run src/lib/__tests__/parseRequestSignature.test.ts
npx.cmd next build --webpack
npx.cmd playwright test -c e2e/ui/ui-check.config.mjs sign-in-access independent-refresh-outage
npx.cmd playwright test -c e2e/ui/ui-check.config.mjs independent-login-next
```

Initial focused run: **35 passed/4 failed/2 skipped**,7 files, exit1. All four failures are the missing Windows `python3` Store alias, before Python verifier execution. The isolated executable alias/PYTHONHOME continuation changes no source: **5 passed/0 failed/0 skipped**, exit0 (one of these five already passed initially; do not sum it twice). Actual non-owner PostgreSQL actions/routes, cross-tenant refusal, membership isolation, source-coverage scan and ordinary Auth cases pass. The source scan checks presence of request-context calls, not proof of all branch behavior; the independent outage case demonstrates that limit.

Production build/full TypeScript: **pass, exit0**, isolated fully migrated build database, offline-font compile boundary and retained `unpdf` warning. Native released sign-in lifecycle: **1 pass**; independent outage: **1 fail**, combined exit1. Redirect original probe1fail retained; corrected control/counterexample1pass/1fail as above. All native tests use actual production handlers and restricted DB roles, with stand-in identity/storage, not deployed Supabase certification.

Maintainability: the shared request-context layer and scoped signer preserve separation and avoid copying tenant-selection rules into every action. The Python handler's older comment still says the app sends the shared secret; the new HMAC implementation and following comment correctly say it does not (`api/parse-stats-file.py` near3489). Correct this obsolete explanation with the repair under standard8. No changed statistical computation or measured performance problem was identified.

## 4. d45c0a2 — native feature passes; task lifecycle requires changes

**S2: expired lease can still publish without a replacement claimant.** `src/lib/researchQualityRepository.ts:281`–`:288` checks token/status but not lease expiry; the same omission exists in assessment publication near`:321`. Independent actual repository call claims a task, sets its lease in the past to model a slow/expired worker, and calls `publishExtraction` with that original token. It returns**true** and commits, instead of refusing. The retained replacement-token test passes but does not cover this case.

Fix acceptance: publication must atomically require the active, unexpired matching lease and intended input. Execute original expired-unreclaimed refusal, replaced-lease refusal, current valid publication, and safe retry/recovery controls for extraction and assessment. A slow response must not turn an expired attempt into success.

**S2 retention: in-flight result can restore purged text.** `purgeSourceText` near`:128` and `publishExtraction` near`:281` have no publication/purge coordination. Independent sequence: claim an extraction; purge its pinned source; publish the already-in-flight result. Publication returns**true** and stores `Project brief.` in both quote and statement despite the source having been purged. This uses an actual source/version and actual non-owner persistence, with a controlled model-result boundary.

Fix acceptance: purge must invalidate related in-flight extraction/assessment publication, or publication must atomically refuse sources purged since reading. Preserve historical metadata without retained purged text. Run original purge-before-late-response, assessment-after-purge and concurrent ordering controls; verify task rows, observations, view and export cannot reintroduce quoted text. Preserve normal unpurged publication, existing already-published purge and unrelated sources/researcher work.

**S2 recovery: explicit retry does not handle expired running tasks.** `src/lib/researchQualityReview.ts:447`, `:488`–`:495`. `claimTask` can reclaim expired running work, but the runner selects onlypending and retry onlyfailed. An expired running extraction after worker interruption gets `{retried:0,note:null}` on explicit retry; it is neither resumed nor given the safe new-review explanation. This is separate from accepting an expired late result.

Fix acceptance: make interrupted expired work discoverable and recoverable within attempt bounds, or return a visible safe refusal/new-review path when assessments already published. Do not automatically redo successful work or silently strand the task. Test original expired-running retry, live-lease non-steal, exhausted attempts, partial published-review recovery and idempotent repeat.

Evidence: `independentResearchQuality.db.test.probe.txt`, `b24-independent.log` (**13 retained passes/2 independent case failures**,15 tests); expanded `independentResearchQualityRecovery.db.test.probe.txt` and `b24-independent-recovery.log` (**same13 retained passes/3 independent case failures**,16 tests). Do not count these duplicated retained cases as26 independent checks. The purge case has two failing assertions within one failed test. The probes call actual repository/runner code, not copied SQL substitutes; fixtures control model output and explicitly age only owned synthetic leases.

Executed commands in the exact `d45c0a2` copy:

```powershell
$env:TEST_DATABASE_URL = 'postgres://supabase_admin@127.0.0.1:55527/postgres'
npx.cmd vitest run src/lib/__tests__/researchQualityRules.test.ts src/lib/__tests__/researchQuality.db.test.ts src/lib/__tests__/requestTenantCoverage.test.ts
npx.cmd vitest run src/lib/__tests__/independentResearchQuality.db.test.ts
npx.cmd vitest run src/lib/__tests__/independentResearchQualityRecovery.db.test.ts
npx.cmd next build --webpack
npx.cmd playwright test -c e2e/ui/ui-check.config.mjs research-quality
```

Retained deterministic/actual-DB/coverage suite: **3 files,36 passed/0 failed/0 skipped**, exit0. Independent cases fail as above. Production build/full TypeScript: **pass, exit0**, own build database with0104/0105. Native: **1 passed/0 failed/0 skipped, exit0**; no-call opening, pinned exact quotes, review/start, researcher attribution, reload, two-tab stale-revision conflict, clarification and real DOCX output checked. This does not assert passing fresh semantic judgments or universal PDF/Office rendering.

The production reference catalogue's lack of approved entries and resulting insufficient-reference-support labels are intended, not defects. Real-model semantic cases remain unexecuted here by instruction; replay is orchestration only. Existing schema-missing, non-owner cross-tenant, malformed result, partial retry, source replacement, human wording/history and already-published purge controls retain their passing scopes. No claims based merely on the supplier's990-test or41-browser totals are made.

Engineering standard: UI/actions/repository/statistical layers remain separated; the screen and DOCX share a view model; criteria/references are versioned application data. The publication/purge/retry defects contradict the stated lease/retention guarantees and requirements3/4/8. Update those implementations and regression coverage together. No speculative optimization or measured performance problem is asserted. Accepted source extraction and method-quality claims remain bounded by the executed fixtures, not replay grades.

## Reproduction environment, history, shutdown and handoff

`$E` above is the evidence root. All commands run with the exact-copy cwd recorded in `paths.json`. Container command:

```powershell
docker run --rm -d --name codex-four-review-20261018 --label codex.task=four-review-20261018 -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:55527:5432 public.ecr.aws/supabase/postgres:17.11.0.004
```

Only this owned cluster's local authentication was configured for tests. Strict DB cases use its `supabase_admin` prerequisite; native apps use the setup-created nonowner/NOSUPERUSER/NOBYPASSRLS role. Build databases `ie_test_build_b23`/`b24` receive each commit's own complete migration chain. Each stack starts with `node scripts/e2e/local-stack.mjs`, `E2E_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:55527/postgres`, its exact production path, explicit Python/LibreOffice paths, and no model gateway. App/storage ports are3245/39132 for b22,3246/39133 for b23,3247/39134 for b24. Auth states are local synthetic accounts, not real memberships.

An automatic approval review timed out before executing one initial database-preparation command; the permitted single retry succeeded. This is an approval infrastructure failure, not an application result. Original Windows Python, broad redirect/font assertion and code-inspection failures are retained separately from corrected continuations and genuine application failures. Earlier paid/model and golden-thread failed history is untouched. No new paid run is authorized by these notes; deployed setup and any later model run remain separate.

Password-free per-stage synthetic dumps, storage inventories/reads, replay logs, failed traces/screenshots, actual result observations, source manifests and exact portable probes remain local under the evidence root. All owned stacks and runtime DB/roles are stopped/removed; labelled container and reserved listeners are checked in `cleanup.json`. No user service is stopped. `artifact-hashes.json` records retained evidence hashes.

Handoff: **READY_FOR_CLAUDE**, for the benchmark measurement, two sign-in defects and three Research Quality task-lifecycle defects above. Storage repair accepted at its finite local scope. Preserve passing mechanisms and all failed runs. Return exact stable repair commits for independent review; do not promote counts, claim deployment/security acceptance, rerun paid work or push based on this report.
