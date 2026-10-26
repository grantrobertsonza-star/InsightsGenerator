# Independent verification of six repair findings — 2026-10-18

Reviewed release HEAD `44bee6e` through separate immutable copies of `22555fe`, `7ca0848` and `35af43a`, in that order. **Accept sign-in; request changes on benchmark measurement and Research Quality lease expiry.** The original reproductions pass, but two required boundaries still fail. Successful unrelated checks do not close those boundaries.

| Repair commit | Verdict | Disposition |
|---|---|---|
| `22555fe` | **Request changes** | Original split-finding false negative and female-only false positive repaired and independently verified. Unrelated or explicitly denied figures can still be reported as the target effect. |
| `7ca0848` | **Accept** | Original native open redirect and refresh-only outage counterexamples pass unchanged, with safe navigation, genuine sign-out and recovery controls. Local application scope only. |
| `35af43a` | **Request changes** | Original expired-before-entry, purge/late-result and interrupted-retry reproductions pass unchanged. Purge coordination and bounded retry verified; publication can still succeed when its lease expires while waiting for a source lock. |
| Unchanged `a9cb5de` | Preserve **Accept** | Both previously accepted checker paths match; no repeat or expansion of deployed-storage acceptance. |

Canonical partition remains **37 Closed /6 Blocked=43**, priorities34/9/0. These benchmark/new-feature findings do not add canonical rows. IMP-001/016 remains Blocked for deployed security; five archived historical definitions remain Blocked and deferrable. Approved SAS and flipped separate-Codebook exclusions are distinct from unresolved requirements. Overall acceptance/public release remains incomplete.

Evidence root: `scripts/workflow-tenant-review/six-repair-review-20261018/`. Original findings and failed invocations remain in [the preceding independent review](four-package-independent-review-2026-10-18.md) and its evidence root, unchanged.

## 1. Benchmark measurement — original repairs verified; false positives remain

The repaired structured-statistics path correctly identifies the original saved Male70/Female50 findings across separate rows. The exact original repeated female-only text no longer becomes a comparison. Correct explicit contrast, reversed values and wrong values also behave as expected. Retained suite: **6 passed/0 failed**, exit0. Independent original-data/text checks: **5 passed/2 failed**, exit1.

**S2 benchmark correctness, remaining:** [omitted-effect-measure.mjs](../e2e/ui/omitted-effect-measure.mjs:71), especially the sentence-wide answer check at74, clause collection at76–86 and positive classification at112–114. Merely mentioning Convenience somewhere in a sentence lets unrelated percentages in other clauses count as its effect. Negation is also ignored:

- `Convenience was not measured, while 70% of men and 50% of women reported good service.`
- `Convenience is not chosen by 70% of men or 50% of women.`

Both actual module calls return `states the effect` and `found in the computed findings and stated by an insight`. Neither text asserts the target effect. These are independent intended-correct failures against the original acceptance condition that unrelated figures must not be scored as the target effect, not a model-quality judgment. See `benchmark-independent.json` and executable source `benchmark-independent.mjs.probe.txt`.

Fix acceptance: keep the verified structured findings and one-group behavior. Do not score a sentence as asserting the effect merely from co-occurring answer/group/value tokens. Establish affirmative attribution of the target answer to both group values; where attribution or polarity is uncertain, report unverified/related rather than a positive. Both exact counterexamples above must refuse positive classification, while the original correct explicit contrast and split findings still pass. Preserve wrong/reversed/unrelated-answer, missing-table and refusal controls. No general NLP redesign is required to return uncertainty safely.

The native six-table benchmark still passes on the final production build: **1 browser test passed**, exit0;18 computed findings,18 insights,5 syntheses and23 recommendations. Both one-group insights are correctly reported as one group only. Fresh saved numerical audit **5/5 passes**: satisfaction3.5, Purchase Yes total50%, group40/60, NPS25 and split Convenience70/50. Replay's ten report claims are `not extracted`, not quality passes. This verifies orchestration and saved arithmetic, not a real-model score.

## 2. Sign-in — accept the bounded repairs

Both original independent browser probes were copied byte-for-byte and run first against untouched synthetic sessions: safe destination, original tab-path attack and refresh-only outage/recovery **3 passed/0 failed**, exit0. No external navigation occurs. During Auth outage, both access-present and refresh-only requests return503; refresh cookies survive and restored service returns200.

The exact `7ca0848` focused suite gives **7 files,44 passed/0 failed/2 explicit skips**, exit0. It covers safe path/query/fragment, control/backslash/authority forms, genuine rejected refresh with cleared cookies, unavailable refresh with preserved cookies, restored original organisation, membership and actual non-owner tenant-scoped routes/actions, source coverage and TypeScript-to-Python signatures. The two skips are retained placeholders, not passes.

On the final production build, retained sign-in checks give **9 passed**, including actual login with tab/newline/carriage-return/backslash/protocol-relative/absolute destinations and a safe in-app destination. The Research Quality browser workflow in the same command gives **1 passed**, for **10 passed/0 failed**, exit0. The refresh test's fresh-session boundary is explicit: the local Auth stand-in revokes all a user's refresh sessions on sign-out. Our unchanged original probe ran before that lifecycle, so its pass does not depend on changing its assertions or the stand-in.

The shared URL rule, request-context outage handling and proxy remain in their existing layers. The obsolete Python signing comment is corrected and signatures still verify. No remaining functional or engineering-standard violation is demonstrated in this bounded repair. This accepts neither actual deployed Supabase configuration nor the full public-release identity/storage gate.

## 3. Research Quality — purge and retry verified; lease wait remains

Exact final retained deterministic/DB/source-coverage checks: **3 files,41 passed/0 failed**, exit0, including18 actual-DB lifecycle tests. The unchanged original independent recovery probe gives **16 passed/0 failed**, exit0, versus its retained previous13 passed/3 failed. These commands repeat shared fixtures; their counts must not be added as unique coverage.

| Original finding | Independent disposition |
|---|---|
| Already-expired, unreclaimed lease publishes | Original reproduction now refuses. Extraction, assessment, failure and replaced-lease/current-lease controls pass, including usage accounting. **Partially resolved:** lock-wait boundary below remains. |
| Purge followed by an in-flight late result restores text | Original actual-repository reproduction now refuses; retained extraction/assessment purge controls, both publication/purge orderings, task/view/DOCX checks and unrelated-source preservation pass. **Repaired and verified at the finite local scope.** |
| Explicit retry strands expired running work | Original runner reproduction now recovers or explains. Retained live-lease non-steal, exhausted-attempt, partial-publication/new-review, before-assessment recovery and harmless repeat controls pass. **Repaired and verified at the finite local scope.** |

**S2 task reliability, remaining:** [researchQualityRepository.ts](../src/lib/researchQualityRepository.ts:279), shared `CURRENT_LEASE`; extraction publication353 and assessment publication396 use `lease_expires_at > now()`. `withTenant` begins a transaction before acquiring source locks. PostgreSQL `now()` remains that transaction's start time, so it does not establish that the lease is still live after waiting.

Independent actual-DB reproduction, for extraction and assessment separately:

1. Create an owned review/task and claim its lease normally.
2. Another connection locks its source version `FOR UPDATE`; set the owned synthetic task's expiry two seconds ahead.
3. Call the actual publisher while the lease is live. Observe it waiting on the source lock.
4. Wait2.2seconds and confirm from another query that the lease is expired **before** releasing the lock.
5. Release the lock. Both publishers return **true**, mark the task succeeded, and assessment observations persist; expected false/no publication.

`rq-lock-expiry-observations.json` records real lock waits and expired-before-unlock=true for both stages; elapsed2257/2266ms. `rq-lock-expiry.log`: **18 retained passes/1 independent failed test**, exit1, with two failing stage assertions. `independent-lock-expiry.probe.txt` preserves the exact fixture/probe. It calls actual repository functions, not substitute publication SQL. Only owned synthetic lease timing is controlled.

Fix acceptance: establish a matching, still-unexpired lease at the publication decision after relevant lock waits, using a clock/check that does not remain frozen at transaction start. Preserve atomic task/result writes, source-lock ordering and paid-attempt accounting. Both exact wait/expiry cases must refuse and leave no published observations; current-lease publication and safe reclaim/retry must pass. Retain all verified purge/interrupted-retry cases. Do not infer full closure from the already-expired-before-entry test alone. No deployed incident or measured performance problem is asserted.

Layering/shared rules remain appropriate; the new lock-order explanation is useful. The unconditional unexpired-publication guarantee in the repository header must become true under the wait case, with its regression, under requirements3/4/8. No stylistic abstraction or speculative optimization is requested.

## Exact execution and source scope

`paths.json` maps each command's immutable cwd. Focused commands:

```powershell
# exact22555fe
npx.cmd vitest run src/lib/__tests__/omittedEffectMeasure.test.ts
node review-benchmark.mjs
# exact7ca0848; TEST_DATABASE_URL=postgres://supabase_admin@127.0.0.1:55527/postgres
npx.cmd vitest run src/lib/__tests__/requestTenantCoverage.test.ts src/lib/__tests__/authSession.test.ts src/lib/__tests__/parseRequestSignature.test.ts src/lib/__tests__/safeNextPath.test.ts src/lib/__tests__/signedInTenantAccess.db.test.ts src/lib/__tests__/tenantIsolation.db.test.ts src/lib/__tests__/findingWording.db.test.ts
# exact35af43a; same disposable TEST_DATABASE_URL
npx.cmd vitest run src/lib/__tests__/researchQualityRules.test.ts src/lib/__tests__/researchQuality.db.test.ts src/lib/__tests__/requestTenantCoverage.test.ts
npx.cmd vitest run src/lib/__tests__/independentResearchQualityRecovery.db.test.ts
npx.cmd vitest run src/lib/__tests__/independentLockExpiry.db.test.ts
node review-build-db.cjs
npx.cmd next build --webpack
node scripts/e2e/local-stack.mjs
npx.cmd playwright test -c e2e/ui/ui-check.config.mjs independent-login-next independent-refresh-outage
npx.cmd playwright test -c e2e/ui/ui-check.config.mjs sign-in-access research-quality
$env:REAL_MODEL_QUALITY_HARNESS_TEST='1'
$env:REAL_MODEL_QUALITY_SYNTH_TIMEOUT_MS='20000'
npx.cmd playwright test -c e2e/ui/ui-check.config.mjs real-model-quality
# workspace, before shutdown
node scripts/workflow-tenant-review/six-repair-review-20261018/saved-values.cjs
python scripts/workflow-tenant-review/six-repair-review-20261018/reference-audit.py
```

Production build/full TypeScript **passed, explicit exit0**, on `35af43a` with its entire migration chain in `ie_test_build_six`. Offline font responses are a compile boundary; existing `unpdf` warning retained. The original DB probe was renamed out of TypeScript discovery before building; the additional wait probe was added after the build and renamed after execution. No new full1006-test or49-browser-suite execution is claimed.

Build environment: DATABASE_URL points only at that local build DB; NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:39134, publishable/secret keys are local stand-in values, NEXT_FONT_GOOGLE_MOCKED_RESPONSES uses the retained ten-journey font fixture. Signature tests use an isolated `python3.exe` alias of installed Python314 with PYTHONHOME/PYTHONUTF8, avoiding the known Windows Store-alias prerequisite failure without source changes.

Native launcher: E2E_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:55527/postgres, E2E_APP_PORT=3247, E2E_STORAGE_PORT=39134, E2E_NEXT_START=the35af43a copy, E2E_OUT_DIR=the evidence root's native directory, PYTHON_EXECUTABLE=python, LIBREOFFICE_PATH=C:/Program Files/LibreOffice/program/soffice.exe. GOLDEN_SMOKE_TARGET_MANIFEST points to native/target-manifest.json. No E2E_MODEL_GATEWAY. PostgreSQL17 image `public.ecr.aws/supabase/postgres:17.11.0.004`, container `codex-six-repair-20261018`, label codex.task=six-repair-20261018, loopback55527; only its local test authentication was configured. Native app role is non-owner/NOSUPERUSER/NOBYPASSRLS; required role-management DB suites use supabase_admin.

`source-after.json`: all584 application/engine/migration/test-source paths match each exact commit after execution. Only tracked launcher modification is a graceful stop-file poll in the final copy. Original Auth and16-case DB probes hash-match their retained originals. `final-build-equivalence.json` establishes that the benchmark and five sign-in repair/harness paths are byte-identical in the final build. Storage checker/tests also match their accepted commit. No application source was edited.

## History, retention and ownership

All earlier failed runs remain intact. This review's two benchmark failures and lease-wait failure are application/harness-measurement findings, not environment failures. An initial read-only temp-source hash inspection lacked sandbox permission; its approved continuation passed, without executing a failed application assertion. Record: `inspection-history.json`. All browser commands passed without reruns or changed assertions. Replay remains orchestration only; no paid/model call or fresh semantic-quality claim.

Password-free synthetic DB dump, storage inventory/reads, native exports/traces/screenshots, portable independent probes, observations, command logs/exit files and manifests are retained locally. `cleanup.json` verifies runtime DB/app-role removal, labelled cluster removal and3247/39134/55527 clear; process check finds no owned application/conversion process. Artifact hashes are retained. No user service stopped, deployed prerequisite changed, scheduled watch changed, push or author/history rewrite.

Handoff **READY_FOR_CLAUDE**: repair only the remaining affirmative-attribution benchmark classification and lease-expiry-after-lock-wait cases, with the focused positive/refusal/recovery controls above. Preserve accepted sign-in, storage, purge and retry evidence. Return exact stable commits for independent review. Deployed security/process checks, reference curation and the real-model run remain separate; this report does not authorize executing them or promote overall acceptance.
